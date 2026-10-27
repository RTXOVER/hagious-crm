"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, formValues, type ActionState } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors } from "@/lib/validation/schemas";
import { isUuid } from "@/lib/validation/ids";
import { writeSecret } from "@/lib/channels/accounts";
import { EMAIL_PRESETS } from "@/lib/channels/email-presets";
import { explainEmailError, syncEmailAccount, testEmailConnection, type EmailConfig } from "@/lib/channels/email";
import { completeEmbeddedSignup, processWhatsAppPayload, whatsappReady } from "@/lib/channels/whatsapp";
import { buildIncomingPayload } from "@/lib/channels/whatsapp-parse";
import type { Json } from "@/lib/database.types";

const refresh = () => {
  revalidatePath("/conversas");
  revalidatePath("/conversas/conexoes");
};

// ---------------- E-mail ----------------

const port = z.coerce.number().int().min(1, "Porta inválida").max(65535, "Porta inválida");
const emailSchema = z.object({
  provider: z.string(),
  label: z.string().trim().min(2, "Dê um nome à caixa").max(120),
  address: z.email("E-mail inválido").transform((v) => v.toLowerCase()),
  username: z.string().trim().max(200).optional(),
  password: z.string().min(1, "Informe a senha (ou senha de app)").max(500),
  imap_host: z.string().trim().min(3, "Informe o servidor IMAP").max(200),
  imap_port: port,
  smtp_host: z.string().trim().min(3, "Informe o servidor SMTP").max(200),
  smtp_port: port,
});

export async function connectEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireAdmin();
  const values = formValues(formData);
  delete values.password; // nunca devolve a senha para a tela
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const f = parsed.data;
  const preset = EMAIL_PRESETS.find((p) => p.value === f.provider);
  if (!preset?.available) return { errors: { provider: "Escolha um provedor disponível." }, values };

  // 993/465 = conexão segura direta; 143/587 = STARTTLS
  const cfg: EmailConfig = {
    provider: f.provider,
    username: f.username || f.address,
    imap: { host: f.imap_host, port: f.imap_port, secure: f.imap_port === 993 },
    smtp: { host: f.smtp_host, port: f.smtp_port, secure: f.smtp_port === 465 },
  };
  try {
    await testEmailConnection(cfg, f.password);
  } catch (e) {
    return { errors: { _form: explainEmailError(e) }, values };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin.from("channel_accounts").select("id").eq("kind", "email").eq("address", f.address).maybeSingle();
  const row = { kind: "email" as const, label: f.label, address: f.address, status: "conectado" as const, config: cfg as unknown as Json, last_error: null, connected_by: profile.id };
  const { data: saved, error } = existing
    ? await admin.from("channel_accounts").update(row).eq("id", existing.id).select("id").single()
    : await admin.from("channel_accounts").insert(row).select("id").single();
  if (error || !saved) return { errors: { _form: "Não foi possível salvar a conexão." }, values };
  await writeSecret(saved.id, { password: f.password });

  let imported = 0;
  try {
    imported = (await syncEmailAccount(saved.id, { minIntervalMs: 0 })) ?? 0;
  } catch (e) {
    await admin.from("channel_accounts").update({ last_error: explainEmailError(e) }).eq("id", saved.id);
  }
  refresh();
  return { ok: true, message: `E-mail conectado. ${imported} mensagem(ns) dos últimos 30 dias importada(s).` };
}

/** Desconecta: apaga o segredo e para a sincronização. As conversas e mensagens continuam no CRM. */
export async function disconnectChannelAction(accountId: string) {
  await requireAdmin();
  if (!isUuid(accountId)) return;
  const admin = createAdminClient();
  await admin.from("channel_secrets").delete().eq("account_id", accountId);
  await admin.from("channel_accounts").update({ status: "desconectado" }).eq("id", accountId);
  refresh();
}

// ---------------- WhatsApp (Embedded Signup) ----------------

export async function completeWhatsAppSignupAction(input: { code: string; wabaId: string; phoneNumberId?: string | null }): Promise<ActionState> {
  const profile = await requireAdmin();
  if (!whatsappReady()) return { errors: { _form: "A conexão com a Meta ainda não foi configurada no servidor." } };
  if (!input.code || !/^\d+$/.test(input.wabaId)) return { errors: { _form: "A janela da Meta não devolveu os dados da conta. Tente de novo." } };
  try {
    await completeEmbeddedSignup({ code: input.code, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, userId: profile.id });
  } catch (e) {
    return { errors: { _form: (e as Error).message } };
  }
  refresh();
  return { ok: true, message: "WhatsApp conectado. A cópia dos contatos e das conversas antigas chega nos próximos minutos." };
}

// ---------------- Modo de demonstração (sem Meta) ----------------

const DEMO_PHONE_ID = "demo-phone-number";
const DEMO_DISPLAY = "550000000000";

export async function createDemoWhatsAppAction() {
  const profile = await requireAdmin();
  const admin = createAdminClient();
  const { data: existing } = await admin.from("channel_accounts").select("id").eq("kind", "whatsapp").eq("is_demo", true).maybeSingle();
  if (!existing) {
    await admin.from("channel_accounts").insert({
      kind: "whatsapp",
      label: "WhatsApp (demonstração)",
      address: DEMO_DISPLAY,
      status: "conectado",
      is_demo: true,
      config: { phone_number_id: DEMO_PHONE_ID, demo: true } as Json,
      connected_by: profile.id,
    });
  }
  refresh();
}

const simSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(80),
  phone: z.string().transform((v) => v.replace(/\D/g, "")).refine((v) => v.length >= 10 && v.length <= 15, "Número inválido"),
  text: z.string().trim().min(1, "Escreva a mensagem").max(1000),
});

/** Simula uma mensagem chegando pela Meta: usa exatamente o mesmo processamento do webhook real. */
export async function simulateIncomingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = simSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values: formValues(formData) };
  const phone = parsed.data.phone.length <= 11 ? `55${parsed.data.phone}` : parsed.data.phone;
  const payload = buildIncomingPayload({
    phoneNumberId: DEMO_PHONE_ID,
    displayPhone: DEMO_DISPLAY,
    from: phone,
    name: parsed.data.name,
    text: parsed.data.text,
    id: `wamid.demo.${crypto.randomUUID()}`,
  });
  await processWhatsAppPayload(payload);
  refresh();
  return { ok: true, message: "Mensagem simulada recebida. Veja em Conversas." };
}

export async function removeDemoAction() {
  await requireAdmin();
  const admin = createAdminClient();
  // Apaga o canal de demonstração e, em cascata, as conversas e mensagens fictícias
  await admin.from("channel_accounts").delete().eq("is_demo", true);
  refresh();
}
