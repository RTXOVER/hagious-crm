/**
 * Leitura dos avisos (webhooks) da API oficial do WhatsApp (Cloud API) — sem acesso a banco, testável.
 * Formatos conforme a documentação da Meta: campo "messages" (mensagens recebidas e situações),
 * "smb_message_echoes" (mensagens enviadas pelo app WhatsApp Business no celular, em coexistência),
 * "history" (histórico importado na conexão) e "smb_app_state_sync" (contatos do app).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type WaMessageEvent = {
  type: "message";
  direction: "entrada" | "saida";
  via: "app" | "historico" | null;
  externalId: string;
  contact: string; // número do cliente (wa_id)
  contactName: string | null;
  sentAt: string; // ISO
  kind: string;
  body: string | null;
  media: Record<string, unknown> | null;
};
export type WaStatusEvent = { type: "status"; externalId: string; status: "enviada" | "entregue" | "lida" | "falhou"; error: string | null };
export type WaContactEvent = { type: "contact"; contact: string; name: string | null };
export type WaHistoryProgress = { type: "history_progress"; phase: number | null; progress: number | null; declined: boolean };
export type WaEvent = WaMessageEvent | WaStatusEvent | WaContactEvent | WaHistoryProgress;
export type ParsedChange = { phoneNumberId: string | null; displayPhone: string | null; wabaId: string | null; field: string; events: WaEvent[] };

/** Confere a assinatura X-Hub-Signature-256 (HMAC-SHA256 do corpo exato com o App Secret), em tempo constante. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  // Formato exato: "sha256=" + 64 caracteres hexadecimais (nada antes ou depois)
  if (!header || !appSecret || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

const toIso = (ts: unknown) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" && v.length ? v : null);

/** Conteúdo legível de uma mensagem do WhatsApp (texto, legenda de mídia, localização, botão...). */
export function describeContent(m: Obj): { kind: string; body: string | null; media: Obj | null } {
  const type = str(m.type) ?? "other";
  const part = obj(m[type]);
  switch (type) {
    case "text":
      return { kind: "text", body: str(obj(m.text).body), media: null };
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return {
        kind: type,
        body: str(part.caption) ?? (type === "document" ? str(part.filename) : null),
        media: { id: str(part.id), mime_type: str(part.mime_type), filename: str(part.filename), caption: str(part.caption) },
      };
    case "location": {
      const name = [str(part.name), str(part.address)].filter(Boolean).join(" — ");
      return { kind: "location", body: name || `Localização: ${part.latitude}, ${part.longitude}`, media: { latitude: part.latitude, longitude: part.longitude } };
    }
    case "contacts": {
      const list = Array.isArray(m.contacts) ? m.contacts : [];
      const names = list.map((c) => str(obj(obj(c).name).formatted_name)).filter(Boolean);
      return { kind: "contacts", body: names.length ? `Contato(s): ${names.join(", ")}` : "Contato compartilhado", media: null };
    }
    case "button":
      return { kind: "text", body: str(obj(m.button).text), media: null };
    case "interactive": {
      const i = obj(m.interactive);
      const reply = obj(i.button_reply).title ?? obj(i.list_reply).title;
      return { kind: "text", body: str(reply), media: null };
    }
    case "reaction":
      return { kind: "other", body: `Reagiu com ${str(obj(m.reaction).emoji) ?? "emoji"}`, media: null };
    case "media_placeholder":
      return { kind: "other", body: "[mídia do histórico]", media: null };
    default:
      return { kind: "other", body: "[tipo de mensagem não suportado]", media: null };
  }
}

