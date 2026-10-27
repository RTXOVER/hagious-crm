/*
 * Indicadores gerenciais: cálculos puros (sem banco), testados em tests/indicators.test.ts.
 *
 * COMO CADA NÚMERO É CALCULADO (o período é [início, fim] em datas de Brasília, fim incluído):
 * - Tickets abertos no período: criados dentro do período (qualquer situação atual).
 * - Concluídos no período: situação "concluído" com data de conclusão dentro do período (cancelados não contam).
 * - Cumprimento do prazo: concluídos no período resolvidos até o prazo ÷ concluídos no período.
 *   Ticket sem prazo calculado conta como cumprido (mesma regra da tela do ticket).
 * - 1ª resposta no prazo: tickets com 1ª resposta dentro do período, respondidos até o prazo de 1ª resposta.
 * - Tempo médio de 1ª resposta: média, em horas ÚTEIS (expediente e feriados cadastrados), entre a abertura
 *   e a 1ª resposta dos tickets respondidos no período.
 * - Tempo médio de resolução: média, em horas úteis, entre a abertura e a conclusão dos concluídos no período,
 *   descontado o tempo em "aguardando cliente".
 * - Volume por responsável: tickets abertos no período pelo responsável ATUAL ("Sem responsável" quando vazio).
 * Os filtros de departamento e responsável valem para todos os números de tickets.
 * Tudo respeita as permissões: cada pessoa só soma o que já pode ver.
 */

export type PeriodKey = "7d" | "30d" | "90d" | "mes" | "mes_anterior" | "ano" | "personalizado";
export const PERIOD_OPTIONS: { value: Exclude<PeriodKey, "personalizado">; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "mes", label: "Este mês" },
  { value: "mes_anterior", label: "Mês anterior" },
  { value: "ano", label: "Este ano" },
];

export type Period = { key: PeriodKey; from: string; to: string; days: number };

const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;

/** Converte os parâmetros da URL em um período (datas de Brasília, fim incluído). Padrão: últimos 30 dias. */
export function resolvePeriod(sp: { periodo?: unknown; de?: unknown; ate?: unknown }, today: string): Period {
  const key = PERIOD_OPTIONS.some((o) => o.value === sp.periodo) ? (sp.periodo as PeriodKey) : "30d";
  const preset = presetRange(key, today);
  if (isDay(sp.de) && isDay(sp.ate) && sp.de <= sp.ate && sp.ate <= today && span(sp.de, sp.ate) <= 366) {
    // Mesmas datas do período rápido escolhido (ex.: só mudou o departamento): continua sendo o período rápido
    if (sp.de === preset.from && sp.ate === preset.to) return preset;
    return { key: "personalizado", from: sp.de, to: sp.ate, days: span(sp.de, sp.ate) };
  }
  return preset;
}

function presetRange(key: PeriodKey, today: string): Period {
  let from: string;
  let to = today;
  if (key === "7d") from = shift(today, -6);
  else if (key === "90d") from = shift(today, -89);
  else if (key === "mes") from = `${today.slice(0, 7)}-01`;
  else if (key === "ano") from = `${today.slice(0, 4)}-01-01`;
  else if (key === "mes_anterior") {
    const first = `${today.slice(0, 7)}-01`;
    to = shift(first, -1);
    from = `${to.slice(0, 7)}-01`;
  } else from = shift(today, -29);
  return { key, from, to, days: span(from, to) };
}

/** Limites do período como instantes (Brasília não tem horário de verão desde 2019: UTC−3). */
export const periodBounds = (p: Period) => ({ start: `${p.from}T00:00:00-03:00`, end: `${shift(p.to, 1)}T00:00:00-03:00` });

export type MetricRow = {
  department: string;
  category_id: string;
  category_name: string;
  assignee_id: string | null;
  status: string;
  created_at: string;
  first_responded_at: string | null;
  first_response_due_at: string | null;
  resolved_at: string | null;
  resolution_due_at: string | null;
  first_response_minutes: number | null;
  resolution_minutes: number | null;
};

export type Group = {
  key: string;
  label: string;
  opened: number;
  concluded: number;
  onTime: number;
  responded: number;
  respondedOnTime: number;
  avgFirstResponse: number | null;
  avgResolution: number | null;
};

const within = (ts: string | null, start: number, end: number) => !!ts && Date.parse(ts) >= start && Date.parse(ts) < end;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

function summarize(rows: MetricRow[], start: number, end: number, key: string, label: string): Group {
  const concluded = rows.filter((r) => r.status === "concluido" && within(r.resolved_at, start, end));
  const responded = rows.filter((r) => within(r.first_responded_at, start, end));
  return {
    key,
    label,
    opened: rows.filter((r) => within(r.created_at, start, end)).length,
    concluded: concluded.length,
    onTime: concluded.filter((r) => !r.resolution_due_at || Date.parse(r.resolved_at!) <= Date.parse(r.resolution_due_at)).length,
    responded: responded.length,
    respondedOnTime: responded.filter((r) => !r.first_response_due_at || Date.parse(r.first_responded_at!) <= Date.parse(r.first_response_due_at)).length,
    avgFirstResponse: avg(responded.map((r) => r.first_response_minutes).filter((m): m is number => m !== null)),
    avgResolution: avg(concluded.map((r) => r.resolution_minutes).filter((m): m is number => m !== null)),
  };
}

function groupBy(rows: MetricRow[], keyOf: (r: MetricRow) => string) {
  const m = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

export function aggregateTickets(
  all: MetricRow[],
  period: Period,
  filters: { department?: string; assignee?: string | "nenhum" },
  names: { department: (k: string) => string; person: (id: string) => string },
) {
  const { start: s, end: e } = periodBounds(period);
  const start = Date.parse(s);
  const end = Date.parse(e);
  const rows = all.filter(
    (r) =>
      (!filters.department || r.department === filters.department) &&
      (!filters.assignee || (filters.assignee === "nenhum" ? r.assignee_id === null : r.assignee_id === filters.assignee)),
  );
  const sortGroups = (gs: Group[]) => gs.sort((a, b) => b.opened + b.concluded - (a.opened + a.concluded) || a.label.localeCompare(b.label));
  const byDepartment = sortGroups(
    [...groupBy(rows, (r) => r.department)].map(([k, rs]) => summarize(rs, start, end, k, names.department(k))),
  );
  const byCategory = sortGroups(
    [...groupBy(rows, (r) => r.category_id)].map(([k, rs]) => summarize(rs, start, end, k, rs[0].category_name)),
  );
  const byAssignee = sortGroups(
    [...groupBy(rows, (r) => r.assignee_id ?? "nenhum")].map(([k, rs]) => summarize(rs, start, end, k, k === "nenhum" ? "Sem responsável" : names.person(k))),
  );
  return { total: summarize(rows, start, end, "total", "Total"), byDepartment, byCategory, byAssignee };
}

/** Percentual inteiro; null quando não há base. */
export const rate = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : null);

/** Minutos úteis em texto curto: "45 min", "3,5 h", "2,1 dias úteis" (dia útil = expediente configurado). */
export function formatBusinessMinutes(min: number | null, workdayMinutes = 600, locale = "pt-BR"): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  const n = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (min < workdayMinutes * 2) return `${n(min / 60)} h`;
  return `${n(min / workdayMinutes)} dias úteis`;
}
