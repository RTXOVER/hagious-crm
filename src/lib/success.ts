import type { Database } from "@/lib/database.types";
import type { Tone } from "@/components/page-header";
import { daysBetween } from "@/lib/documents";

type E = Database["public"]["Enums"];
export type SuccessType = E["success_type"];
export type SuccessStatus = E["success_status"];
export type SuccessRecurrence = E["success_recurrence"];

export const SUCCESS_TYPES = ["contato_trimestral", "reuniao_saude_financeira", "alerta_tributario", "acao_consultiva", "outro"] as const;
export const SUCCESS_RECURRENCES = ["nenhuma", "trimestral", "semestral", "anual"] as const;

export const SUCCESS_TYPE_LABEL: Record<SuccessType, string> = {
  contato_trimestral: "Contato de acompanhamento",
  reuniao_saude_financeira: "Reunião de saúde financeira",
  alerta_tributario: "Alerta tributário preventivo",
  acao_consultiva: "Ação consultiva",
  outro: "Outra ação",
};
export const SUCCESS_TYPE_HINT: Record<SuccessType, string> = {
  contato_trimestral: "Ligação ou mensagem periódica para saber como o cliente está",
  reuniao_saude_financeira: "Apresentar números, margens e pontos de atenção",
  alerta_tributario: "Avisar antes de uma mudança, prazo ou risco fiscal",
  acao_consultiva: "Sugestão de melhoria: regime, custos, processos",
  outro: "Qualquer outra ação proativa",
};
/** Objetivo sugerido ao escolher o tipo (a pessoa pode mudar). */
export const SUCCESS_TYPE_OBJECTIVE: Record<SuccessType, string> = {
  contato_trimestral: "Contato trimestral de acompanhamento",
  reuniao_saude_financeira: "Reunião de saúde financeira",
  alerta_tributario: "Alerta tributário preventivo",
  acao_consultiva: "",
  outro: "",
};
export const SUCCESS_TYPE_DEFAULT_RECURRENCE: Record<SuccessType, SuccessRecurrence> = {
  contato_trimestral: "trimestral",
  reuniao_saude_financeira: "semestral",
  alerta_tributario: "nenhuma",
  acao_consultiva: "nenhuma",
  outro: "nenhuma",
};

export const SUCCESS_STATUS_LABEL: Record<SuccessStatus, string> = { planejada: "Planejada", realizada: "Realizada", cancelada: "Cancelada" };
export const SUCCESS_STATUS_TONE: Record<SuccessStatus, Tone> = { planejada: "blue", realizada: "green", cancelada: "gray" };

export const RECURRENCE_LABEL: Record<SuccessRecurrence, string> = {
  nenhuma: "Uma vez",
  trimestral: "A cada 3 meses",
  semestral: "A cada 6 meses",
  anual: "Uma vez por ano",
};

export const SUCCESS_EVENT_LABEL: Record<string, string> = {
  criada: "Ação programada",
  reagendada: "Reagendada",
  realizada: "Realizada",
  cancelada: "Cancelada",
  reaberta: "Reaberta",
  responsavel: "Responsável alterado",
  comentario: "Comentário",
};

export type PlanState = { key: "atrasada" | "hoje" | "semana" | "futura" | "encerrada"; label: string; tone: Tone };

/** Situação da data prevista (mesmos critérios dos lembretes: aviso no dia e quando atrasa). */
export function planState(status: SuccessStatus, plannedDate: string, today: string): PlanState {
  if (status !== "planejada") return { key: "encerrada", label: SUCCESS_STATUS_LABEL[status], tone: SUCCESS_STATUS_TONE[status] };
  const left = daysBetween(today, plannedDate);
  if (left < 0) return { key: "atrasada", label: `Atrasada há ${-left} ${-left === 1 ? "dia" : "dias"}`, tone: "red" };
  if (left === 0) return { key: "hoje", label: "Para hoje", tone: "amber" };
  if (left <= 7) return { key: "semana", label: left === 1 ? "Amanhã" : `Em ${left} dias`, tone: "amber" };
  return { key: "futura", label: `Em ${left} dias`, tone: "green" };
}

/** Texto curto de "há quanto tempo" para o último acompanhamento. */
export function sinceLabel(days: number | null): string {
  if (days === null) return "Nunca acompanhado";
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 60) return `Há ${days} dias`;
  const months = Math.floor(days / 30);
  return `Há ${months} ${months === 1 ? "mês" : "meses"}`;
}
