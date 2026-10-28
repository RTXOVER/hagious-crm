import { describe, expect, it } from "vitest";
import { ACCOUNT_LIMIT, IP_LIMIT, blockedUntil, clientIp, minutesLeft } from "@/lib/security/throttle-rules";
import { weakPasswordReason } from "@/lib/validation/schemas";
import { isForbiddenIp } from "@/lib/security/net-guard";
import { contentSecurityPolicy, sessionCookieOptions } from "@/lib/security/headers";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const min = (m: number) => NOW - m * 60_000;
const fail = (m: number) => ({ success: false, at: min(m) });
const ok = (m: number) => ({ success: true, at: min(m) });

describe("bloqueio de tentativas de senha", () => {
  it("4 erros não bloqueiam; o 5º bloqueia por 15 min a partir do 1º erro da sequência", () => {
    expect(blockedUntil([fail(4), fail(3), fail(2), fail(1)], NOW, ACCOUNT_LIMIT)).toBeNull();
    const until = blockedUntil([fail(5), fail(4), fail(3), fail(2), fail(1)], NOW, ACCOUNT_LIMIT)!;
    expect(minutesLeft(until, NOW)).toBe(10);
  });
  it("acesso certo zera a sequência da conta", () => {
    expect(blockedUntil([fail(6), fail(5), fail(4), fail(3), ok(2), fail(1)], NOW, ACCOUNT_LIMIT)).toBeNull();
  });
  it("erros antigos (fora de 15 min) não contam", () => {
    expect(blockedUntil([fail(40), fail(30), fail(20), fail(16), fail(1)], NOW, ACCOUNT_LIMIT)).toBeNull();
  });
  it("endereço de rede: 20 erros em 15 min bloqueiam, mesmo com acertos no meio", () => {
    const many = Array.from({ length: 20 }, (_, i) => fail(14 - i * 0.5));
    expect(blockedUntil([...many, ok(1)], NOW, IP_LIMIT, false)).not.toBeNull();
    expect(blockedUntil(many.slice(1), NOW, IP_LIMIT, false)).toBeNull();
  });
  it("lê o endereço do visitante com segurança", () => {
    expect(clientIp("203.0.113.9, 10.0.0.1", null)).toBe("203.0.113.9");
    expect(clientIp(null, "::1")).toBe("::1");
    expect(clientIp("<script>", null)).toBe("desconhecido");
  });
});

describe("senhas previsíveis", () => {
  it("recusa palavras e sequências óbvias", () => {
    expect(weakPasswordReason("Senha2026abc")).not.toBeNull();
    expect(weakPasswordReason("Hagious2026!")).not.toBeNull();
    expect(weakPasswordReason("abc1234567x")).not.toBeNull();
    expect(weakPasswordReason("aaaa1111bbbb")).not.toBeNull();
  });
  it("recusa nome e e-mail da pessoa", () => {
    expect(weakPasswordReason("Fulano#2026xq", "fulano.silva@exemplo.com")).not.toBeNull();
    expect(weakPasswordReason("xLopes9xq2kz", undefined, "Maria Lopes")).not.toBeNull();
  });
  it("aceita senha forte", () => {
    expect(weakPasswordReason("Trem-azul-7-pedra", "ana@x.com", "Ana Souza")).toBeNull();
  });
});

describe("conexão de e-mail não alcança o próprio servidor", () => {
  it("bloqueia endereços internos da máquina e de metadados", () => {
    for (const ip of ["127.0.0.1", "0.0.0.0", "169.254.169.254", "::1", "::", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) expect(isForbiddenIp(ip)).toBe(true);
  });
  it("permite provedores e a rede interna da empresa", () => {
    for (const ip of ["142.250.0.109", "192.168.0.10", "10.1.2.3", "2607:f8b0::1"]) expect(isForbiddenIp(ip)).toBe(false);
  });
});

describe("cabeçalhos de segurança", () => {
  it("CSP com nonce, sem eval em produção e sem permitir o sistema dentro de outros sites", () => {
    const csp = contentSecurityPolicy("abc", { dev: false, https: true });
    expect(csp).toContain("'nonce-abc'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("abc", { dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });
  it("cookies de sessão inacessíveis a scripts", () => {
    expect(sessionCookieOptions(true)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
