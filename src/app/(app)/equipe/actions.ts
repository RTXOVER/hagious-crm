"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/**
 * Edita nome, e-mail, cargo, departamento e acesso de uma pessoa da equipe (somente admin).
 * O administrador não pode rebaixar nem desativar a própria conta (evita ficar sem acesso).
 */
export async function updateMemberAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!isUuid(userId)) return { errors: { _form: "Usuário inválido." } };
  const values = formValues(formData);

  const parsed = newUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    department: formData.get("department") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const input = parsed.data;
  const active = formData.get("active") === "on";

  if (userId === admin.id && (input.role !== "admin" || !active)) {
    return { errors: { _form: "Você não pode remover seu próprio acesso de administrador." }, values };
  }

  const supabase = await createClient();
  const service = createAdminClient();
  const { data: current } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (!current) return { errors: { _form: "Pessoa não encontrada." }, values };

  // E-mail de acesso: muda primeiro no login (Supabase Auth); se falhar, nada é alterado
  const emailChanged = current.email !== input.email;
  if (emailChanged) {
    const { error: authError } = await service.auth.admin.updateUserById(userId, { email: input.email, email_confirm: true });
    if (authError) {
      const exists = /already|registered|exists/i.test(authError.message ?? "");
      if (!exists) console.error("[equipe] trocar e-mail", authError);
      return { errors: exists ? { email: "Já existe uma conta com este e-mail." } : { _form: "Não foi possível alterar o e-mail." }, values };
    }
  }

  // Perfil com a sessão do admin: a auditoria registra quem alterou
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: input.full_name, email: input.email, role: input.role, department: input.department, active })
    .eq("id", userId);
  if (error) {
    console.error("[equipe] atualizar", error);
    if (emailChanged) await service.auth.admin.updateUserById(userId, { email: current.email, email_confirm: true });
    return { errors: { _form: "Não foi possível salvar. Nada foi alterado." }, values };
  }

  // Desativado: bloqueia também o login e as sessões existentes no Supabase Auth
  const { error: banError } = await service.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  if (banError) console.error("[equipe] bloqueio", banError);

  revalidatePath("/equipe");
  revalidatePath(`/equipe/${userId}`);
  return { ok: true, message: "Alterações salvas." };
}

/** Gera uma nova senha provisória (ex.: a pessoa esqueceu a senha). Somente admin. */
export async function resetPasswordAction(userId: string): Promise<CreateUserState> {
  const admin = await requireAdmin();
  if (!isUuid(userId)) return { errors: { _form: "Usuário inválido." } };
  if (userId === admin.id) return { errors: { _form: "Para a sua própria conta, use “Minha conta”." } };

  const service = createAdminClient();
  const password = temporaryPassword();
  const { error } = await service.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error("[equipe] nova senha", error);
    return { errors: { _form: "Não foi possível gerar a nova senha." } };
  }
  await service.from("audit_log").insert({
    table_name: "profiles", record_id: userId, action: "UPDATE", actor_id: admin.id,
    new_data: { senha_redefinida_por: admin.id },
  });
  return { ok: true, tempPassword: password };
}

/**
 * Exclui a conta (somente admin; nunca a própria). As responsabilidades sobre clientes são
 * transferidas para outra pessoa ou removidas — o banco não permite apagar quem ainda é responsável.
 */
export async function deleteMemberAction(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!isUuid(userId)) return { errors: { _form: "Usuário inválido." } };
  if (userId === admin.id) return { errors: { _form: "Você não pode excluir a sua própria conta." } };
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "EXCLUIR") {
    return { errors: { confirm: "Digite EXCLUIR para confirmar." } };
  }
  const transferTo = String(formData.get("transfer_to") ?? "");
  if (transferTo && (!isUuid(transferTo) || transferTo === userId)) return { errors: { _form: "Pessoa de destino inválida." } };

  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
  if (!target) return { errors: { _form: "Pessoa não encontrada." } };
  if (transferTo) {
    const { data: dest } = await supabase.from("profiles").select("id").eq("id", transferTo).eq("active", true).maybeSingle();
    if (!dest) return { errors: { _form: "A pessoa escolhida para receber as responsabilidades não está ativa." } };
  }

  // Responsabilidades: com a sessão do admin, para ficar no histórico com o autor
  const { error: respError } = transferTo
    ? await supabase.from("client_responsibles").update({ user_id: transferTo }).eq("user_id", userId)
    : await supabase.from("client_responsibles").delete().eq("user_id", userId);
  if (respError) {
    console.error("[equipe] responsabilidades", respError);
    return { errors: { _form: "Não foi possível transferir as responsabilidades. Nada foi excluído." } };
  }

  const service = createAdminClient();
  const { error } = await service.auth.admin.deleteUser(userId); // remove também o perfil (cascata)
  if (error) {
    console.error("[equipe] excluir", error);
    return { errors: { _form: "Não foi possível excluir a conta." } };
  }
  await service.from("audit_log").insert({
    table_name: "profiles", record_id: userId, action: "DELETE", actor_id: admin.id,
    old_data: { email: target.email, full_name: target.full_name, excluido_por: admin.id, responsabilidades_para: transferTo || null },
  });

  revalidatePath("/equipe");
  redirect("/equipe?excluido=1");
}
