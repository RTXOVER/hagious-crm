import type { Database } from "@/lib/database.types";
import type { Tone } from "@/components/page-header";

type E = Database["public"]["Enums"];

export const DOC_STATUS_LABEL: Record<E["doc_status"], string> = {
  pendente: "Pendente",
  recebido: "Recebido",
  dispensado: "Dispensado",
  nao_exigivel: "Não exigível",
};
export const DOC_STATUS_TONE: Record<E["doc_status"], Tone> = {
  pendente: "blue",
  recebido: "green",
  dispensado: "gray",
  nao_exigivel: "gray",
};

export const PERIODICITY_LABEL: Record<E["doc_periodicity"], string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};
export const PERIODICITIES = ["mensal", "trimestral", "semestral", "anual"] as const;

export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const REMINDER_STATUS_LABEL: Record<E["reminder_status"], string> = {
  na_fila: "Na fila",
  enviado: "Enviado",
  falhou: "Falhou",
  cancelado: "Cancelado",
  sem_canal: "Sem destinatário",
};
export const REMINDER_STATUS_TONE: Record<E["reminder_status"], Tone> = {
  na_fila: "blue",
  enviado: "green",
  falhou: "red",
  cancelado: "gray",
  sem_canal: "amber",
};
export const CHANNEL_LABEL: Record<E["reminder_channel"], string> = { interno: "Aviso interno", whatsapp: "WhatsApp" };

/** "Todo dia 10", "Trimestral, dia 15 (jan, abr, jul, out)", "Anual, 30 de abril". */
export function describeRule(periodicity: E["doc_periodicity"], dueDay: number, firstMonth: number | null): string {
  const day = dueDay >= 31 ? "último dia" : `dia ${dueDay}`;
  if (periodicity === "mensal") return `Todo mês, ${day}`;
  const step = { trimestral: 3, semestral: 6, anual: 12 }[periodicity];
  const start = (firstMonth ?? 1) - 1;
  const months = Array.from({ length: 12 / step }, (_, i) => MONTHS[(start + i * step) % 12].slice(0, 3));
  if (periodicity === "anual") return `Todo ano, ${dueDay >= 31 ? "último dia" : `dia ${dueDay}`} de ${MONTHS[start]}`;
  return `${PERIODICITY_LABEL[periodicity]}, ${day} (${months.join(", ")})`;
}

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília. */
export function todaySP(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

/** Dias corridos entre duas datas AAAA-MM-DD (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type DueState = { key: "atrasado" | "hoje" | "proximo" | "no_prazo" | "encerrado"; label: string; tone: Tone };

/** Situação do vencimento de uma pendência (mesmos critérios dos lembretes e do relatório crítico). */
export function dueState(status: E["doc_status"], dueDate: string, today: string, soonDays = 5): DueState {
  if (status !== "pendente") return { key: "encerrado", label: DOC_STATUS_LABEL[status], tone: DOC_STATUS_TONE[status] };
  const left = daysBetween(today, dueDate);
  if (left < 0) return { key: "atrasado", label: `Atrasado há ${-left} ${-left === 1 ? "dia" : "dias"}`, tone: "red" };
  if (left === 0) return { key: "hoje", label: "Vence hoje", tone: "amber" };
  if (left <= soonDays) return { key: "proximo", label: left === 1 ? "Vence amanhã" : `Vence em ${left} dias`, tone: "amber" };
  return { key: "no_prazo", label: `Vence em ${left} dias`, tone: "green" };
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
/** Formata uma data AAAA-MM-DD sem deslocar o dia por causa do fuso. */
export const formatDate = (d: string | null) => (d ? dateFmt.format(new Date(`${d}T12:00:00Z`)) : "—");

/** Rótulo da etapa do lembrete: "5 dias antes", "No dia". */
export const stageLabel = (daysBefore: number) =>
  daysBefore === 0 ? "No dia" : `${daysBefore} ${daysBefore === 1 ? "dia" : "dias"} antes`;
