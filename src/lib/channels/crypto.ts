import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Criptografia dos segredos dos canais (token da Meta, senha do e-mail) com AES-256-GCM.
 * A chave fica só no servidor (CHANNEL_SECRET_KEY, 32 bytes em base64). Sem a chave, o banco sozinho não revela nada.
 */
function key(): Buffer {
  const raw = process.env.CHANNEL_SECRET_KEY;
  if (!raw) throw new Error("CHANNEL_SECRET_KEY não configurada no servidor.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("CHANNEL_SECRET_KEY inválida (precisa ter 32 bytes em base64).");
  return k;
}

export function encryptSecret(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret<T = unknown>(payload: string): T {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Formato de segredo desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as T;
}
