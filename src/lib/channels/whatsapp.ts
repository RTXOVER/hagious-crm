import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestMessage, mergeConfig, readSecret, writeSecret } from "@/lib/channels/accounts";
import { parseWebhook } from "@/lib/channels/whatsapp-parse";
import type { Json } from "@/lib/database.types";

/**
 * WhatsApp pela API oficial da Meta (Cloud API), com coexistência: o número continua no app WhatsApp Business.
 * Configuração única da Hagious (variáveis de ambiente do servidor):
 * - META_APP_ID, META_APP_SECRET: aplicativo da Hagious no painel de desenvolvedores da Meta (Tech Provider)
 * - WHATSAPP_ES_CONFIG_ID: id da configuração do "Embedded Signup" (janela de conexão)
 * - WHATSAPP_VERIFY_TOKEN: texto combinado com a Meta para validar o endereço do webhook
 * - META_GRAPH_VERSION (opcional): versão da API, ex.: v23.0
 */
export function whatsappEnv() {
  return {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    configId: process.env.WHATSAPP_ES_CONFIG_ID ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    version: process.env.META_GRAPH_VERSION || "v23.0",
  };
}
export const whatsappReady = () => {
  const e = whatsappEnv();
  return Boolean(e.appId && e.appSecret && e.configId);
};

type WaSecret = { accessToken: string };
type WaConfig = { phone_number_id?: string; waba_id?: string; history?: Record<string, unknown> };

const graph = (path: string) => `https://graph.facebook.com/${whatsappEnv().version}/${path}`;

async function graphFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(graph(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000), // a Meta travada não pode prender a tela
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!res.ok || body.error) {
    throw new Error(`Meta: ${body.error?.message ?? res.statusText}${body.error?.code ? ` (código ${body.error.code})` : ""}`);
  }
  return body;
}

// ---------------- Recebimento ----------------

