import { describe, expect, it } from "vitest";
import { aggregateTickets, formatBusinessMinutes, rate, resolvePeriod, type MetricRow } from "@/lib/indicators";
import { planState, sinceLabel } from "@/lib/success";

const TODAY = "2026-10-27";

describe("período dos indicadores", () => {
  it("padrão: últimos 30 dias, com hoje incluído", () => {
    expect(resolvePeriod({}, TODAY)).toMatchObject({ key: "30d", from: "2026-09-28", to: TODAY, days: 30 });
  });
  it("períodos rápidos", () => {
    expect(resolvePeriod({ periodo: "7d" }, TODAY)).toMatchObject({ from: "2026-10-21", to: TODAY, days: 7 });
    expect(resolvePeriod({ periodo: "mes" }, TODAY)).toMatchObject({ from: "2026-10-01", to: TODAY });
    expect(resolvePeriod({ periodo: "mes_anterior" }, TODAY)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod({ periodo: "mes_anterior" }, "2026-03-10")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolvePeriod({ periodo: "ano" }, TODAY)).toMatchObject({ from: "2026-01-01" });
  });
  it("personalizado válido", () => {
    expect(resolvePeriod({ de: "2026-08-01", ate: "2026-08-31" }, TODAY)).toMatchObject({ key: "personalizado", days: 31 });
  });
  it("mesmas datas do período rápido continuam como período rápido", () => {
    expect(resolvePeriod({ periodo: "7d", de: "2026-10-21", ate: TODAY }, TODAY).key).toBe("7d");
  });
  it("personalizado inválido volta para o padrão", () => {
    expect(resolvePeriod({ de: "2026-09-10", ate: "2026-09-01" }, TODAY).key).toBe("30d"); // invertido
    expect(resolvePeriod({ de: "2026-10-01", ate: "2026-11-30" }, TODAY).key).toBe("30d"); // futuro
    expect(resolvePeriod({ de: "2024-01-01", ate: "2026-10-01" }, TODAY).key).toBe("30d"); // mais de 1 ano
    expect(resolvePeriod({ de: "2026-02-30", ate: "2026-03-05" }, TODAY).key).toBe("30d"); // data inexistente
    expect(resolvePeriod({ periodo: "abc" }, TODAY).key).toBe("30d");
  });
});

const row = (o: Partial<MetricRow>): MetricRow => ({
  department: "fiscal", category_id: "c1", category_name: "Certidão", assignee_id: "u1", status: "aberto",
  created_at: "2026-10-20T12:00:00Z", first_responded_at: null, first_response_due_at: null, resolved_at: null,
  resolution_due_at: null, first_response_minutes: null, resolution_minutes: null, ...o,
});
const names = { department: (k: string) => k.toUpperCase(), person: (id: string) => `Pessoa ${id}` };
const period = resolvePeriod({ periodo: "mes" }, TODAY); // 01/10 a 27/10

describe("agregação de tickets", () => {
  const rows = [
    // aberto no período, respondido no prazo, concluído no prazo
    row({ first_responded_at: "2026-10-20T13:00:00Z", first_response_due_at: "2026-10-20T14:00:00Z", first_response_minutes: 60,
      status: "concluido", resolved_at: "2026-10-21T12:00:00Z", resolution_due_at: "2026-10-22T12:00:00Z", resolution_minutes: 600 }),
    // aberto no período, resposta atrasada, concluído fora do prazo
    row({ department: "dp", category_id: "c2", category_name: "Admissão", assignee_id: null,
      first_responded_at: "2026-10-20T18:00:00Z", first_response_due_at: "2026-10-20T14:00:00Z", first_response_minutes: 240,
      status: "concluido", resolved_at: "2026-10-25T12:00:00Z", resolution_due_at: "2026-10-23T12:00:00Z", resolution_minutes: 1400 }),
    // aberto ANTES do período, concluído no período
    row({ created_at: "2026-09-25T12:00:00Z", status: "concluido", resolved_at: "2026-10-02T12:00:00Z", resolution_due_at: "2026-10-05T12:00:00Z", resolution_minutes: 200 }),
    // cancelado: não conta como concluído
    row({ status: "cancelado", resolved_at: "2026-10-03T12:00:00Z" }),
    // concluído após o fim do período: fora
    row({ created_at: "2026-09-01T12:00:00Z", status: "concluido", resolved_at: "2026-10-28T12:00:00Z", resolution_minutes: 10 }),
  ];

  it("totais e cumprimento do prazo", () => {
    const { total } = aggregateTickets(rows, period, {}, names);
    expect(total.opened).toBe(3);
    expect(total.concluded).toBe(3);
    expect(total.onTime).toBe(2);
    expect(total.responded).toBe(2);
    expect(total.respondedOnTime).toBe(1);
    expect(total.avgFirstResponse).toBe(150);
    expect(total.avgResolution).toBe(Math.round((600 + 1400 + 200) / 3));
  });
  it("filtros de departamento e responsável", () => {
    expect(aggregateTickets(rows, period, { department: "dp" }, names).total.concluded).toBe(1);
    expect(aggregateTickets(rows, period, { assignee: "nenhum" }, names).total.opened).toBe(1);
    expect(aggregateTickets(rows, period, { assignee: "u1" }, names).total.opened).toBe(2);
  });
  it("agrupa por departamento, tipo e responsável", () => {
    const a = aggregateTickets(rows, period, {}, names);
    expect(a.byDepartment.map((g) => g.label).sort()).toEqual(["DP", "FISCAL"]);
    expect(a.byCategory.find((g) => g.key === "c2")?.onTime).toBe(0);
    expect(a.byAssignee.find((g) => g.key === "nenhum")?.label).toBe("Sem responsável");
    expect(a.byAssignee.find((g) => g.key === "u1")?.label).toBe("Pessoa u1");
  });
  it("sem prazo calculado conta como cumprido", () => {
    const a = aggregateTickets([row({ status: "concluido", resolved_at: "2026-10-10T12:00:00Z" })], period, {}, names);
    expect(a.total.onTime).toBe(1);
  });
  it("sem dados: médias vazias e percentual sem base", () => {
    const a = aggregateTickets([], period, {}, names);
    expect(a.total.avgResolution).toBeNull();
    expect(rate(0, 0)).toBeNull();
    expect(rate(2, 3)).toBe(67);
  });
});

describe("formatação de tempos úteis", () => {
  it("minutos, horas e dias úteis", () => {
    expect(formatBusinessMinutes(null)).toBe("—");
    expect(formatBusinessMinutes(45)).toBe("45 min");
    expect(formatBusinessMinutes(150)).toBe("2,5 h");
    expect(formatBusinessMinutes(1500)).toBe("2,5 dias úteis");
  });
});

describe("sucesso do cliente", () => {
  it("situação da data prevista", () => {
    expect(planState("planejada", "2026-10-20", TODAY)).toMatchObject({ key: "atrasada", tone: "red" });
    expect(planState("planejada", TODAY, TODAY).key).toBe("hoje");
    expect(planState("planejada", "2026-10-28", TODAY).label).toBe("Amanhã");
    expect(planState("planejada", "2026-12-01", TODAY).key).toBe("futura");
    expect(planState("realizada", "2026-10-20", TODAY).key).toBe("encerrada");
  });
  it("tempo sem acompanhamento", () => {
    expect(sinceLabel(null)).toBe("Nunca acompanhado");
    expect(sinceLabel(1)).toBe("Ontem");
    expect(sinceLabel(45)).toBe("Há 45 dias");
    expect(sinceLabel(95)).toBe("Há 3 meses");
  });
});
