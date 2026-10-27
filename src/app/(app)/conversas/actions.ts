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
  if (!conv.account || conv.account.status === "desconectado") return { errors: { _form: "Este canal está desconectado." }, values: { body: text } };

  const now = new Date().toISOString();
  let subject: string | null = null;
  let inReplyTo: string | null = null;
  if (conv.kind === "whatsapp") {
    // Regra da Meta: texto livre só até 24h depois da última mensagem do cliente
    if (!conv.last_inbound_at || Date.now() - Date.parse(conv.last_inbound_at) > WINDOW_MS) {
      return {
        errors: { _form: "Passaram mais de 24h desde a última mensagem do cliente. Pela regra do WhatsApp, só é possível enviar um modelo aprovado pela Meta (em breve) ou aguardar o cliente escrever." },
        values: { body: text },
      };
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
    subject = (typed || (last?.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : "Mensagem da Hagious")).slice(0, 500);
    inReplyTo = last?.external_id ?? null;
  }

  // 1) Registra ANTES como "enviando": se o envio falhar, a falha fica na mensagem certa;
  //    se o envio der certo, nunca pedimos para a pessoa reenviar (evita mensagem duplicada ao cliente).
  const admin = createAdminClient();
  let pendingId: string | null = null;
  try {
    pendingId = await ingestMessage({
      accountId: conv.account_id, direction: "saida", externalId: null, contact: conv.contact_address,
      kind: conv.kind === "whatsapp" ? "text" : "email", subject, body: text, status: "enviando", via: "crm", sentAt: now, sentBy: profile.id,
    });
  } catch (e) {
    console.error("[conversas] registrar envio", e);
    return { errors: { _form: "Não foi possível registrar a mensagem. Nada foi enviado; tente de novo." }, values: { body: text } };
  }

  // 2) Envia pelo canal
  let externalId: string;
  try {
    externalId = conv.kind === "whatsapp"
      ? await sendWhatsAppText(conv.account_id, conv.contact_address, text)
      : await sendEmail(conv.account_id, { to: conv.contact_address, subject: subject!, text, inReplyTo });
  } catch (e) {
    const reason = conv.kind === "email" ? explainEmailError(e) : `Não foi possível enviar: ${(e as Error).message}`;
    if (pendingId) await admin.from("messages").update({ status: "falhou", error: reason.slice(0, 1000) }).eq("id", pendingId);
    revalidatePath("/conversas");
    return { errors: { _form: reason }, values: { body: text, ...(subject ? { subject } : {}) } };
  }

  // 3) Confirma o envio (se só esta etapa falhar, a mensagem JÁ saiu: avisamos sem pedir reenvio)
  if (pendingId) {
    const { error } = await admin.from("messages").update({ status: "enviada", external_id: externalId }).eq("id", pendingId).eq("status", "enviando");
    if (error) console.error("[conversas] confirmar envio", error);
  }
  revalidatePath("/conversas");
  return { ok: true, message: "Enviada." };
}

