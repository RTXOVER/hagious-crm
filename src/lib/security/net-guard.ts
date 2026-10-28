import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/*
 * Impede que o servidor seja usado para alcançar endereços dele mesmo (SSRF): ao conectar uma caixa de e-mail,
 * o servidor IMAP/SMTP não pode ser o próprio computador, endereços automáticos de rede ou de metadados de nuvem.
 * Redes internas (192.168.x, 10.x) continuam permitidas: o servidor de e-mail da empresa pode estar nelas.
 */

/** true se o endereço IP é do próprio computador, automático (link-local), não especificado ou multicast. */
export function isForbiddenIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224;
  }
  if (isIP(v) === 6) {
    return v === "::" || v === "::1" || /^fe[89ab]/.test(v) || /^ff/.test(v) || v.startsWith("fd00:ec2");
  }
  return true;
}

export async function assertSafeMailHost(host: string): Promise<void> {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h || h.length > 253 || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) {
    throw Object.assign(new Error("Endereço de servidor não permitido."), { code: "HOST_BLOCKED" });
  }
  const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true });
  if (!addrs.length || addrs.some((a) => isForbiddenIp(a.address))) {
    throw Object.assign(new Error("Endereço de servidor não permitido."), { code: "HOST_BLOCKED" });
  }
}
