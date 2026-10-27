"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireManager, requireProfile, formValues, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { clientSchema, contactSchema, serviceSchema, fieldErrors } from "@/lib/validation/schemas";
import { OPERATIONAL_DEPARTMENTS } from "@/lib/labels";

import { isUuid } from "@/lib/validation/ids";
/** Descrição padrão do serviço criado no cadastro (pode ser ajustada depois). */
const DEFAULT_SERVICE = {
  contabil: "Contabilidade",
  fiscal: "Escrita fiscal e apuração de impostos",
  dp: "Folha de pagamento e obrigações trabalhistas",
} as const;

const GENERIC_ERROR ="Não foi possível salvar. Tente novamente; se persistir, avise o administrador.";

function readClient(formData: FormData) {
  return clientSchema.safeParse({
    legal_name: formData.get("legal_name"),
    trade_name: formData.get("trade_name"),
    cnpj: formData.get("cnpj"),
    tax_regime: formData.get("tax_regime"),
    status: formData.get("status"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    notes: formData.get("notes"),
    client_since: formData.get("client_since"),
  });
}

function dbError(error: { code?: string; message: string }): ActionState {
  if (error.code === "23505") return { errors: { cnpj: "Já existe um cliente com este CNPJ." } };
  if (error.code === "42501") return { errors: { _form: "Você não tem permissão para esta operação." } };
  console.error("[clientes]", error);
  return { errors: { _form: GENERIC_ERROR } };
}

// ---------- Cliente ----------

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireManager();
  const values = formValues(formData);
  const parsed = readClient(formData);

  // Contato principal (opcional): validado ANTES de gravar, para não criar cliente pela metade
  const wantsContact = Boolean(values.contact_name?.trim() || values.contact_whatsapp?.trim() || values.contact_email?.trim());
  const contact = wantsContact
    ? contactSchema.safeParse({
        name: formData.get("contact_name"),
        job_title: formData.get("contact_job_title"),
        email: formData.get("contact_email"),
        whatsapp: formData.get("contact_whatsapp"),
        is_primary: true,
        whatsapp_opt_in: formData.get("contact_whatsapp_opt_in") === "on",
      })
    : null;

  // Serviços contratados e responsáveis escolhidos no cadastro (opcionais)
  const services = [...new Set(formData.getAll("services").map(String))].filter((s): s is (typeof OPERATIONAL_DEPARTMENTS)[number] =>
    (OPERATIONAL_DEPARTMENTS as readonly string[]).includes(s),
  );
  const responsibles = services
    .map((d) => ({ department: d, user_id: String(formData.get(`resp_${d}`) ?? "") }))
    .filter((r) => r.user_id);
  const badResp = responsibles.some((r) => !isUuid(r.user_id));

  const errors = {
    ...(badResp ? { _form: "Responsável inválido." } : {}),
    ...(parsed.success ? {} : fieldErrors(parsed.error)),
    ...(contact && !contact.success
      ? Object.fromEntries(Object.entries(fieldErrors(contact.error)).map(([k, v]) => [`contact_${k}`, v]))
      : {}),
  };
  if (!parsed.success || (contact && !contact.success) || badResp) return { errors, values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ ...parsed.data, created_by: profile.id })
    .select("id")
    .single();
  if (error) return { ...dbError(error), values };

  // Itens complementares: se algum falhar, o cliente já existe e a página dele avisa o que faltou
  const failed: string[] = [];
  if (contact?.success) {
    const c = contact.data;
    const { error: ce } = await supabase.from("client_contacts").insert({
      ...c,
      client_id: data.id,
      whatsapp_opt_in_at: c.whatsapp_opt_in ? new Date().toISOString() : null,
    });
    if (ce) { console.error("[clientes] contato inicial", ce); failed.push("contato"); }
  }
  if (services.length) {
    const { error: se } = await supabase
      .from("client_services")
      .insert(services.map((d) => ({ client_id: data.id, department: d, description: DEFAULT_SERVICE[d] })));
    if (se) { console.error("[clientes] serviços iniciais", se); failed.push("servicos"); }
  }
  if (responsibles.length && !failed.includes("servicos")) {
    const { error: re } = await supabase
      .from("client_responsibles")
      .insert(responsibles.map((r) => ({ ...r, client_id: data.id })));
    if (re) { console.error("[clientes] responsáveis iniciais", re); failed.push("responsaveis"); }
  }

  revalidatePath("/clientes");
  redirect(failed.length ? `/clientes/${data.id}?aviso=${failed.join(",")}` : `/clientes/${data.id}?criado=1`);
}

export async function updateClientAction(
  clientId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireManager();
  if (!isUuid(clientId)) return { errors: { _form: "Cliente inválido." } };
  const values = formValues(formData);
  const parsed = readClient(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update(parsed.data)
    .eq("id", clientId)
    .select("id");
  if (error) return { ...dbError(error), values };
  if (!data?.length) return { errors: { _form: "Cliente não encontrado ou sem permissão." }, values };

  revalidatePath(`/clientes/${clientId}`);
  redirect(`/clientes/${clientId}`);
}

// ---------- Situação e exclusão ----------

const STATUSES = ["ativo", "suspenso", "encerrado"] as const;

/** Muda a situação do cliente (gestor ou admin). Fica registrado no histórico. */
export async function setClientStatusAction(clientId: string, status: string): Promise<ActionState> {
  await requireManager();
  if (!isUuid(clientId)) return { errors: { _form: "Cliente inválido." } };
  if (!(STATUSES as readonly string[]).includes(status)) return { errors: { _form: "Situação inválida." } };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ status: status as (typeof STATUSES)[number] })
    .eq("id", clientId)
    .select("id");
  if (error) return dbError(error);
  if (!data?.length) return { errors: { _form: "Cliente não encontrado ou sem permissão." } };

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  return { ok: true, message: "Situação atualizada." };
}

