"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/ids";
import { ingestMessage } from "@/lib/channels/accounts";
import { sendWhatsAppText } from "@/lib/channels/whatsapp";
import { explainEmailError, sendEmail, syncEmailAccount } from "@/lib/channels/email";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Carrega a conversa COM as permissões de quem está logado (se não pode ver, não existe). */
async function visibleConversation(conversationId: string) {
  if (!isUuid(conversationId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, account_id, kind, contact_address, contact_name, client_id, last_inbound_at, account:channel_accounts(status, is_demo)")
    .eq("id", conversationId)
    .maybeSingle();
  return data;
}

export async function sendMessageAction(conversationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  const conv = await visibleConversation(conversationId);
  if (!conv) return { errors: { _form: "Conversa não encontrada ou sem permissão." } };
  const text = String(formData.get("body") ?? "").trim();
  if (text.length < 1) return { errors: { body: "Escreva a mensagem." } };
  if (text.length > (conv.kind === "whatsapp" ? 4096 : 50_000)) return { errors: { body: "Mensagem muito longa." }, values: { body: text } };
  if (conv.account?.status !== "conectado") return { errors: { _form: "Este canal está desconectado." }, values: { body: text } };

  const now = new Date().toISOString();
  if (conv.kind === "whatsapp") {
    // Regra da Meta: texto livre só até 24h depois da última mensagem do cliente
    if (!conv.last_inbound_at || Date.now() - Date.parse(conv.last_inbound_at) > WINDOW_MS) {
      return {
        errors: { _form: "Passaram mais de 24h desde a última mensagem do cliente. Pela regra do WhatsApp, só é possível enviar um modelo aprovado pela Meta (em breve) ou aguardar o cliente escrever." },
        values: { body: text },
      };
    }
    try {
      const id = await sendWhatsAppText(conv.account_id, conv.contact_address, text);
      await ingestMessage({ accountId: conv.account_id, direction: "saida", externalId: id, contact: conv.contact_address, kind: "text", body: text, status: "enviada", via: "crm", sentAt: now, sentBy: profile.id });
    } catch (e) {
      await ingestMessage({ accountId: conv.account_id, direction: "saida", externalId: null, contact: conv.contact_address, kind: "text", body: text, status: "falhou", via: "crm", sentAt: now, sentBy: profile.id });
      const admin = createAdminClient();
      await admin.from("messages").update({ error: String((e as Error).message).slice(0, 1000) }).eq("conversation_id", conv.id).eq("status", "falhou").is("error", null);
      return { errors: { _form: `Não foi possível enviar: ${(e as Error).message}` } };
    }
  } else {
    const supabase = await createClient();
    const { data: last } = await supabase
      .from("messages")
      .select("subject, external_id")
      .eq("conversation_id", conv.id)
      .eq("direction", "entrada")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const typed = String(formData.get("subject") ?? "").trim();
    const subject = (typed || (last?.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : "Mensagem da Hagious")).slice(0, 500);
    try {
      const id = await sendEmail(conv.account_id, { to: conv.contact_address, subject, text, inReplyTo: last?.external_id ?? null });
      await ingestMessage({ accountId: conv.account_id, direction: "saida", externalId: id, contact: conv.contact_address, kind: "email", subject, body: text, status: "enviada", via: "crm", sentAt: now, sentBy: profile.id });
    } catch (e) {
      return { errors: { _form: explainEmailError(e) }, values: { body: text, subject } };
    }
  }
  revalidatePath("/conversas");
  return { ok: true, message: "Enviada." };
}

export async function markReadAction(conversationId: string) {
  await requireProfile();
  if (!isUuid(conversationId)) return;
  const supabase = await createClient();
  await supabase.from("conversations").update({ unread_count: 0 }).eq("id", conversationId).gt("unread_count", 0);
}

export async function setArchivedAction(conversationId: string, archived: boolean) {
  await requireProfile();
  if (!isUuid(conversationId)) return;
  const supabase = await createClient();
  await supabase.from("conversations").update({ archived }).eq("id", conversationId);
  revalidatePath("/conversas");
}

export async function linkClientAction(conversationId: string, clientId: string): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(conversationId) || (clientId && !isUuid(clientId))) return { errors: { _form: "Seleção inválida." } };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ client_id: clientId || null, contact_id: null })
    .eq("id", conversationId)
    .select("id");
  if (error || !data?.length) return { errors: { _form: "Você não tem permissão para alterar este vínculo." } };
  revalidatePath("/conversas");
  return { ok: true, message: clientId ? "Conversa ligada ao cliente." : "Vínculo removido." };
}

