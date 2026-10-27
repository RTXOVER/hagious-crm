import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { buildIncomingPayload, describeContent, parseWebhook, signBody, verifySignature } from "@/lib/channels/whatsapp-parse";

describe("WhatsApp: assinatura dos avisos", () => {
  const secret = "segredo-de-teste";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("aceita só o corpo exato assinado com o App Secret", () => {
    const sig = signBody(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(body + " ", sig, secret)).toBe(false); // corpo alterado
    expect(verifySignature(body, signBody(body, "outro"), secret)).toBe(false); // segredo errado
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=zz", secret)).toBe(false);
    expect(verifySignature(body, sig, "")).toBe(false); // sem segredo configurado
  });
});

describe("WhatsApp: leitura dos avisos da Meta", () => {
  it("mensagem recebida (formato da documentação)", () => {
    const p = buildIncomingPayload({ phoneNumberId: "106540352242922", displayPhone: "15550783881", from: "16505551234", name: "Sheena Nelson", text: "Does it come in another color?", id: "wamid.A", timestamp: 1749416383 });
    const [ch] = parseWebhook(p);
    expect(ch.phoneNumberId).toBe("106540352242922");
    expect(ch.events).toEqual([
      expect.objectContaining({ type: "message", direction: "entrada", externalId: "wamid.A", contact: "16505551234", contactName: "Sheena Nelson", kind: "text", body: "Does it come in another color?", sentAt: new Date(1749416383000).toISOString() }),
    ]);
  });

  it("situações de envio e erro", () => {
    const [ch] = parseWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: "9" }, statuses: [
        { id: "wamid.S", status: "delivered", timestamp: "1750263773", recipient_id: "1650" },
        { id: "wamid.F", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
        { id: "wamid.X", status: "desconhecido" },
      ] } }] }],
    });
    expect(ch.events).toEqual([
      { type: "status", externalId: "wamid.S", status: "entregue", error: null },
      { type: "status", externalId: "wamid.F", status: "falhou", error: "131047 Re-engagement message" },
    ]);
  });

  it("mensagem enviada pelo celular (coexistência) vira saída 'pelo app'", () => {
    const [ch] = parseWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "smb_message_echoes", value: { metadata: { phone_number_id: "9" }, message_echoes: [
        { from: "15550783881", to: "16505551234", id: "wamid.E", timestamp: "1739230955", type: "text", text: { body: "Here's the info you requested!" } },
      ] } }] }],
    });
    expect(ch.events[0]).toMatchObject({ type: "message", direction: "saida", via: "app", contact: "16505551234", body: "Here's the info you requested!" });
  });

  it("histórico: direção pela origem, progresso e recusa", () => {
    const [ch] = parseWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "history", value: { metadata: { phone_number_id: "9" }, history: [
        { metadata: { phase: 0, chunk_order: 1, progress: 55 }, threads: [{ id: "16505551234", messages: [
          { from: "15550783881", id: "wamid.H1", timestamp: "1739230955", type: "text", text: { body: "Olá" }, history_context: { status: "READ" } },
          { from: "16505551234", id: "wamid.H2", timestamp: "1739230999", type: "media_placeholder" },
        ] }] },
      ] } }] }],
    });
    expect(ch.events[0]).toEqual({ type: "history_progress", phase: 0, progress: 55, declined: false });
    expect(ch.events[1]).toMatchObject({ direction: "saida", via: "historico", externalId: "wamid.H1" });
    expect(ch.events[2]).toMatchObject({ direction: "entrada", via: "historico", body: "[mídia do histórico]" });

    const [declined] = parseWebhook({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "history", value: { metadata: { phone_number_id: "9" }, errors: [{ code: 2593109 }] } }] }] });
    expect(declined.events).toContainEqual({ type: "history_progress", phase: null, progress: null, declined: true });
  });

  it("contatos do app e tipos de conteúdo", () => {
    const [ch] = parseWebhook({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "smb_app_state_sync", value: { metadata: { phone_number_id: "9" }, state_sync: [
      { type: "contact", contact: { full_name: "Maria Silva", phone_number: "+55 34 99958-3398" }, action: "add" },
      { type: "contact", contact: { phone_number: "5511" }, action: "remove" },
    ] } }] }] });
    expect(ch.events).toEqual([{ type: "contact", contact: "5534999583398", name: "Maria Silva" }]);

    expect(describeContent({ type: "document", document: { id: "M1", filename: "extrato.pdf", mime_type: "application/pdf" } })).toMatchObject({ kind: "document", body: "extrato.pdf", media: { id: "M1" } });
    expect(describeContent({ type: "image", image: { id: "M2", caption: "Comprovante" } })).toMatchObject({ kind: "image", body: "Comprovante" });
    expect(describeContent({ type: "interactive", interactive: { button_reply: { title: "Sim" } } }).body).toBe("Sim");
    expect(describeContent({ type: "algo_novo" }).kind).toBe("other");
  });

  it("ignora o que não é da conta do WhatsApp", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe("Criptografia dos segredos dos canais", () => {
  it("guarda e lê de volta; rejeita adulteração e chave errada", async () => {
    process.env.CHANNEL_SECRET_KEY = randomBytes(32).toString("base64");
    const { encryptSecret, decryptSecret } = await import("@/lib/channels/crypto");
    const box = encryptSecret({ password: "s3nh@-de-app" });
    expect(box).not.toContain("s3nh@");
    expect(decryptSecret(box)).toEqual({ password: "s3nh@-de-app" });
    expect(encryptSecret({ a: 1 })).not.toBe(encryptSecret({ a: 1 })); // vetor aleatório a cada vez

    const parts = box.split(".");
    parts[3] = Buffer.from("adulterado").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();

    process.env.CHANNEL_SECRET_KEY = randomBytes(32).toString("base64");
    expect(() => decryptSecret(box)).toThrow();
  });
});