/** Lista de clientes para os seletores (carregada só quando alguém abre o seletor; respeita as permissões). */
export async function listClientsForPickerAction(): Promise<{ value: string; label: string; hint?: string }[]> {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, legal_name, trade_name").neq("status", "encerrado").order("legal_name").limit(2000);
  return (data ?? []).map((c) => ({ value: c.id, label: c.legal_name, hint: c.trade_name ?? undefined }));
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
  const { data: m } = await supabase.from("messages").select("id, direction, sent_at, conversation:conversations(kind)").eq("id", messageId).maybeSingle();
  if (!m?.conversation) return { errors: { _form: "Mensagem não encontrada." } };
  // O banco copia o conteúdo da mensagem real (não dá para salvar um texto diferente do recebido)
  const { error } = await supabase.from("message_saves").insert({
    message_id: m.id, client_id: clientId, channel: m.conversation.kind, direction: m.direction,
    sent_at: m.sent_at, note: note || null, saved_by: profile.id,
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
    .select("id, conversation:conversations(kind, client_id)")
    .eq("id", messageId)
    .maybeSingle();
  if (!m?.conversation) return { errors: { _form: "Mensagem não encontrada." } };
  // A mensagem precisa ser de uma conversa do MESMO cliente do documento
  if (m.conversation.client_id !== doc.client_id) {
    return { errors: { _form: "Esta conversa não está ligada ao cliente deste documento. Ligue a conversa ao cliente primeiro." } };
  }
  const channel = m.conversation.kind === "whatsapp" ? "WhatsApp" : "e-mail";
  const { data: upd, error } = await supabase
    .from("client_documents")
    .update({ status: "recebido", status_note: `Recebido por ${channel} (mensagem salva no cliente).` })
    .eq("id", doc.id)
    .eq("status", "pendente")
    .select("id");
  if (error || !upd?.length) return { errors: { _form: "Não foi possível registrar (o documento já foi recebido ou você não tem permissão)." } };
  // O banco copia o conteúdo da mensagem real (canal, texto, data); aqui só a referência e a observação
  const { error: saveError } = await supabase.from("message_saves").insert({
    message_id: m.id, client_id: doc.client_id, channel: m.conversation.kind, direction: "entrada",
    sent_at: new Date().toISOString(), note: `Comprovante de entrega: ${doc.title}`, saved_by: profile.id,
  });
  if (saveError && saveError.code !== "23505") console.error("[conversas] salvar comprovante", saveError);
  revalidatePath("/conversas");
  revalidatePath("/documentos");
  revalidatePath(`/clientes/${doc.client_id}`);
  return { ok: true, message: `“${doc.title}” marcado como recebido. Os lembretes pararam.` };
}

/**
 * Busca e-mails novos agora (qualquer pessoa da equipe). A trava no banco garante uma busca por vez
 * e no máximo uma a cada 30 s por caixa. Falha momentânea só registra o erro: a caixa continua ativa.
 */
export async function syncEmailNowAction(): Promise<ActionState> {
  await requireProfile();
  const admin = createAdminClient();
  const { data: accounts } = await admin.from("channel_accounts").select("id, is_demo").eq("kind", "email").neq("status", "desconectado");
  let total = 0;
  for (const a of accounts ?? []) {
    if (a.is_demo) continue;
    try {
      total += (await syncEmailAccount(a.id)) ?? 0;
    } catch (e) {
      await admin.from("channel_accounts").update({ last_error: explainEmailError(e) }).eq("id", a.id);
    }
  }
  if (total) revalidatePath("/conversas");
  return { ok: true, message: total ? `${total} e-mail(s) novo(s).` : "Nenhum e-mail novo." };
}

const CATEGORIES = ["cliente", "empresa", "pessoa", "separado"] as const;

/**
 * Reclassifica um remetente de e-mail ("Não é promoção" / "Mover para Separados").
 * Vale para esta conversa, para as outras do mesmo remetente (ou domínio) e para os próximos e-mails.
 */
export async function setEmailCategoryAction(conversationId: string, category: string, scope: "endereco" | "dominio"): Promise<ActionState> {
  const profile = await requireProfile();
  if (!isUuid(conversationId) || !(CATEGORIES as readonly string[]).includes(category)) return { errors: { _form: "Seleção inválida." } };
  const supabase = await createClient();
  const { data: conv } = await supabase.from("conversations").select("id, kind, contact_address").eq("id", conversationId).maybeSingle();
  if (!conv || conv.kind !== "email") return { errors: { _form: "Conversa de e-mail não encontrada." } };
  const domain = conv.contact_address.split("@")[1] ?? "";
  if (scope === "dominio" && !domain) return { errors: { _form: "Endereço sem domínio." } };
  const pattern = scope === "dominio" ? `@${domain}` : conv.contact_address;
  const cat = category as (typeof CATEGORIES)[number];
  const { error } = await supabase.from("email_sender_rules").upsert({ pattern, category: cat, created_by: profile.id }, { onConflict: "pattern" });
  if (error) return { errors: { _form: "Somente a gestão e o atendimento podem reclassificar e-mails." } };
  // Aplica agora às conversas do mesmo remetente/domínio
  let upd = supabase.from("conversations").update({ category: cat }).eq("kind", "email");
  upd = scope === "dominio" ? upd.ilike("contact_address", `%@${domain.replace(/[%_\\]/g, "\\$&")}`) : upd.eq("contact_address", conv.contact_address);
  await upd;
  revalidatePath("/conversas");
  const label = { cliente: "Clientes", empresa: "Empresas", pessoa: "Pessoas", separado: "Separados" }[cat];
  return { ok: true, message: `Movido para ${label}. Os próximos e-mails ${scope === "dominio" ? `de @${domain}` : "deste remetente"} também vão para lá.` };
}
