"use server";

import { requireProfile, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { passwordSchema, fieldErrors } from "@/lib/validation/schemas";

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireProfile();
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

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
