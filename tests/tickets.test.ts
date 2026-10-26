import { describe, expect, it } from "vitest";
import { NEXT_STATUS, firstResponseLate, formatSla, relativeTime, slaState, ticketNumber } from "@/lib/tickets";

const now = new Date("2026-10-27T12:00:00-03:00");
const iso = (s: string) => new Date(s).toISOString();

describe("Situação do prazo (mesma regra dos alertas do banco)", () => {
  const base = { resolution_due_at: iso("2026-10-27T17:00:00-03:00"), risk_at: iso("2026-10-27T14:00:00-03:00"), resolved_at: null };

  it("no prazo antes do horário de alerta", () => {
    expect(slaState({ ...base, status: "em_andamento" }, now).key).toBe("no_prazo");
  });
  it("em risco a partir do horário de alerta", () => {
    expect(slaState({ ...base, status: "aberto" }, new Date("2026-10-27T15:00:00-03:00")).key).toBe("em_risco");
  });
  it("atrasado depois do prazo", () => {
    expect(slaState({ ...base, status: "aberto" }, new Date("2026-10-27T17:01:00-03:00")).key).toBe("atrasado");
  });
  it("aguardando cliente fica pausado mesmo após o prazo original", () => {
    expect(slaState({ ...base, status: "aguardando_cliente" }, new Date("2026-10-28T09:00:00-03:00")).key).toBe("pausado");
  });
  it("concluído no prazo x com atraso", () => {
    expect(slaState({ ...base, status: "concluido", resolved_at: iso("2026-10-27T16:00:00-03:00") }, now).key).toBe("cumprido");
    expect(slaState({ ...base, status: "concluido", resolved_at: iso("2026-10-27T18:00:00-03:00") }, now).key).toBe("descumprido");
  });
  it("cancelado não conta como atraso", () => {
    expect(slaState({ ...base, status: "cancelado" }, new Date("2026-11-30T00:00:00-03:00")).key).toBe("cancelado");
  });
});

describe("Primeira resposta", () => {
  it("atrasada só se ainda não respondida e o prazo passou", () => {
    const due = iso("2026-10-27T10:00:00-03:00");
    expect(firstResponseLate({ first_responded_at: null, first_response_due_at: due }, now)).toBe(true);
    expect(firstResponseLate({ first_responded_at: iso("2026-10-27T11:00:00-03:00"), first_response_due_at: due }, now)).toBe(false);
    expect(firstResponseLate({ first_responded_at: null, first_response_due_at: iso("2026-10-27T13:00:00-03:00") }, now)).toBe(false);
  });
});

describe("Regras de exibição", () => {
  it("fluxo de situação igual ao do banco", () => {
    expect(NEXT_STATUS.em_andamento).not.toContain("aberto");
    expect(NEXT_STATUS.concluido).toEqual(["em_andamento"]);
  });
  it("textos", () => {
    expect(formatSla(1, "dias_uteis")).toBe("1 dia útil");
    expect(formatSla(4, "horas_uteis")).toBe("4 horas úteis");
    expect(ticketNumber(12)).toBe("#0012");
    expect(relativeTime(iso("2026-10-27T15:00:00-03:00"), now)).toBe("em 3 h");
    expect(relativeTime(iso("2026-10-24T12:00:00-03:00"), now)).toBe("há 3 dias");
  });
});
