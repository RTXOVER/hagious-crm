import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type AddressObject } from "mailparser";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestMessage, mergeConfig, readSecret } from "@/lib/channels/accounts";

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
    auth: { user: cfg.username, pass: password },
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
  });
}

/** Mensagem de erro compreensível para quem está configurando. */
export function explainEmailError(e: unknown): string {
  const err = e as { message?: string; code?: string; authenticationFailed?: boolean; responseCode?: number };
  const m = `${err?.message ?? ""} ${err?.code ?? ""}`;
  if (err?.authenticationFailed || /auth|invalid credentials|535|login failed|AUTHENTICATIONFAILED/i.test(m)) {
    return "Usuário ou senha recusados pelo provedor. Confira a senha (no Gmail/Yahoo, use uma senha de app).";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "Servidor não encontrado. Confira o endereço do servidor.";
  if (/ETIMEDOUT|timeout|ECONNREFUSED/i.test(m)) return "O servidor não respondeu. Confira servidor e porta (IMAP 993, SMTP 465 ou 587).";
  if (/certificate|self.signed|TLS|SSL/i.test(m)) return "Falha de segurança (SSL/TLS). Confira a porta e a opção de conexão segura.";
  return `Não foi possível conectar: ${err?.message ?? "erro desconhecido"}`.slice(0, 300);
}

/** Testa IMAP e SMTP com os dados informados (antes de salvar). */
export async function testEmailConnection(cfg: EmailConfig, password: string) {
  const imap = imapClient(cfg, password);
  try {
    await imap.connect();
  } finally {
    await imap.logout().catch(() => imap.close());
  }
  await smtpTransport(cfg, password).verify();
}

const firstAddress = (a: AddressObject | AddressObject[] | undefined) => {
  const v = (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value);
  return v[0] ? { address: (v[0].address ?? "").toLowerCase(), name: v[0].name || null } : null;
};

function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Busca mensagens novas da Caixa de entrada e dos Enviados. Continua de onde parou (por UID). */
export async function syncEmailAccount(accountId: string) {
  const admin = createAdminClient();
  const { data: account } = await admin.from("channel_accounts").select("id, address, config").eq("id", accountId).single();
  if (!account?.address) throw new Error("Canal de e-mail não encontrado.");
  const cfg = account.config as EmailConfig;
  const secret = await readSecret<EmailSecret>(accountId);
  if (!secret) throw new Error("Senha do e-mail não encontrada. Conecte de novo.");

  const me = account.address.toLowerCase();
  const imap = imapClient(cfg, secret.password);
  const folders = { ...(cfg.folders ?? {}) };
  let imported = 0;
  await imap.connect();
  try {
    const list = await imap.list();
    const sent = list.find((b) => b.specialUse === "\\Sent")?.path;
    for (const path of ["INBOX", ...(sent ? [sent] : [])]) {
      const lock = await imap.getMailboxLock(path);
      try {
        const box = imap.mailbox;
        if (!box) continue;
        const validity = String(box.uidValidity);
        const state = folders[path]?.uidValidity === validity ? folders[path] : null;
        // Primeira vez: últimos 30 dias. Depois: só UIDs novos.
        const uids = state
          ? ((await imap.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > state.lastUid)
          : (await imap.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000) }, { uid: true })) || [];
        const pick = uids.sort((a, b) => a - b).slice(-MAX_PER_FOLDER);
        let maxUid = state?.lastUid ?? 0;
        if (pick.length) {
          for await (const msg of imap.fetch(pick.join(","), { uid: true, source: true, internalDate: true }, { uid: true })) {
            maxUid = Math.max(maxUid, msg.uid);
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source);
            const from = firstAddress(parsed.from);
            const to = firstAddress(parsed.to);
            const outgoing = from?.address === me;
            const other = outgoing ? to : from;
            if (!other?.address) continue;
            const text = (parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : "")).slice(0, 100_000);
            const date = parsed.date ?? (msg.internalDate instanceof Date ? msg.internalDate : new Date());
            const id = await ingestMessage({
              accountId,
              direction: outgoing ? "saida" : "entrada",
              externalId: parsed.messageId ?? `uid:${path}:${validity}:${msg.uid}`,
              contact: other.address,
              contactName: other.name,
              kind: "email",
              subject: parsed.subject?.slice(0, 500) ?? null,
              body: text || null,
              media: parsed.attachments?.length
                ? { attachments: parsed.attachments.slice(0, 20).map((a) => ({ filename: a.filename ?? "anexo", size: a.size, mime_type: a.contentType })) }
                : null,
              status: outgoing ? "enviada" : "recebida",
              via: "email",
              sentAt: date.toISOString(),
            });
            if (id) imported++;
          }
        } else if (!state) {
          maxUid = Math.max(0, Number(box.uidNext ?? 1) - 1);
        }
        folders[path] = { uidValidity: validity, lastUid: maxUid };
      } finally {
        lock.release();
      }
    }
  } finally {
    await imap.logout().catch(() => imap.close());
  }
  await mergeConfig(accountId, { folders, sync: { last_count: imported, at: new Date().toISOString() } }, {
    last_sync_at: new Date().toISOString(),
    last_error: null,
    status: "conectado",
  });
  return imported;
}

/** Envia um e-mail e devolve o Message-ID (o mesmo que a sincronização vai encontrar nos Enviados). */
export async function sendEmail(accountId: string, opts: { to: string; subject: string; text: string; inReplyTo?: string | null }) {
  const admin = createAdminClient();
  const { data: account } = await admin.from("channel_accounts").select("label, address, config, is_demo").eq("id", accountId).single();
  if (!account?.address) throw new Error("Canal de e-mail não encontrado.");
  if (account.is_demo) return `<demo.${crypto.randomUUID()}@hagious.invalid>`;
  const secret = await readSecret<EmailSecret>(accountId);
  if (!secret) throw new Error("Senha do e-mail não encontrada. Conecte de novo.");
  const info = await smtpTransport(account.config as EmailConfig, secret.password).sendMail({
    from: { name: account.label, address: account.address },
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo, references: [opts.inReplyTo] } : {}),
  });
  return info.messageId;
}
