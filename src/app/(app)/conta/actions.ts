"use server";

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { requireProfile, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { passwordSchema, fieldErrors } from "@/lib/validation/schemas";

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  const current = String(formData.get("current") ?? "");
  if (!current) return { errors: { current: "Informe a senha atual." } };
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // Confere a senha atual sem mexer na sessão aberta (cliente separado, sem cookies)
  const env = publicEnv();
  const check = createPlainClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: wrong } = await check.auth.signInWithPassword({ email: profile.email, password: current });
  if (wrong) return { errors: { current: "Senha atual incorreta." } };
  await check.auth.signOut({ scope: "local" }).catch(() => undefined); // encerra só a sessão de conferência

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { errors: { password: "A nova senha deve ser diferente da atual." } };
    if (error.code === "weak_password") return { errors: { password: "Senha fraca. Use letras e números, mínimo 10 caracteres." } };
    console.error("[conta] trocar senha", error);
    return { errors: { _form: "Não foi possível trocar a senha." } };
  }
  return { ok: true, message: "Senha alterada com sucesso." };
}
