import type { Database } from "@/lib/database.types";
import type { Tone } from "@/components/page-header";

type E = Database["public"]["Enums"];
export type TicketRow = Database["public"]["Tables"]["tickets"]["Row"];

export const STATUS_LABEL: Record<E["ticket_status"], string> = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando cliente",
  concluido: "Concluído",
  cancelado: "Cancelado",
};
export const STATUS_TONE: Record<E["ticket_status"], Tone> = {
  aberto: "blue",
  em_andamento: "green",
  aguardando_cliente: "amber",
  concluido: "gray",
  cancelado: "gray",
};
export const OPEN_STATUSES = ["aberto", "em_andamento", "aguardando_cliente"] as const;

/** Próximas situações permitidas (mesma regra do banco). Reabrir é só da gestão. */
export const NEXT_STATUS: Record<E["ticket_status"], E["ticket_status"][]> = {
  aberto: ["em_andamento", "aguardando_cliente", "concluido", "cancelado"],
  em_andamento: ["aguardando_cliente", "concluido", "cancelado"],
  aguardando_cliente: ["em_andamento", "concluido", "cancelado"],
  concluido: ["em_andamento"],
  cancelado: ["em_andamento"],
};

export const PRIORITY_LABEL: Record<E["ticket_priority"], string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};
export const PRIORITY_TONE: Record<E["ticket_priority"], Tone> = { baixa: "gray", normal: "blue", alta: "amber", urgente: "red" };

export const ORIGIN_LABEL: Record<E["ticket_origin"], string> = {
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  email: "E-mail",
  presencial: "Presencial",
  interno: "Interno",
};

export const UNIT_LABEL: Record<E["sla_unit"], [string, string]> = {
  horas_uteis: ["hora útil", "horas úteis"],
  dias_uteis: ["dia útil", "dias úteis"],
};
export const formatSla = (value: number, unit: E["sla_unit"]) => `${value} ${UNIT_LABEL[unit][value === 1 ? 0 : 1]}`;

export const ticketNumber = (n: number) => `#${String(n).padStart(4, "0")}`;

export type SlaState = { key: "no_prazo" | "em_risco" | "atrasado" | "pausado" | "cumprido" | "descumprido" | "cancelado"; label: string; tone: Tone };

/**
 * Situação do prazo de RESOLUÇÃO (mesmos critérios dos alertas do banco):
 * - em aberto: atrasado se passou do prazo; em risco a partir do horário de alerta; senão no prazo
 * - aguardando cliente: pausado (o prazo é estendido ao retomar)
 * - concluído: cumprido se resolvido até o prazo
 */
export function slaState(t: Pick<TicketRow, "status" | "resolution_due_at" | "risk_at" | "resolved_at">, now = new Date()): SlaState {
  const due = t.resolution_due_at ? new Date(t.resolution_due_at) : null;
  if (t.status === "cancelado") return { key: "cancelado", label: "Cancelado", tone: "gray" };
  if (t.status === "concluido") {
    const ok = !due || (t.resolved_at && new Date(t.resolved_at) <= due);
    return ok ? { key: "cumprido", label: "Prazo cumprido", tone: "green" } : { key: "descumprido", label: "Concluído com atraso", tone: "red" };
  }
  if (t.status === "aguardando_cliente") return { key: "pausado", label: "Prazo pausado", tone: "gray" };
  if (due && now > due) return { key: "atrasado", label: "Atrasado", tone: "red" };
  if (t.risk_at && now >= new Date(t.risk_at)) return { key: "em_risco", label: "Em risco", tone: "amber" };
  return { key: "no_prazo", label: "No prazo", tone: "green" };
}

/** Primeira resposta ainda não dada e prazo de 1ª resposta já vencido. */
export function firstResponseLate(t: Pick<TicketRow, "first_responded_at" | "first_response_due_at">, now = new Date()): boolean {
  return !t.first_responded_at && !!t.first_response_due_at && now > new Date(t.first_response_due_at);
}

/** "em 3 h", "há 2 dias" — tempo corrido até/desde a data (o prazo em si já considera dias úteis). */
export function relativeTime(iso: string | null, now = new Date()): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const text =
    min < 60 ? `${min} min` : min < 60 * 48 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dias`;
  return diff >= 0 ? `em ${text}` : `há ${text}`;
}

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
export const formatDateTime = (iso: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