/**
 * Exclui o cliente e, em cascata, contatos, serviços e responsáveis. Somente administradores.
 * Exige digitar EXCLUIR. O histórico de alterações guarda o registro da exclusão (quem e quando).
 */
export async function deleteClientAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  if (profile.role !== "admin") return { errors: { _form: "Somente administradores podem excluir clientes." } };
  if (!isUuid(clientId)) return { errors: { _form: "Cliente inválido." } };
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "EXCLUIR") {
    return { errors: { confirm: "Digite EXCLUIR para confirmar." } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").delete().eq("id", clientId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return { errors: { _form: "Cliente não encontrado ou sem permissão." } };

  revalidatePath("/clientes");
  redirect("/clientes?excluido=1");
}

// ---------- Contatos ----------

function readContact(formData: FormData) {
  return contactSchema.safeParse({
    name: formData.get("name"),
    job_title: formData.get("job_title"),
    email: formData.get("email"),
    whatsapp: formData.get("whatsapp"),
    is_primary: formData.get("is_primary") === "on",
    whatsapp_opt_in: formData.get("whatsapp_opt_in") === "on",
  });
}

export async function saveContactAction(
  clientId: string,
  contactId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  if (!isUuid(clientId) || (contactId && !isUuid(contactId))) {
    return { errors: { _form: "Registro inválido." } };
  }
  const values = formValues(formData);
  const parsed = readContact(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const input = parsed.data;

  // A data do consentimento é registrada pelo banco (autorização nova ou número novo = agora; senão mantém).
  // 1) Salva o contato (ainda sem marcar como principal) — se falhar, nada mais muda
  const row = { ...input, is_primary: false, whatsapp_opt_in_at: input.whatsapp_opt_in ? new Date().toISOString() : null };
  const saved = contactId
    ? await supabase.from("client_contacts").update(row).eq("id", contactId).eq("client_id", clientId).select("id")
    : await supabase.from("client_contacts").insert({ ...row, client_id: clientId }).select("id");
  if (saved.error) return { ...dbError(saved.error), values };
  const id = saved.data?.[0]?.id;
  if (!id) return { errors: { _form: "Você não tem permissão para alterar este contato." }, values };

  // 2) Só então troca o principal (um por cliente): tira dos outros e marca este
  if (input.is_primary) {
    const demote = await supabase.from("client_contacts").update({ is_primary: false }).eq("client_id", clientId).eq("is_primary", true).neq("id", id);
    if (demote.error) return { ...dbError(demote.error), values };
    const promote = await supabase.from("client_contacts").update({ is_primary: true }).eq("id", id);
    if (promote.error) return { ...dbError(promote.error), values };
  }

  revalidatePath(`/clientes/${clientId}`);
  redirect(`/clientes/${clientId}#contatos`);
}

export async function deleteContactAction(clientId: string, contactId: string) {
  await requireManager();
  if (!isUuid(clientId) || !isUuid(contactId)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("client_contacts").delete().eq("id", contactId).eq("client_id", clientId);
  if (error) console.error("[clientes] excluir contato", error);
  revalidatePath(`/clientes/${clientId}`);
}

// ---------- Serviços contratados ----------

export async function addServiceAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  if (!isUuid(clientId)) return { errors: { _form: "Cliente inválido." } };
  const parsed = serviceSchema.safeParse({
    department: formData.get("department"),
    description: formData.get("description"),
    started_on: formData.get("started_on"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values: formValues(formData) };

  const supabase = await createClient();
  const { error } = await supabase.from("client_services").insert({ ...parsed.data, client_id: clientId });
  if (error) return { ...dbError(error), values: formValues(formData) };

  revalidatePath(`/clientes/${clientId}`);
  return { ok: true, message: "Serviço adicionado." };
}

export async function endServiceAction(clientId: string, serviceId: string) {
  await requireManager();
  if (!isUuid(clientId) || !isUuid(serviceId)) return;
  const supabase = await createClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { error } = await supabase
    .from("client_services")
    .update({ active: false, ended_on: today })
    .eq("id", serviceId)
    .eq("client_id", clientId);
  if (error) console.error("[clientes] encerrar serviço", error);
  revalidatePath(`/clientes/${clientId}`);
}

// ---------- Responsáveis ----------

export async function saveResponsiblesAction(
  clientId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireManager();
  if (!isUuid(clientId)) return { errors: { _form: "Cliente inválido." } };

  const supabase = await createClient();
  for (const dep of OPERATIONAL_DEPARTMENTS) {
    const userId = String(formData.get(`resp_${dep}`) ?? "");
    if (userId && !isUuid(userId)) return { errors: { _form: "Responsável inválido." } };
    const { error } = userId
      ? await supabase
          .from("client_responsibles")
          .upsert({ client_id: clientId, department: dep, user_id: userId }, { onConflict: "client_id,department" })
      : await supabase.from("client_responsibles").delete().eq("client_id", clientId).eq("department", dep);
    if (error) return dbError(error);
  }

  revalidatePath(`/clientes/${clientId}`);
  return { ok: true, message: "Responsáveis atualizados." };
}
