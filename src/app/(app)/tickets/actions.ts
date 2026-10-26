"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, formValues, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation/schemas";
import { isUuid } from "@/lib/validation/ids";

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isUuid(v), "Seleção inválida");

const ticketSchema = z.object({
  client_id: z.string().refine(isUuid, "Escolha o cliente"),
  category_id: z.string().refine(isUuid, "Escolha o tipo de solicitação"),
  title: z.string().trim().min(3, "Descreva o pedido em poucas palavras").max(200),
  description: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .transform((v) => (v ? v : null)),
  origin: z.enum(["whatsapp", "telefone", "email", "presencial", "interno"]),
  priority: z.enum(["baixa", "normal", "alta", "urgente"]),
  assignee_id: optionalUuid,
});

/** Traduz erros do banco (regras de negócio) para mensagens claras. */
function dbMessage(error: { code?: string; message: string }): string {
  const m = error.message ?? "";
  if (m.includes("conclusao_registrada")) return "Descreva o que foi feito para concluir o ticket.";
  if (m.includes("cancelamento_motivado")) return "Informe o motivo do cancelamento.";
  if (m.includes("Mudança de situação não permitida")) return "Essa mudança de situação não é permitida.";
  if (m.includes("Somente a gestão pode reabrir")) return "Somente a gestão pode reabrir tickets encerrados.";
  if (m.includes("motivo do encaminhamento")) return "Informe o motivo do encaminhamento.";
  if (m.includes("sem permissão") || error.code === "42501") return "Você não tem permissão para esta operação.";
  if (m.includes("Categoria")) return "Tipo de solicitação inválido ou inativo.";
  if (m.includes("Responsável inválido")) return "O responsável escolhido não está ativo.";
  console.error("[tickets]", error);
  return "Não foi possível concluir a operação. Tente novamente.";
}

export async function createTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const values = formValues(formData);
  const parsed = ticketSchema.safeParse({
    client_id: formData.get("client_id") ?? "",
    category_id: formData.get("category_id") ?? "",
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    origin: formData.get("origin"),
    priority: formData.get("priority"),
    assignee_id: formData.get("assignee_id") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("tickets").insert(parsed.data).select("id").single();
  if (error) return { errors: { _form: dbMessage(error) }, values };

  revalidatePath("/tickets");
  revalidatePath(`/clientes/${parsed.data.client_id}`);
  redirect(`/tickets/${data.id}?criado=1`);
}

const STATUSES = ["aberto", "em_andamento", "aguardando_cliente", "concluido", "cancelado"] as const;

export async function setStatusAction(ticketId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(ticketId)) return { errors: { _form: "Ticket inválido." } };
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(status)) return { errors: { _form: "Situação inválida." } };
  if ((status === "concluido" || status === "cancelado") && note.length < 3) {
    return { errors: { note: status === "concluido" ? "Descreva o que foi feito." : "Informe o motivo do cancelamento." } };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("ticket_set_status", {
    p_ticket: ticketId,
    p_status: status as (typeof STATUSES)[number],
    p_note: note || null,
  });
  if (error) return { errors: { _form: dbMessage(error) } };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true, message: "Situação atualizada." };
}

/** Assumir: passa a ser o responsável e, se estava aberto, coloca em andamento. */
export async function takeTicketAction(ticketId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (!isUuid(ticketId)) return { errors: { _form: "Ticket inválido." } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ticket_assign", { p_ticket: ticketId, p_assignee: profile.id });
  if (error) return { errors: { _form: dbMessage(error) } };
  const { data: t } = await supabase.from("tickets").select("status").eq("id", ticketId).single();
  if (t?.status === "aberto") {
    const { error: se } = await supabase.rpc("ticket_set_status", { p_ticket: ticketId, p_status: "em_andamento", p_note: null });
    if (se) return { errors: { _form: dbMessage(se) } };
  }
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true, message: "Ticket assumido." };
}

export async function assignAction(ticketId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const assignee = String(formData.get("assignee_id") ?? "");
  if (!isUuid(ticketId) || (assignee && !isUuid(assignee))) return { errors: { _form: "Seleção inválida." } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ticket_assign", { p_ticket: ticketId, p_assignee: assignee || null });
  if (error) return { errors: { _form: dbMessage(error) } };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true, message: "Responsável atualizado." };
}

export async function forwardAction(ticketId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const department = String(formData.get("department") ?? "");
  const assignee = String(formData.get("assignee_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isUuid(ticketId) || !["contabil", "fiscal", "dp"].includes(department) || (assignee && !isUuid(assignee))) {
    return { errors: { _form: "Seleção inválida." } };
  }
  if (reason.length < 3) return { errors: { reason: "Explique o motivo do encaminhamento." } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ticket_forward", {
    p_ticket: ticketId,
    p_department: department as "contabil" | "fiscal" | "dp",
    p_assignee: assignee || null,
    p_reason: reason,
  });
  if (error) return { errors: { _form: dbMessage(error) } };
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return { ok: true, message: "Ticket encaminhado." };
}

export async function updatePriorityAction(ticketId: string, priority: string): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(ticketId) || !["baixa", "normal", "alta", "urgente"].includes(priority)) return { errors: { _form: "Seleção inválida." } };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ priority: priority as "baixa" | "normal" | "alta" | "urgente" })
    .eq("id", ticketId)
    .select("id");
  if (error) return { errors: { _form: dbMessage(error) } };
  if (!data?.length) return { errors: { _form: "Você não tem permissão para alterar este ticket." } };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true, message: "Prioridade atualizada." };
}

export async function commentAction(ticketId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (!isUuid(ticketId)) return { errors: { _form: "Ticket inválido." } };
  const body = String(formData.get("body") ?? "").trim();
  const kind = formData.get("kind") === "resposta" ? "resposta" : "comentario";
  const mentions = [...new Set(formData.getAll("mentions").map(String))].filter(isUuid).slice(0, 20);
  if (body.length < 2) return { errors: { body: "Escreva o comentário." }, values: formValues(formData) };
  if (body.length > 8000) return { errors: { body: "Comentário muito longo." }, values: formValues(formData) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("ticket_events")
    .insert({ ticket_id: ticketId, kind, actor_id: profile.id, body, mentions });
  if (error) return { errors: { _form: dbMessage(error) }, values: formValues(formData) };
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true, message: kind === "resposta" ? "Resposta registrada." : "Comentário adicionado." };
}

// ---------- Notificações ----------

export async function markNotificationReadAction(id: number) {
  await requireProfile();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  revalidatePath("/notificacoes");
}

export async function markAllNotificationsReadAction() {
  const profile = await requireProfile();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).is("read_at", null);
  revalidatePath("/notificacoes");
}
