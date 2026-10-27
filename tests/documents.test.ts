import { describe, expect, it } from "vitest";
import { addDays, daysBetween, describeRule, dueState, formatDate, stageLabel, todaySP } from "@/lib/documents";

describe("documentos: regras de exibição", () => {
  it("situação do vencimento", () => {
    expect(dueState("pendente", "2026-11-10", "2026-11-12")).toMatchObject({ key: "atrasado", label: "Atrasado há 2 dias", tone: "red" });
    expect(dueState("pendente", "2026-11-11", "2026-11-12").label).toBe("Atrasado há 1 dia");
    expect(dueState("pendente", "2026-11-12", "2026-11-12")).toMatchObject({ key: "hoje", label: "Vence hoje" });
    expect(dueState("pendente", "2026-11-13", "2026-11-12").label).toBe("Vence amanhã");
    expect(dueState("pendente", "2026-11-17", "2026-11-12")).toMatchObject({ key: "proximo", tone: "amber" });
    expect(dueState("pendente", "2026-11-30", "2026-11-12")).toMatchObject({ key: "no_prazo", tone: "green" });
    expect(dueState("recebido", "2026-11-01", "2026-11-12")).toMatchObject({ key: "encerrado", label: "Recebido" });
  });

  it("datas sem deslocar o dia pelo fuso", () => {
    expect(formatDate("2026-11-01")).toBe("01/11/2026");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    // 23h em Brasília ainda é o mesmo dia (já é dia seguinte em UTC)
    expect(todaySP(new Date("2026-11-11T02:30:00Z"))).toBe("2026-11-10");
  });

  it("descrição das regras", () => {
    expect(describeRule("mensal", 10, null)).toBe("Todo mês, dia 10");
    expect(describeRule("mensal", 31, null)).toBe("Todo mês, último dia");
    expect(describeRule("trimestral", 15, 1)).toBe("Trimestral, dia 15 (jan, abr, jul, out)");
    expect(describeRule("semestral", 5, 6)).toBe("Semestral, dia 5 (jun, dez)");
    expect(describeRule("anual", 30, 4)).toBe("Todo ano, dia 30 de abril");
  });

  it("rótulo das etapas", () => {
    expect(stageLabel(0)).toBe("No dia");
    expect(stageLabel(1)).toBe("1 dia antes");
    expect(stageLabel(5)).toBe("5 dias antes");
  });
});