/** Salva uma cópia da mensagem no histórico do cliente (continua lá mesmo se a conversa for apagada). */
export async function saveMessageAction(messageId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  const clientId = String(formData.get("client_id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!isUuid(messageId) || !isUuid(clientId)) return { errors: { client_id: "Escolha o cliente." } };
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("messages")
    .select("id, direction, subject, body, kind, sent_at, conversation:conversations(kind, contact_name, contact_address, account:channel_accounts(label))")
    .eq("id", messageId)
    .maybeSingle();
  if (!m?.conversation) return { errors: { _form: "Mensagem não encontrada." } };
  const sender = m.direction === "entrada" ? m.conversation.contact_name || m.conversation.contact_address : m.conversation.account?.label ?? "Hagious";
  const { error } = await supabase.from("message_saves").insert({
    message_id: m.id,
    client_id: clientId,
    channel: m.conversation.kind,
    direction: m.direction,
    sender,
    subject: m.subject,
    body: m.body ?? `[${m.kind}]`,
    sent_at: m.sent_at,
    note: note || null,
    saved_by: profile.id,
  });
  if (error) {
    if (error.code === "23505") return { ok: true, message: "Esta mensagem já estava salva neste cliente." };
    return { errors: { _form: "Não foi possível salvar (verifique se você atende este cliente)." } };
  }
  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/conversas");
  return { ok: true, message: "Mensagem salva no cliente." };
}

/** Marca um documento pendente como recebido a partir da mensagem (e salva a mensagem no cliente). */
export async function receiveDocumentFromMessageAction(messageId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  const docId = String(formData.get("document_id") ?? "");
  if (!isUuid(messageId) || !isUuid(docId)) return { errors: { document_id: "Escolha o documento." } };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("client_documents").select("id, client_id, title").eq("id", docId).maybeSingle();
  if (!doc) return { errors: { _form: "Documento não encontrado." } };
  const { data: m } = await supabase
    .from("messages")
    .select("id, direction, subject, body, kind, sent_at, conversation:conversations(kind, contact_name, contact_address)")
    .eq("id", messageId)
    .maybeSingle();
  if (!m?.conversation) return { errors: { _form: "Mensagem não encontrada." } };
  const channel = m.conversation.kind === "whatsapp" ? "WhatsApp" : "e-mail";
  const { data: upd, error } = await supabase
    .from("client_documents")
    .update({ status: "recebido", status_note: `Recebido por ${channel} (mensagem salva no cliente).` })
    .eq("id", doc.id)
    .eq("status", "pendente")
    .select("id");
  if (error || !upd?.length) return { errors: { _form: "Não foi possível registrar (o documento já foi recebido ou você não tem permissão)." } };
  await supabase.from("message_saves").insert({
    message_id: m.id,
    client_id: doc.client_id,
    channel: m.conversation.kind,
    direction: m.direction,
    sender: m.conversation.contact_name || m.conversation.contact_address,
    subject: m.subject,
    body: m.body ?? `[${m.kind}]`,
    sent_at: m.sent_at,
    note: `Comprovante de entrega: ${doc.title}`,
    saved_by: profile.id,
  });
  revalidatePath("/conversas");
  revalidatePath("/documentos");
  revalidatePath(`/clientes/${doc.client_id}`);
  return { ok: true, message: `“${doc.title}” marcado como recebido. Os lembretes pararam.` };
}

/** Busca e-mails novos agora (qualquer pessoa da equipe; no máximo uma vez a cada 30 s por caixa). */
export async function syncEmailNowAction(): Promise<ActionState> {
  await requireProfile();
  const admin = createAdminClient();
  const { data: accounts } = await admin.from("channel_accounts").select("id, last_sync_at, is_demo").eq("kind", "email").eq("status", "conectado");
  let total = 0;
  for (const a of accounts ?? []) {
    if (a.is_demo || (a.last_sync_at && Date.now() - Date.parse(a.last_sync_at) < 30_000)) continue;
    try {
      total += await syncEmailAccount(a.id);
    } catch (e) {
      await admin.from("channel_accounts").update({ last_error: explainEmailError(e), status: "erro" }).eq("id", a.id);
    }
  }
  if (total) revalidatePath("/conversas");
  return { ok: true, message: total ? `${total} e-mail(s) novo(s).` : "Nenhum e-mail novo." };
}
