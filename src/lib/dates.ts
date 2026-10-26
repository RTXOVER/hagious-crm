/** Data/hora atual em ISO (função separada para uso em componentes do servidor). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Data/hora (ISO) de N dias atrás. Usado em filtros como "cadastrados nos últimos 30 dias". */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