/** Lê um corpo de webhook inteiro e devolve as mudanças normalizadas (uma por "change"). */
export function parseWebhook(payload: unknown): ParsedChange[] {
  const p = obj(payload);
  if (p.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return [];
  const out: ParsedChange[] = [];
  for (const entry of p.entry) {
    const e = obj(entry);
    const wabaId = str(e.id);
    for (const ch of Array.isArray(e.changes) ? e.changes : []) {
      const change = obj(ch);
      const field = str(change.field) ?? "";
      const value = obj(change.value);
      const meta = obj(value.metadata);
      const events: WaEvent[] = [];
      const business = str(meta.display_phone_number);

      if (field === "messages") {
        const names = new Map<string, string | null>();
        for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
          names.set(String(obj(c).wa_id), str(obj(obj(c).profile).name));
        }
        for (const raw of Array.isArray(value.messages) ? value.messages : []) {
          const m = obj(raw);
          const from = str(m.from);
          const id = str(m.id);
          if (!from || !id) continue;
          const c = describeContent(m);
          events.push({ type: "message", direction: "entrada", via: null, externalId: id, contact: from, contactName: names.get(from) ?? null, sentAt: toIso(m.timestamp), ...c });
        }
        for (const raw of Array.isArray(value.statuses) ? value.statuses : []) {
          const s = obj(raw);
          const map = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" } as const;
          const st = map[str(s.status) as keyof typeof map];
          const id = str(s.id);
          if (!st || !id) continue;
          const errs = Array.isArray(s.errors) ? s.errors.map((x) => [obj(x).code, str(obj(x).title) ?? str(obj(x).message)].filter(Boolean).join(" ")) : [];
          events.push({ type: "status", externalId: id, status: st, error: errs.join("; ") || null });
        }
      } else if (field === "smb_message_echoes") {
        // Enviadas pelo celular (app WhatsApp Business): "to" é o cliente
        for (const raw of Array.isArray(value.message_echoes) ? value.message_echoes : []) {
          const m = obj(raw);
          const to = str(m.to);
          const id = str(m.id);
          if (!to || !id) continue;
          events.push({ type: "message", direction: "saida", via: "app", externalId: id, contact: to, contactName: null, sentAt: toIso(m.timestamp), ...describeContent(m) });
        }
      } else if (field === "history") {
        for (const h of Array.isArray(value.history) ? value.history : []) {
          const hm = obj(obj(h).metadata);
          events.push({ type: "history_progress", phase: Number(hm.phase ?? NaN) || 0, progress: Number(hm.progress ?? NaN) || 0, declined: false });
          for (const t of Array.isArray(obj(h).threads) ? (obj(h).threads as unknown[]) : []) {
            const thread = obj(t);
            const contact = str(thread.id);
            if (!contact) continue;
            for (const raw of Array.isArray(thread.messages) ? thread.messages : []) {
              const m = obj(raw);
              const id = str(m.id);
              if (!id) continue;
              const inbound = str(m.from) === contact;
              events.push({ type: "message", direction: inbound ? "entrada" : "saida", via: "historico", externalId: id, contact, contactName: null, sentAt: toIso(m.timestamp), ...describeContent(m) });
            }
          }
        }
        if (Array.isArray(value.errors) && value.errors.some((x) => Number(obj(x).code) === 2593109)) {
          events.push({ type: "history_progress", phase: null, progress: null, declined: true });
        }
      } else if (field === "smb_app_state_sync") {
        for (const raw of Array.isArray(value.state_sync) ? value.state_sync : []) {
          const s = obj(raw);
          const c = obj(s.contact);
          const phone = str(c.phone_number);
          if (str(s.type) === "contact" && phone && str(s.action) !== "remove") {
            events.push({ type: "contact", contact: phone.replace(/\D/g, ""), name: str(c.full_name) ?? str(c.first_name) });
          }
        }
      }
      out.push({ phoneNumberId: str(meta.phone_number_id), displayPhone: business, wabaId, field, events });
    }
  }
  return out;
}

/** Monta um aviso no formato da Meta (usado pelo modo de demonstração e pelos testes). */
export function buildIncomingPayload(opts: { phoneNumberId: string; displayPhone: string; from: string; name: string; text: string; id: string; timestamp?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "demo-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: opts.displayPhone, phone_number_id: opts.phoneNumberId },
              contacts: [{ profile: { name: opts.name }, wa_id: opts.from }],
              messages: [{ from: opts.from, id: opts.id, timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)), type: "text", text: { body: opts.text } }],
            },
          },
        ],
      },
    ],
  };
}
