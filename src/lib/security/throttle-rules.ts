/*
 * Regras do bloqueio contra tentativas de senha (força bruta). Funções puras, testadas em tests/security.test.ts.
 * - Por conta: 5 senhas erradas seguidas (desde o último acesso certo) em 15 minutos → bloqueia por 15 minutos.
 * - Por endereço de rede: 20 erros em 15 minutos (qualquer conta) → bloqueia o endereço por 15 minutos.
 */

export const ACCOUNT_LIMIT = { max: 5, windowMs: 15 * 60_000 };
export const IP_LIMIT = { max: 20, windowMs: 15 * 60_000 };

export type Attempt = { success: boolean; at: number };

/** Devolve até quando está bloqueado (ms) ou null. "attempts" pode vir em qualquer ordem. */
export function blockedUntil(attempts: Attempt[], now: number, limit: { max: number; windowMs: number }, resetOnSuccess = true): number | null {
  // Sem limite superior: o relógio do banco pode estar alguns segundos à frente do servidor do site
  const recent = attempts.filter((a) => a.at > now - limit.windowMs).sort((a, b) => a.at - b.at);
  let failures = recent;
  if (resetOnSuccess) {
    const lastOk = recent.findLastIndex((a) => a.success);
    failures = recent.slice(lastOk + 1);
  }
  failures = failures.filter((a) => !a.success);
  if (failures.length < limit.max) return null;
  // Bloqueado até a tentativa errada que "abriu" a sequência sair da janela
  const first = failures[failures.length - limit.max];
  return first.at + limit.windowMs;
}

/** Minutos restantes (arredondado para cima, mínimo 1). */
export const minutesLeft = (until: number, now: number) => Math.max(1, Math.ceil((until - now) / 60_000));

/** Primeiro endereço da cadeia "x-forwarded-for" (o do visitante), limitado e sem caracteres estranhos. */
export function clientIp(forwardedFor: string | null, realIp: string | null): string {
  const first = (forwardedFor ?? "").split(",")[0]?.trim() || (realIp ?? "").trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : "desconhecido";
}
