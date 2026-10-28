import { z } from "zod";
import { isValidCnpj, normalizeCnpj, normalizeWhatsapp } from "./cnpj";

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

/** AAAA-MM-DD que existe no calendário (recusa 31/02, mês 13...). */
export const isRealDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || isRealDate(v), "Data inválida");

export const clientSchema = z.object({
  legal_name: z.string().trim().min(2, "Informe a razão social").max(200),
  trade_name: optionalText(200),
  cnpj: z
    .string()
    .transform(normalizeCnpj)
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
    email: z.string().trim().toLowerCase().pipe(z.email("E-mail inválido")),
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

const COMMON_PASSWORD_PARTS = ["senha", "password", "hagious", "123456", "654321", "abcdef", "qwerty", "asdfgh", "admin", "brasil", "mudar", "trocar"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Motivo para recusar uma senha previsível (ou null se estiver boa). Complementa o mínimo de 10 caracteres,
 * letra e número: bloqueia palavras óbvias, sequências, repetições e partes do e-mail ou do nome da pessoa.
 */
export function weakPasswordReason(password: string, email?: string, fullName?: string): string | null {
  const p = norm(password);
  if (COMMON_PASSWORD_PARTS.some((w) => p.includes(w))) return "Senha muito previsível (evite palavras como “senha”, “hagious” ou sequências).";
  if (/(.)\1{3,}/.test(p)) return "Evite repetir o mesmo caractere várias vezes seguidas.";
  if (new Set(p).size < 5) return "Use mais caracteres diferentes.";
  const local = email ? norm(email.split("@")[0]) : "";
  const parts = [local, ...(fullName ? norm(fullName).split(/\s+/) : []), ...local.split(/[._\-+]/)].filter((x) => x.length >= 4);
  if (parts.some((x) => p.includes(x))) return "A senha não pode conter seu nome ou seu e-mail.";
  return null;
}
