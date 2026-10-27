import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/channels/crypto";
import type { Json } from "@/lib/database.types";

/** Lê o segredo (token/senha) de um canal. Somente no servidor. */
export async function readSecret<T>(accountId: string): Promise<T | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("channel_secrets").select("ciphertext").eq("account_id", accountId).maybeSingle();
  return data ? decryptSecret<T>(data.ciphertext) : null;
}

export async function writeSecret(accountId: string, secret: unknown) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("channel_secrets")
    .upsert({ account_id: accountId, ciphertext: encryptSecret(secret), updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw error;
}

/** Junta dados novos ao "config" (não secreto) do canal. */
export async function mergeConfig(accountId: string, patch: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const admin = createAdminClient();
  const { data } = await admin.from("channel_accounts").select("config").eq("id", accountId).single();
  const config = { ...((data?.config as Record<string, unknown>) ?? {}), ...patch } as Json;
  await admin.from("channel_accounts").update({ config, ...extra }).eq("id", accountId);
}

/** Registra uma mensagem pelo procedimento do banco (idempotente, com vínculo automático ao cliente). */
export async function ingestMessage(args: {
  accountId: string;
  direction: "entrada" | "saida";
  externalId: string | null;
  contact: string;
  contactName?: string | null;
  kind: string;
  subject?: string | null;
  body: string | null;
  media?: Json | null;
  status: "recebida" | "enviando" | "enviada" | "entregue" | "lida" | "falhou";
  via: string | null;
  sentAt: string;
  sentBy?: string | null;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("channel_ingest", {
    p_account: args.accountId,
    p_direction: args.direction,
    p_external_id: args.externalId,
    p_contact_address: args.contact,
    p_contact_name: args.contactName ?? null,
    p_kind: args.kind,
    p_subject: args.subject ?? null,
    p_body: args.body,
    p_media: args.media ?? null,
    p_status: args.status,
    p_via: args.via,
    p_sent_at: args.sentAt,
    p_sent_by: args.sentBy ?? null,
  });
  if (error) throw error;
  return data;
}
