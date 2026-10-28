import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type AddressObject } from "mailparser";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestMessage, mergeConfig, readSecret } from "@/lib/channels/accounts";
import { assertSafeMailHost } from "@/lib/security/net-guard";

/** Confere os dois servidores antes de qualquer conexão (o endereço pode ter mudado desde o cadastro). */
async function guardHosts(cfg: EmailConfig) {
  await Promise.all([assertSafeMailHost(cfg.imap.host), assertSafeMailHost(cfg.smtp.host)]);
}

/**
 * E-mail por IMAP (receber) e SMTP (enviar): funciona com quase todos os provedores, sem cadastro em terceiros.
 * A senha fica criptografada (channel_secrets); servidores e andamento ficam em channel_accounts.config.
 */
export type ServerCfg = { host: string; port: number; secure: boolean };
export type EmailConfig = {
  provider: string;
  username: string;
  imap: ServerCfg;
  smtp: ServerCfg;
  folders?: Record<string, { uidValidity: string; lastUid: number }>;
  sync?: { last_count?: number; at?: string };
};
type EmailSecret = { password: string };

const TIMEOUT = 20_000;
const FIRST_SYNC_DAYS = 30;
const MAX_PER_FOLDER = 300;

function imapClient(cfg: EmailConfig, password: string) {
  return new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: cfg.imap.secure,
    // Porta sem SSL direto (143): exige STARTTLS — a senha nunca trafega sem criptografia
    doSTARTTLS: cfg.imap.secure ? undefined : true,
    auth: { user: cfg.username, pass: password },
    logger: false,
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: 60_000,
  });
}

function smtpTransport(cfg: EmailConfig, password: string) {
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    requireTLS: !cfg.smtp.secure, // 587: exige STARTTLS
    auth: { user: cfg.username, pass: password },
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: 60_000,
  });
}

/** Mensagem de erro compreensível para quem está configurando. */
export function explainEmailError(e: unknown): string {
  const err = e as { message?: string; code?: string; authenticationFailed?: boolean; responseCode?: number };
  const m = `${err?.message ?? ""} ${err?.code ?? ""}`;
  if (err?.authenticationFailed || /auth|invalid credentials|535|login failed|AUTHENTICATIONFAILED/i.test(m)) {
    return "Usuário ou senha recusados pelo provedor. Confira a senha (no Gmail/Yahoo, use uma senha de app).";
  }
  if (err?.code === "HOST_BLOCKED") return "Endereço de servidor não permitido por segurança. Use o endereço do provedor de e-mail.";
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "Servidor não encontrado. Confira o endereço do servidor.";
  if (/ETIMEDOUT|timeout|ECONNREFUSED/i.test(m)) return "O servidor não respondeu. Confira servidor e porta (IMAP 993, SMTP 465 ou 587).";
  if (/certificate|self.signed|TLS|SSL/i.test(m)) return "Falha de segurança (SSL/TLS). Confira a porta e a opção de conexão segura.";
  return `Não foi possível conectar: ${err?.message ?? "erro desconhecido"}`.slice(0, 300);
}

/** Testa IMAP e SMTP com os dados informados (antes de salvar). */
export async function testEmailConnection(cfg: EmailConfig, password: string) {
  await guardHosts(cfg);
  const imap = imapClient(cfg, password);
  try {
    await imap.connect();
  } finally {
    await imap.logout().catch(() => imap.close());
  }
  await smtpTransport(cfg, password).verify();
}

const allAddresses = (...lists: (AddressObject | AddressObject[] | undefined)[]) =>
  lists
    .flatMap((a) => (Array.isArray(a) ? a : a ? [a] : []))
    .flatMap((x) => x.value)
    .filter((v) => v.address)
    .map((v) => ({ address: (v.address ?? "").toLowerCase().trim(), name: v.name || null }));

/**
 * Sinais de e-mail em massa/automático (newsletter, propaganda, aviso de sistema), usados na classificação
 * "Separados". Lê cabeçalhos padrão (List-Unsubscribe, List-Id, Precedence, Auto-Submitted) e o remetente.
 */
