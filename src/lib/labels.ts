import type { Database } from "@/lib/database.types";

type Enums = Database["public"]["Enums"];

export const ROLE_LABEL: Record<Enums["user_role"], string> = {
  admin: "Administrador",
  gestor: "Gestor",
  colaborador: "Colaborador",
};

export const DEPARTMENT_LABEL: Record<Enums["department"], string> = {
  contabil: "Contábil",
  fiscal: "Fiscal",
  dp: "Departamento Pessoal",
  atendimento: "Atendimento",
};

/** Departamentos que executam serviços para o cliente. */
export const OPERATIONAL_DEPARTMENTS = ["contabil", "fiscal", "dp"] as const;

export const CLIENT_STATUS_LABEL: Record<Enums["client_status"], string> = {
  ativo: "Ativo",
  suspenso: "Suspenso",
  encerrado: "Encerrado",
};

export const CLIENT_STATUS_TONE = {
  ativo: "green",
  suspenso: "amber",
  encerrado: "gray",
} as const satisfies Record<Enums["client_status"], string>;

export const TAX_REGIME_LABEL: Record<Enums["tax_regime"], string> = {
  mei: "MEI",
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  outro: "Outro",
};
