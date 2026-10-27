"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireManager, formValues, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation/schemas";
import { isUuid } from "@/lib/validation/ids";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM)");

const settingsSchema = z
  .object({
    work_start: time,
    work_end: time,
    workdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Escolha ao menos um dia"),
    risk_percent: z.coerce.number().int().min(5, "Mínimo 5%").max(90, "Máximo 90%"),
    default_first_response_hours: z.coerce.number().min(0.25, "Mínimo 15 minutos").max(80, "Máximo 80 horas úteis"),
  })
  .refine((s) => s.work_end > s.work_start, { message: "O fim do expediente deve ser depois do início", path: ["work_end"] });

/** Expediente e regras gerais (somente administradores). */
export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse({
    work_start: formData.get("work_start"),
    work_end: formData.get("work_end"),
    workdays: formData.getAll("workdays"),
    risk_percent: formData.get("risk_percent"),
    default_first_response_hours: formData.get("default_first_response_hours"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values: formValues(formData) };
  const s = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("sla_settings")
    .update({
      work_start: s.work_start,
      work_end: s.work_end,
      workdays: [...new Set(s.workdays)].sort(),
      risk_percent: s.risk_percent,
      default_first_response_minutes: Math.round(s.default_first_response_hours * 60),
      needs_review: false,
    })
    .eq("id", 1);
  if (error) {
    console.error("[config] expediente", error);
    return { errors: { _form: "Não foi possível salvar." } };
  }
  revalidatePath("/configuracoes/prazos");
  return { ok: true, message: "Expediente salvo. Vale para os próximos tickets." };
}

const categorySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(120),
  department: z.enum(["contabil", "fiscal", "dp"]),
  resolution_value: z.coerce.number().int("Use número inteiro").min(1, "Mínimo 1").max(365),
  resolution_unit: z.enum(["horas_uteis", "dias_uteis"]),
  first_response_hours: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0.25 && v <= 80), "Entre 0,25 e 80 horas úteis"),
  active: z.boolean(),
});

/** Cria ou edita um tipo de solicitação (gestão). Ao salvar, o valor deixa de ser "a confirmar". */
export async function saveCategoryAction(categoryId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  if (categoryId && !isUuid(categoryId)) return { errors: { _form: "Tipo inválido." } };
  const values = formValues(formData);
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    department: formData.get("department"),
    resolution_value: formData.get("resolution_value"),
    resolution_unit: formData.get("resolution_unit"),
    first_response_hours: formData.get("first_response_hours") ?? "",
    active: categoryId ? formData.get("active") === "on" : true,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const c = parsed.data;
  const row = {
    name: c.name,
    department: c.department,
    resolution_value: c.resolution_value,
    resolution_unit: c.resolution_unit,
    first_response_minutes: c.first_response_hours === null ? null : Math.round(c.first_response_hours * 60),
    active: c.active,
    needs_review: false,
  };
  const supabase = await createClient();
  const { error } = categoryId
    ? await supabase.from("ticket_categories").update(row).eq("id", categoryId)
    : await supabase.from("ticket_categories").insert(row);
  if (error) {
    if (error.code === "23505") return { errors: { name: "Já existe um tipo com este nome neste departamento." }, values };
    console.error("[config] categoria", error);
    return { errors: { _form: "Não foi possível salvar." }, values };
  }
  revalidatePath("/configuracoes/prazos");
  return { ok: true, message: categoryId ? "Tipo atualizado. Vale para os próximos tickets." : "Tipo criado." };
}

const holidaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  name: z.string().trim().min(2, "Informe o nome").max(120),
  scope: z.enum(["nacional", "estadual", "municipal", "empresa"]),
});

export async function addHolidayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const values = formValues(formData);
  const parsed = holidaySchema.safeParse({ day: formData.get("day"), name: formData.get("name"), scope: formData.get("scope") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").insert(parsed.data);
  if (error) {
    if (error.code === "23505") return { errors: { day: "Já existe um feriado nesta data." }, values };
    console.error("[config] feriado", error);
    return { errors: { _form: "Não foi possível salvar." }, values };
  }
  revalidatePath("/configuracoes/prazos");
  return { ok: true, message: "Feriado cadastrado." };
}

export async function removeHolidayAction(day: string) {
  await requireManager();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").delete().eq("day", day);
  if (error) console.error("[config] remover feriado", error);
  revalidatePath("/configuracoes/prazos");
}