/** Processa um aviso da Meta já validado. Idempotente: pode ser chamado de novo com o mesmo conteúdo. */
export async function processWhatsAppPayload(payload: unknown) {
  const admin = createAdminClient();
  const changes = parseWebhook(payload);
  let handled = 0;
  for (const ch of changes) {
    if (!ch.phoneNumberId) continue;
    const { data: account } = await admin
      .from("channel_accounts")
      .select("id, config")
      .eq("kind", "whatsapp")
      .neq("status", "desconectado") // desconectado no CRM: para de receber
      .filter("config->>phone_number_id", "eq", ch.phoneNumberId)
      .maybeSingle();
    if (!account) continue; // número não conectado a este CRM
    for (const ev of ch.events) {
      if (ev.type === "message") {
        await ingestMessage({
          accountId: account.id,
          direction: ev.direction,
          externalId: ev.externalId,
          contact: ev.contact,
          contactName: ev.contactName,
          kind: ev.kind,
          body: ev.body,
          media: ev.media as Json,
          status: ev.direction === "entrada" ? "recebida" : "enviada",
          via: ev.via,
          sentAt: ev.sentAt,
        });
      } else if (ev.type === "status") {
        await admin.rpc("channel_message_status", { p_account: account.id, p_external_id: ev.externalId, p_status: ev.status, p_error: ev.error });
      } else if (ev.type === "contact" && ev.name) {
        await admin.from("conversations").update({ contact_name: ev.name }).eq("account_id", account.id).eq("contact_address", ev.contact).is("contact_name", null);
      } else if (ev.type === "history_progress") {
        await mergeConfig(account.id, { history: { phase: ev.phase, progress: ev.progress, declined: ev.declined, at: new Date().toISOString() } });
      }
      handled++;
    }
    await admin.from("channel_accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
  }
  return handled;
}

// ---------------- Envio ----------------

/** Envia texto livre. A Meta só aceita texto livre até 24h depois da última mensagem do cliente. */
export async function sendWhatsAppText(accountId: string, to: string, body: string): Promise<string> {
  const admin = createAdminClient();
  const { data: account } = await admin.from("channel_accounts").select("config, is_demo").eq("id", accountId).single();
  if (account?.is_demo) return `demo.${crypto.randomUUID()}`; // modo de demonstração: não sai do sistema
  const cfg = (account?.config ?? {}) as WaConfig;
  const secret = await readSecret<WaSecret>(accountId);
  if (!cfg.phone_number_id || !secret?.accessToken) throw new Error("WhatsApp não está conectado.");
  const r = await graphFetch<{ messages?: { id: string }[] }>(`${cfg.phone_number_id}/messages`, {
    method: "POST",
    token: secret.accessToken,
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
  });
  const id = r.messages?.[0]?.id;
  if (!id) throw new Error("A Meta não devolveu o id da mensagem.");
  return id;
}

// ---------------- Conexão (Embedded Signup) ----------------

/**
 * Conclui a conexão: troca o código da janela da Meta por um token, descobre o número, assina os avisos
 * deste aplicativo e pede a cópia dos contatos e do histórico (a Meta só permite nas primeiras 24h).
 */
export async function completeEmbeddedSignup(opts: { code: string; wabaId: string; phoneNumberId?: string | null; userId: string }) {
  const env = whatsappEnv();
  const token = await graphFetch<{ access_token: string }>(
    `oauth/access_token?client_id=${encodeURIComponent(env.appId)}&client_secret=${encodeURIComponent(env.appSecret)}&code=${encodeURIComponent(opts.code)}`,
  );
  const accessToken = token.access_token;

  const numbers = await graphFetch<{ data: { id: string; display_phone_number: string; verified_name?: string }[] }>(
    `${opts.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { token: accessToken },
  );
  // Número escolhido na janela da Meta; só usa o primeiro da conta quando a janela não informou qual
  const phone = opts.phoneNumberId ? numbers.data.find((n) => n.id === opts.phoneNumberId) : numbers.data[0];
  if (!phone) throw new Error("O número escolhido não foi encontrado nesta conta do WhatsApp. Tente conectar de novo.");

  await graphFetch(`${opts.wabaId}/subscribed_apps`, { method: "POST", token: accessToken });

  const admin = createAdminClient();
  const address = phone.display_phone_number.replace(/\D/g, "");
  const { data: existing } = await admin.from("channel_accounts").select("id").eq("kind", "whatsapp").eq("address", address).maybeSingle();
  const row = {
    kind: "whatsapp" as const,
    label: phone.verified_name ? `WhatsApp ${phone.verified_name}` : "WhatsApp da empresa",
    address,
    status: "conectado" as const,
    config: { phone_number_id: phone.id, waba_id: opts.wabaId, connected_via: "embedded_signup_coexistence" } as Json,
    last_error: null,
    connected_by: opts.userId,
  };
  const { data: saved, error } = existing
    ? await admin.from("channel_accounts").update(row).eq("id", existing.id).select("id").single()
    : await admin.from("channel_accounts").insert(row).select("id").single();
  if (error || !saved) throw error ?? new Error("Não foi possível salvar o canal.");
  await writeSecret(saved.id, { accessToken } satisfies WaSecret);

  // Cópia de contatos e histórico (pode falhar se o número não for do app WhatsApp Business)
  const sync: Record<string, string> = {};
  for (const type of ["smb_app_state_sync", "history"] as const) {
    try {
      const r = await graphFetch<{ request_id?: string }>(`${phone.id}/smb_app_data`, {
        method: "POST",
        token: accessToken,
        body: JSON.stringify({ messaging_product: "whatsapp", sync_type: type }),
      });
      sync[type] = r.request_id ?? "solicitado";
    } catch (e) {
      sync[type] = `falhou: ${(e as Error).message}`.slice(0, 300);
    }
  }
  await mergeConfig(saved.id, { sync_requests: sync, sync_requested_at: new Date().toISOString() });
  return saved.id;
}
