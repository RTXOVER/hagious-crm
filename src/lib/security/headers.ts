/*
 * Regras de segurança aplicadas a cada página (usadas pelo proxy, que roda antes das telas).
 */

/** Cookies da sessão: inacessíveis a scripts (httpOnly), não enviados por outros sites (lax) e só por HTTPS quando houver HTTPS. */
export const sessionCookieOptions = (https: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure: https, path: "/" });

/** Tempo sem uso até encerrar a sessão (computador esquecido aberto). */
export const IDLE_LIMIT_MS = 8 * 60 * 60_000;
export const LAST_SEEN_COOKIE = "hagious_seen";

/**
 * Política de conteúdo (CSP): o navegador só executa scripts do próprio sistema que tragam o "nonce"
 * desta resposta (e os que eles carregarem, como o SDK da Meta na conexão do WhatsApp).
 * Bloqueia código injetado, plugins, envio de formulários para fora e a abertura do sistema dentro de outros sites.
 */
export function contentSecurityPolicy(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const meta = "https://*.facebook.com https://connect.facebook.net";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Atributos style="" (larguras de barras, por exemplo) precisam de 'unsafe-inline'; CSS não executa código
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.facebook.com https://*.fbcdn.net",
    "font-src 'self'",
    `connect-src 'self'${opts.dev ? " ws: wss:" : ""} ${meta}`,
    `frame-src ${meta}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Cabeçalhos fixos (complementam os de next.config.ts). */
export function securityHeaders(https: boolean): Record<string, string> {
  return {
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups", // popup da Meta precisa conversar com a janela
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    ...(https ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}
