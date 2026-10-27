import type { SelectOption } from "@/components/ui/select";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";

/** Cor de identificação de cada departamento (bolinha nas listas). */
export const DEPARTMENT_DOT: Record<string, string> = {
  contabil: "#1f8a6a",
  fiscal: "#2f6fc4",
  dp: "#c27a12",
  atendimento: "#8a5cd6",
};

const DEP_BADGE: Record<string, string> = { contabil: "CT", fiscal: "FI", dp: "DP", atendimento: "AT" };

export function departmentOptions(opts: { all?: string; includeAtendimento?: boolean } = {}): SelectOption[] {
  const deps = opts.includeAtendimento ? [...OPERATIONAL_DEPARTMENTS, "atendimento" as const] : OPERATIONAL_DEPARTMENTS;
  return [
    ...(opts.all !== undefined ? [{ value: "", label: opts.all, badge: "∗" }] : []),
    ...deps.map((d) => ({ value: d, label: DEPARTMENT_LABEL[d], badge: DEP_BADGE[d] })),
  ];
}

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Pessoas da equipe, com iniciais e departamento; quem é do departamento informado aparece primeiro. */
export function peopleOptions(
  people: { id: string; full_name: string; department: string | null }[],
  opts: { empty?: string; emptyHint?: string; department?: string } = {},
): SelectOption[] {
  const sorted = [...people].sort(
    (a, b) => Number(b.department === opts.department) - Number(a.department === opts.department) || a.full_name.localeCompare(b.full_name),
  );
  return [
    ...(opts.empty !== undefined ? [{ value: "", label: opts.empty, hint: opts.emptyHint, badge: "—" }] : []),
    ...sorted.map((p) => ({
      value: p.id,
      label: p.full_name,
      badge: initials(p.full_name),
      hint: p.department ? DEPARTMENT_LABEL[p.department as keyof typeof DEPARTMENT_LABEL] : "Gestão",
    })),
  ];
}