export function emailSignals(headers: Map<string, unknown>, fromAddress: string | null) {
  const h = (k: string) => {
    const v = headers.get(k);
    return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  };
  const local = (fromAddress ?? "").split("@")[0] ?? "";
  const reasons: string[] = [];
  if (h("list-unsubscribe")) reasons.push("descadastro");
  if (h("list-id")) reasons.push("lista");
  if (/\b(bulk|list|junk)\b/i.test(h("precedence"))) reasons.push("envio em massa");
  const auto = h("auto-submitted");
  if (auto && !/^\s*no\s*$/i.test(auto)) reasons.push("automático");
  if (h("x-campaign") || h("x-mailchimp-campaign") || h("x-sg-eid") || h("x-mc-user") || h("feedback-id")) reasons.push("campanha");
  if (/^(no-?reply|do-?not-?reply|naoresponda|nao-?responda|newsletter|news|marketing|mailer|promo|ofertas?|notifica(cao|coes)?|notifications?|bounce)/i.test(local)) {
    reasons.push("remetente automático");
  }
  return { bulk: reasons.length > 0, reasons };
}

/** Converte HTML em texto legível (entidades decodificadas na ordem certa, sem <head>/scripts). */
export function htmlToText(html: string) {
  return html
    .replace(/<(head|script|style|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&") // por último, para não decodificar duas vezes
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Quais UIDs buscar nesta rodada.
 * - Primeira vez: os mais RECENTES (até o limite) dos últimos 30 dias.
 * - Depois: os mais ANTIGOS ainda não lidos (até o limite) — a próxima rodada continua de onde parou, nada se perde.
 */
export function pickUids(uids: number[], incremental: boolean, max = MAX_PER_FOLDER) {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  return incremental ? sorted.slice(0, max) : sorted.slice(-max);
}

/**
 * Busca mensagens novas da Caixa de entrada e dos Enviados, continuando de onde parou (por UID).
 * Usa uma trava no banco para não rodar duas vezes ao mesmo tempo na mesma caixa.
 * Retorna quantas mensagens novas foram importadas, ou null se outra busca já estava em andamento / foi recente.
 */
export async function syncEmailAccount(accountId: string, opts: { minIntervalMs?: number } = {}) {
  const admin = createAdminClient();
  // Trava atômica no banco: só um processo por vez e respeitando o intervalo mínimo entre buscas
  const { data: claimed, error: claimError } = await admin.rpc("channel_claim_sync", {
    p_account: accountId,
    p_min_interval_seconds: Math.round((opts.minIntervalMs ?? 30_000) / 1000),
  });
  if (claimError) throw claimError;
  if (!claimed) return null;

  try {
    const { data: account } = await admin.from("channel_accounts").select("id, address, config").eq("id", accountId).single();
    if (!account) throw new Error("Canal de e-mail não encontrado.");
    if (!account.address) throw new Error("Canal de e-mail não encontrado.");
    const cfg = account.config as EmailConfig;
    const secret = await readSecret<EmailSecret>(accountId);
    if (!secret) throw new Error("Senha do e-mail não encontrada. Conecte de novo.");

    const me = account.address.toLowerCase();
    await guardHosts(cfg);
    const imap = imapClient(cfg, secret.password);
    const folders = { ...(cfg.folders ?? {}) };
    let imported = 0;
    let skipped = 0;
    await imap.connect();
    try {
      const list = await imap.list();
      const sent = list.find((b) => b.specialUse === "\\Sent")?.path;
      for (const path of ["INBOX", ...(sent ? [sent] : [])]) {
        const isSentFolder = path === sent;
        const lock = await imap.getMailboxLock(path);
        try {
          const box = imap.mailbox;
          if (!box) continue;
          const validity = String(box.uidValidity);
          const state = folders[path]?.uidValidity === validity ? folders[path] : null;
          const uids = state
            ? ((await imap.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > state.lastUid)
            : (await imap.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000) }, { uid: true })) || [];
          const pick = pickUids(uids, !!state);
          let maxUid = state?.lastUid ?? 0;
          if (pick.length) {
            for await (const msg of imap.fetch(pick.join(","), { uid: true, source: true, internalDate: true }, { uid: true })) {
              maxUid = Math.max(maxUid, msg.uid);
              // Cada mensagem isolada: uma mensagem com defeito é pulada e registrada, sem travar a caixa
              try {
                if (!msg.source) continue;
                const parsed = await simpleParser(msg.source);
                const from = allAddresses(parsed.from)[0] ?? null;
                // Pasta Enviados = enviado por nós (inclui apelidos/"enviar como"); na Caixa de entrada, só se o remetente for a própria caixa
                const outgoing = isSentFolder || from?.address === me;
                const other = outgoing
                  ? allAddresses(parsed.to, parsed.cc, parsed.bcc).find((a) => a.address !== me)
                  : from;
                if (!other?.address || other.address.length > 200 || other.address === me) continue;
                const text = (parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : "")).slice(0, 100_000);
                const raw = parsed.date ?? (msg.internalDate instanceof Date ? msg.internalDate : null);
                const date = raw && !Number.isNaN(raw.getTime()) ? raw : new Date();
                const msgId = parsed.messageId && parsed.messageId.length <= 500 ? parsed.messageId : `uid:${path}:${validity}:${msg.uid}`;
                const signals = outgoing ? { bulk: false, reasons: [] } : emailSignals(parsed.headers as Map<string, unknown>, from?.address ?? null);
                const id = await ingestMessage({
                  accountId,
                  direction: outgoing ? "saida" : "entrada",
                  externalId: msgId,
                  contact: other.address,
                  contactName: other.name?.slice(0, 200) ?? null,
                  kind: "email",
                  subject: parsed.subject?.slice(0, 500) ?? null,
                  body: text || null,
                  media: {
                    signals,
                    to: allAddresses(parsed.to).map((a) => a.address).slice(0, 10),
                    cc: allAddresses(parsed.cc).map((a) => a.address).slice(0, 10),
                    ...(parsed.attachments?.length
                      ? { attachments: parsed.attachments.slice(0, 20).map((a) => ({ filename: (a.filename ?? "anexo").slice(0, 200), size: a.size, mime_type: a.contentType })) }
                      : {}),
                  },
                  status: outgoing ? "enviada" : "recebida",
                  via: "email",
                  sentAt: date.toISOString(),
                });
                if (id) imported++;
              } catch (e) {
                skipped++;
                console.error(`[email] mensagem ignorada (${path} uid ${msg.uid}):`, (e as Error).message);
              }
            }
          } else if (!state) {
            maxUid = Math.max(0, Number(box.uidNext ?? 1) - 1);
          }
          folders[path] = { uidValidity: validity, lastUid: maxUid };
        } finally {
          lock.release();
        }
        // Salva o andamento a cada pasta (se cair no meio, não repete o que já foi feito)
        await mergeConfig(accountId, { folders });
      }
    } finally {
      await imap.logout().catch(() => imap.close());
    }
    await mergeConfig(accountId, { folders, sync: { last_count: imported, skipped, at: new Date().toISOString() } });
    await admin.from("channel_accounts").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("id", accountId).neq("status", "desconectado");
    return imported;
  } finally {
    await admin.from("channel_accounts").update({ sync_lock_until: null }).eq("id", accountId);
  }
}

/** Envia um e-mail e devolve o Message-ID (o mesmo que a sincronização vai encontrar nos Enviados). */
export async function sendEmail(accountId: string, opts: { to: string; subject: string; text: string; inReplyTo?: string | null }) {
  const admin = createAdminClient();
  const { data: account } = await admin.from("channel_accounts").select("label, address, config, is_demo").eq("id", accountId).single();
  if (!account?.address) throw new Error("Canal de e-mail não encontrado.");
  if (account.is_demo) return `<demo.${crypto.randomUUID()}@hagious.invalid>`;
  const secret = await readSecret<EmailSecret>(accountId);
  if (!secret) throw new Error("Senha do e-mail não encontrada. Conecte de novo.");
  await guardHosts(account.config as EmailConfig);
  const info = await smtpTransport(account.config as EmailConfig, secret.password).sendMail({
    from: { name: account.label, address: account.address },
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo, references: [opts.inReplyTo] } : {}),
  });
  return info.messageId;
}
