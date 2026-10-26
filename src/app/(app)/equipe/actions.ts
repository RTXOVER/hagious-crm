"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin, formValues, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { newUserSchema, fieldErrors } from "@/lib/validation/schemas";
import { isUuid } from "@/lib/validation/ids";

/** Senha provisória forte: letras e números, 16 caracteres. */
function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // garante ao menos uma letra e um número
  return `${out}7a`;
}

export type CreateUserState = ActionState & { tempPassword?: string; createdEmail?: string };

export async function createUserAction(_prev: CreateUserState, formData: FormData): Promise<CreateUserState> {
  const admin = await requireAdmin();
  const values = formValues(formData);
  const parsed = newUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    department: formData.get("department") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const input = parsed.data;

  const service = createAdminClient();
  const password = temporaryPassword();
  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (authError || !created.user) {
    const exists = authError?.message?.toLowerCase().includes("already");
    if (!exists) console.error("[equipe] criar usuário", authError);
    return {
      errors: exists ? { email: "Já existe uma conta com este e-mail." } : { _form: "Não foi possível criar a conta." },
      values,
    };
  }

  const { error: profileError } = await service.from("profiles").insert({
    id: created.user.id,
    full_name: input.full_name,
    email: input.email,
    role: input.role,
    department: input.department,
  });
  if (profileError) {
    // Desfaz a conta para não deixar usuário sem perfil
    await service.auth.admin.deleteUser(created.user.id);
    console.error("[equipe] criar perfil", profileError);
    return { errors: { _form: "Não foi possível criar o perfil. Nada foi salvo." }, values };
  }

  // A chave de serviço não tem usuário associado; registra quem criou a conta
  await service.from("audit_log").insert({
    table_name: "profiles",
    record_id: created.user.id,
    action: "INSERT",
    actor_id: admin.id,
    new_data: { criado_por: admin.id, email: input.email, role: input.role, department: input.department },
  });

  revalidatePath("/equipe");
  return { ok: true, message: "Conta criada.", tempPassword: password, createdEmail: input.email };
}

export async function updateMemberAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!isUuid(userId)) return { errors: { _form: "Usuário inválido." } };

  const role = String(formData.get("role") ?? "");
  const depRaw = String(formData.get("department") ?? "");
  const active = formData.get("active") === "on";
  if (!["admin", "gestor", "colaborador"].includes(role)) return { errors: { _form: "Cargo inválido." } };
  if (depRaw && !["contabil", "fiscal", "dp", "atendimento"].includes(depRaw)) {
    return { errors: { _form: "Departamento inválido." } };
  }
  if (role === "colaborador" && !depRaw) return { errors: { _form: "Colaboradores precisam de um departamento." } };
  if (userId === admin.id && (role !== "admin" || !active)) {
    return { errors: { _form: "Você não pode remover seu próprio acesso de administrador." } };
  }

  // Atualiza com a sessão do admin: a auditoria registra quem alterou
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      role: role as "admin" | "gestor" | "colaborador",
      department: (depRaw || null) as "contabil" | "fiscal" | "dp" | "atendimento" | null,
      active,
    })
    .eq("id", userId);
  if (error) {
    console.error("[equipe] atualizar", error);
    return { errors: { _form: "Não foi possível salvar." } };
  }

  // Desativado: bloqueia também o login e as sessões existentes no Supabase Auth
  const service = createAdminClient();
  const { error: banError } = await service.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) console.error("[equipe] bloqueio", banError);

  revalidatePath("/equipe");
  return { ok: true, message: "Alterações salvas." };
}
