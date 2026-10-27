"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireProfile, formValues, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation/schemas";
import { isUuid } from "@/lib/validation/ids";
import { PERIODICITIES } from "@/lib/documents";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data");
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isUuid(v), "Seleção inválida");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** Traduz erros do banco para mensagens claras. */
function dbMessage(error: { code?: string; message: string }): string {
  const m = error.message ?? "";
  if (m.includes("dispensa_motivada")) return "Informe o motivo.";
  if (m.includes("vencimento de documentos pendentes")) return "Só é possível mudar o vencimento de documentos pendentes.";
  if (m.includes("client_documents_period_uq")) return "Já existe uma pendência desta exigência com esse vencimento.";
  if (m.includes("document_requirements_client_id_document_type_id_key")) return "Este cliente já tem uma exigência deste documento.";
  if (m.includes("inativo")) return "Este tipo de documento está inativo.";
  if (error.code === "42501" || m.includes("row-level security")) return "Você não tem permissão para esta operação.";
  console.error("[documentos]", error);
  return "Não foi possível concluir a operação. Tente novamente.";
}

function refresh(clientId?: string | null, docId?: string) {
  revalidatePath("/documentos");
  if (docId) revalidatePath(`/documentos/${docId}`);
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/");
}

// ---------------- Pendência avulsa ----------------

const docSchema = z.object({
  client_id: z.string().refine(isUuid, "Escolha o cliente"),
  document_type_id: z.string().refine(isUuid, "Escolha o documento"),
  due_date: isoDate,
  title: optionalText(160),
  responsible_id: optionalUuid,
});

export async function createDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const values = formValues(formData);
  const parsed = docSchema.safeParse({
    client_id: formData.get("client_id") ?? "",
    document_type_id: formData.get("document_type_id") ?? "",
    due_date: formData.get("due_date") ?? "",
    title: formData.get("title") ?? "",
    responsible_id: formData.get("responsible_id") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  // O banco completa título e departamento a partir do tipo de documento
  const { data, error } = await supabase
    .from("client_documents")
    .insert({ ...parsed.data, title: parsed.data.title ?? "" })
    .select("id")
    .single();
  if (error) return { errors: { _form: dbMessage(error) }, values };
  refresh(parsed.data.client_id);
  redirect(`/documentos/${data.id}?criado=1`);
}

// ---------------- Situação, vencimento e responsável ----------------

const STATUSES = ["pendente", "recebido", "dispensado", "nao_exigivel"] as const;

export async function setDocStatusAction(docId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(docId)) return { errors: { _form: "Documento inválido." } };
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(status)) return { errors: { _form: "Situação inválida." } };
  if ((status === "dispensado" || status === "nao_exigivel") && note.length < 3) {
    return { errors: { note: "Explique o motivo (fica registrado no histórico)." } };
  }
  if (note.length > 1000) return { errors: { note: "Texto muito longo." } };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_documents")
    .update({ status: status as (typeof STATUSES)[number], status_note: note || null })
    .eq("id", docId)
    .select("client_id");
  if (error) return { errors: { _form: dbMessage(error) } };
  if (!data?.length) return { errors: { _form: "Você não tem permissão para alterar este documento." } };
  refresh(data[0].client_id, docId);
  const msg = { recebido: "Recebimento registrado. Os lembretes foram encerrados.", dispensado: "Documento dispensado.", nao_exigivel: "Marcado como não exigível.", pendente: "Documento voltou a ficar pendente." }[status as (typeof STATUSES)[number]];
  return { ok: true, message: msg };
}

export async function changeDueDateAction(docId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(docId)) return { errors: { _form: "Documento inválido." } };
  const due = isoDate.safeParse(formData.get("due_date") ?? "");
  if (!due.success) return { errors: { due_date: "Informe a nova data." } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_documents").update({ due_date: due.data }).eq("id", docId).select("client_id");
  if (error) return { errors: { _form: dbMessage(error) } };
  if (!data?.length) return { errors: { _form: "Você não tem permissão para alterar este documento." } };
  refresh(data[0].client_id, docId);
  return { ok: true, message: "Vencimento alterado. Os lembretes recomeçam a partir da nova data." };
}

export async function setDocResponsibleAction(docId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const resp = String(formData.get("responsible_id") ?? "");
  if (!isUuid(docId) || (resp && !isUuid(resp))) return { errors: { _form: "Seleção inválida." } };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_documents")
    .update({ responsible_id: resp || null })
    .eq("id", docId)
    .select("client_id");
  if (error) return { errors: { _form: dbMessage(error) } };
  if (!data?.length) return { errors: { _form: "Você não tem permissão para alterar este documento." } };
  refresh(data[0].client_id, docId);
  return { ok: true, message: "Responsável atualizado." };
}

// ---------------- Exigências do cliente ----------------

