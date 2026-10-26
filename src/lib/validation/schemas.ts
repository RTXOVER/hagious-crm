import { z } from "zod";
import { isValidCnpj, normalizeWhatsapp, onlyDigits } from "./cnpj";

// Campo de texto opcional: string vazia vira null
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || z.email().safeParse(v).success, "E-mail inválido");

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida");

export const clientSchema = z.object({
  legal_name: z.string().trim().min(2, "Informe a razão social").max(200),
  trade_name: optionalText(200),
  cnpj: z
    .string()
    .transform(onlyDigits)
    .refine(isValidCnpj, "CNPJ inválido (verifique os dígitos)"),
  tax_regime: z.enum(["mei", "simples_nacional", "lucro_presumido", "lucro_real", "outro"]),
  status: z.enum(["ativo", "suspenso", "encerrado"]),
  email: optionalEmail,
  phone: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : normalizeWhatsapp(v) ?? "invalid"))
    .nullable()
    .optional()
    .transform((v) => v ?? null)
    .refine((v) => v !== "invalid", "Telefone inválido. Use DDD + número"),
  address: optionalText(400),
  notes: optionalText(4000),
  client_since: optionalDate,
});
export type ClientInput = z.infer<typeof clientSchema>;

export const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome").max(120),
    job_title: optionalText(120),
    email: optionalEmail,
    whatsapp: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : normalizeWhatsapp(v) ?? "invalid"))
      .nullable()
      .optional()
      .transform((v) => v ?? null)
      .refine((v) => v !== "invalid", "WhatsApp inválido. Use DDD + número"),
    is_primary: z.boolean(),
    whatsapp_opt_in: z.boolean(),
  })
  .refine((c) => !c.whatsapp_opt_in || c.whatsapp, {
    message: "Para registrar o consentimento, informe o WhatsApp",
    path: ["whatsapp_opt_in"],
  });
export type ContactInput = z.infer<typeof contactSchema>;

export const serviceSchema = z.object({
  department: z.enum(["contabil", "fiscal", "dp"]),
  description: z.string().trim().min(2, "Descreva o serviço").max(200),
  started_on: optionalDate,
});

export const newUserSchema = z
  .object({
    full_name: z.string().trim().min(2, "Informe o nome").max(120),
    email: z.email("E-mail inválido").transform((v) => v.toLowerCase()),
    role: z.enum(["admin", "gestor", "colaborador"]),
    department: z
      .enum(["contabil", "fiscal", "dp", "atendimento", ""])
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((u) => u.role !== "colaborador" || u.department, {
    message: "Colaboradores precisam de um departamento",
    path: ["department"],
  });

export const passwordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Mínimo de 10 caracteres")
      .regex(/[a-zA-Z]/, "Inclua ao menos uma letra")
      .regex(/\d/, "Inclua ao menos um número"),
    confirm: z.string(),
  })
  .refine((p) => p.password === p.confirm, {
    message: "As senhas não conferem",
    path: ["confirm"],
  });

/** Converte erros do zod em { campo: mensagem } para exibir no formulário. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
