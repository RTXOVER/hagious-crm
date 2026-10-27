"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireProfile, formValues, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, isRealDate } from "@/lib/validation/schemas";
import { isUuid } from "@/lib/validation/ids";
import { SUCCESS_RECURRENCES, SUCCESS_TYPES } from "@/lib/success";

/** Traduz erros do banco para mensagens claras. */
function dbMessage(error: { code?: string; message: string }): string {
  const m = error.message ?? "";
  if (m.includes("resultado_registrado")) return "Descreva o resultado (o que foi feito ou combinado).";
  if (m.includes("cancelamento_motivado")) return "Informe o motivo do cancelamento.";
  if (m.includes("Responsável inválido")) return "Escolha um responsável ativo.";
  if (m.includes("Somente a gestão")) return "Somente a gestão pode reabrir uma ação encerrada.";
  if (m.includes("Ação encerrada")) return "Ação encerrada: somente a gestão pode alterar.";
  if (m.includes("Só é possível reagendar")) return "Só é possível reagendar ações planejadas.";
  if (m.includes("motivo do reagendamento")) return "Informe o motivo do reagendamento.";
  if (m.includes("não encontrada ou sem permissão")) return "Você não tem permissão para alterar esta ação.";
  if (m.includes("Mudança de situação")) return "Essa mudança de situação não é permitida.";
  if (error.code === "42501" || m.includes("row-level security")) return "Você não tem permissão para esta operação.";
  console.error("[sucesso]", error);
  return "Não foi possível concluir a operação. Tente novamente.";
}

function refresh(clientId?: string | null, actionId?: string) {
  revalidatePath("/sucesso");
  if (actionId) revalidatePath(`/sucesso/${actionId}`);
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/");
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data").refine(isRealDate, "Data inválida");

const createSchema = z.object({
  client_id: z.string().refine(isUuid, "Escolha o cliente"),
  type: z.enum(SUCCESS_TYPES, { message: "Escolha o tipo de ação" }),
  objective: z.string().trim().min(3, "Descreva o objetivo do contato").max(300, "Máximo de 300 caracteres"),
  planned_date: isoDate,
  responsible_id: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isUuid(v), "Seleção inválida"),
  recurrence: z.enum(SUCCESS_RECURRENCES),
});

export async function createSuccessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const values = formValues(formData);
  const parsed = createSchema.safeParse({
    client_id: formData.get("client_id") ?? "",
    type: formData.get("type") ?? "",
    objective: formData.get("objective") ?? "",
    planned_date: formData.get("planned_date") ?? "",
    responsible_id: formData.get("responsible_id") ?? "",
    recurrence: formData.get("recurrence") ?? "nenhuma",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { data, error } = await supabase.from("success_actions").insert(parsed.data).select("id").single();
  if (error) return { errors: { _form: dbMessage(error) }, values };
  refresh(parsed.data.client_id);
  redirect(`/sucesso/${data.id}?criada=1`);
}

const STATUSES = ["planejada", "realizada", "cancelada"] as const;

export async function setSuccessStatusAction(actionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(actionId)) return { errors: { _form: "Ação inválida." } };
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(status)) return { errors: { _form: "Situação inválida." } };
  if (status === "realizada" && note.length < 3) return { errors: { note: "Descreva o resultado: o que foi conversado ou combinado." } };
  if (status === "cancelada" && note.length < 3) return { errors: { note: "Explique o motivo do cancelamento." } };
  if (note.length > 4000) return { errors: { note: "Texto muito longo (máximo de 4.000 caracteres)." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("success_set_status", {
    p_action: actionId,
    p_status: status as (typeof STATUSES)[number],
    p_note: note || null,
  });
  if (error) return { errors: { _form: dbMessage(error) } };
  const { data } = await supabase.from("success_actions").select("client_id, recurrence").eq("id", actionId).maybeSingle();
  refresh(data?.client_id, actionId);
  const msg =
    status === "realizada"
      ? data?.recurrence && data.recurrence !== "nenhuma"
        ? "Ação registrada como realizada. A próxima da série já foi programada."
        : "Ação registrada como realizada."
      : status === "cancelada"
        ? "Ação cancelada."
        : "Ação reaberta.";
  return { ok: true, message: msg };
}

export async function rescheduleSuccessAction(actionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(actionId)) return { errors: { _form: "Ação inválida." } };
  const values = formValues(formData);
  const date = isoDate.safeParse(formData.get("planned_date") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!date.success) return { errors: { planned_date: "Informe a nova data." }, values };
  if (reason.length < 3) return { errors: { reason: "Informe o motivo (fica no histórico)." }, values };
  if (reason.length > 1000) return { errors: { reason: "Texto muito longo." }, values };
  const supabase = await createClient();
  const { error } = await supabase.rpc("success_reschedule", { p_action: actionId, p_date: date.data, p_reason: reason });
  if (error) return { errors: { _form: dbMessage(error) }, values };
  const { data } = await supabase.from("success_actions").select("client_id").eq("id", actionId).maybeSingle();
  refresh(data?.client_id, actionId);
  return { ok: true, message: "Nova data salva. Os lembretes valem para ela." };
}

export async function setSuccessResponsibleAction(actionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const resp = String(formData.get("responsible_id") ?? "");
  if (!isUuid(actionId) || !isUuid(resp)) return { errors: { _form: "Escolha o responsável." } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("success_actions").update({ responsible_id: resp }).eq("id", actionId).select("client_id");
  if (error) return { errors: { _form: dbMessage(error) } };
  if (!data?.length) return { errors: { _form: "Você não tem permissão para alterar esta ação." } };
  refresh(data[0].client_id, actionId);
  return { ok: true, message: "Responsável atualizado. A pessoa recebeu um aviso." };
}

export async function updateObjectiveAction(actionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(actionId)) return { errors: { _form: "Ação inválida." } };
  const objective = String(formData.get("objective") ?? "").trim();
  if (objective.length < 3 || objective.length > 300) return { errors: { objective: "Entre 3 e 300 caracteres." } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("success_actions").update({ objective }).eq("id", actionId).select("client_id");
  if (error) return { errors: { _form: dbMessage(error) } };
  if (!data?.length) return { errors: { _form: "Você não tem permissão para alterar esta ação." } };
  refresh(data[0].client_id, actionId);
  return { ok: true, message: "Objetivo atualizado." };
}

export async function commentSuccessAction(actionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!isUuid(actionId)) return { errors: { _form: "Ação inválida." } };
  const body = String(formData.get("body") ?? "").trim();
  if (body.length < 2) return { errors: { body: "Escreva o comentário." } };
  if (body.length > 4000) return { errors: { body: "Texto muito longo (máximo de 4.000 caracteres)." } };
  const supabase = await createClient();
  const { error } = await supabase.from("success_events").insert({ action_id: actionId, kind: "comentario", actor_id: profile.id, body });
  if (error) return { errors: { _form: dbMessage(error) } };
  refresh(null, actionId);
  return { ok: true, message: "Comentário registrado." };
}

export async function saveSuccessSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const days = Number(formData.get("stale_days"));
  if (!Number.isInteger(days) || days < 15 || days > 365) return { errors: { stale_days: "Entre 15 e 365 dias." } };
  const supabase = await createClient();
  const { error } = await supabase.from("success_settings").update({ stale_days: days, needs_review: false }).eq("id", 1);
  if (error) return { errors: { _form: dbMessage(error) } };
  revalidatePath("/configuracoes/prazos");
  revalidatePath("/sucesso");
  revalidatePath("/");
  return { ok: true, message: "Prazo de acompanhamento salvo." };
}