const reqSchema = z
  .object({
    document_type_id: z.string().refine(isUuid, "Escolha o documento"),
    periodicity: z.enum(PERIODICITIES),
    due_day: z.coerce.number().int("Dia inválido").min(1, "Entre 1 e 31").max(31, "Entre 1 e 31"),
    first_month: z.coerce.number().int().min(1).max(12).nullable(),
    responsible_id: optionalUuid,
    starts_on: isoDate,
    ends_on: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida"),
    notes: optionalText(1000),
  })
  .refine((r) => r.periodicity === "mensal" || r.first_month !== null, { message: "Escolha o mês", path: ["first_month"] })
  .refine((r) => !r.ends_on || r.ends_on >= r.starts_on, { message: "O fim deve ser depois do início", path: ["ends_on"] });

export async function saveRequirementAction(
  clientId: string,
  requirementId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(clientId) || (requirementId && !isUuid(requirementId))) return { errors: { _form: "Seleção inválida." } };
  const values = formValues(formData);
  const parsed = reqSchema.safeParse({
    document_type_id: formData.get("document_type_id") ?? "",
    periodicity: formData.get("periodicity"),
    due_day: formData.get("due_day"),
    first_month: formData.get("periodicity") === "mensal" ? null : formData.get("first_month") || null,
    responsible_id: formData.get("responsible_id") ?? "",
    starts_on: formData.get("starts_on") ?? "",
    ends_on: formData.get("ends_on") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const row = { ...parsed.data, client_id: clientId };
  const { data, error } = requirementId
    ? await supabase.from("document_requirements").update(row).eq("id", requirementId).select("id")
    : await supabase.from("document_requirements").insert(row).select("id");
  if (error) return { errors: { _form: dbMessage(error) }, values };
  if (!data?.length) return { errors: { _form: "Você não tem permissão para alterar esta exigência." }, values };
  refresh(clientId);
  return {
    ok: true,
    message: requirementId ? "Exigência atualizada. As próximas pendências seguem a nova regra." : "Exigência criada. As próximas pendências já foram geradas.",
  };
}

export async function toggleRequirementAction(clientId: string, requirementId: string, active: boolean) {
  await requireProfile();
  if (!isUuid(clientId) || !isUuid(requirementId)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("document_requirements").update({ active }).eq("id", requirementId).eq("client_id", clientId);
  if (error) console.error("[documentos] exigência", error);
  refresh(clientId);
}

export async function deleteRequirementAction(clientId: string, requirementId: string) {
  await requireProfile();
  if (!isUuid(clientId) || !isUuid(requirementId)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("document_requirements").delete().eq("id", requirementId).eq("client_id", clientId);
  if (error) console.error("[documentos] remover exigência", error);
  refresh(clientId);
}

// ---------------- Configurações (gestão) ----------------

export async function saveDocSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const days = [...new Set(formData.getAll("reminder_days").map((v) => Number(v)))].filter((n) => Number.isInteger(n));
  const ahead = Number(formData.get("generate_ahead_days"));
  if (!days.length) return { errors: { reminder_days: "Escolha ao menos um momento para lembrar." } };
  if (days.some((d) => d < 0 || d > 60)) return { errors: { reminder_days: "Use dias entre 0 e 60." } };
  if (!Number.isInteger(ahead) || ahead < 7 || ahead > 120) return { errors: { generate_ahead_days: "Entre 7 e 120 dias." } };
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_settings")
    .update({ reminder_days: days.sort((a, b) => b - a), generate_ahead_days: ahead })
    .eq("id", 1);
  if (error) return { errors: { _form: dbMessage(error) } };
  revalidatePath("/configuracoes/prazos");
  return { ok: true, message: "Lembretes salvos. Valem a partir da próxima verificação." };
}

const typeSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(120),
  department: z.enum(["contabil", "fiscal", "dp"]),
  description: optionalText(500),
  default_periodicity: z.enum(PERIODICITIES),
  default_due_day: z.coerce.number().int().min(1, "Entre 1 e 31").max(31, "Entre 1 e 31"),
  active: z.boolean(),
});

export async function saveDocTypeAction(typeId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  if (typeId && !isUuid(typeId)) return { errors: { _form: "Tipo inválido." } };
  const values = formValues(formData);
  const parsed = typeSchema.safeParse({
    name: formData.get("name"),
    department: formData.get("department"),
    description: formData.get("description") ?? "",
    default_periodicity: formData.get("default_periodicity"),
    default_due_day: formData.get("default_due_day"),
    active: typeId ? formData.get("active") === "on" : true,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const row = { ...parsed.data, needs_review: false };
  const { error } = typeId
    ? await supabase.from("document_types").update(row).eq("id", typeId)
    : await supabase.from("document_types").insert(row);
  if (error) {
    if (error.code === "23505") return { errors: { name: "Já existe um documento com este nome neste departamento." }, values };
    return { errors: { _form: dbMessage(error) }, values };
  }
  revalidatePath("/configuracoes/prazos");
  return { ok: true, message: typeId ? "Documento atualizado." : "Documento cadastrado." };
}
