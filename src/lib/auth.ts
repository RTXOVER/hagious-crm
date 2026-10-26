import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Usuário logado + perfil (uma consulta por requisição).
 * Retorna null se não houver sessão válida ou se o perfil estiver inativo.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.active) return null;
  return profile;
});

/** Exige login. Use no início de páginas e ações do servidor. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

export const isManager = (p: Pick<Profile, "role">) => p.role === "admin" || p.role === "gestor";
export const isAdmin = (p: Pick<Profile, "role">) => p.role === "admin";

/** Exige gestor ou admin; caso contrário volta para o início. */
export async function requireManager(): Promise<Profile> {
  const profile = await requireProfile();
  if (!isManager(profile)) redirect("/?erro=sem-permissao");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (!isAdmin(profile)) redirect("/?erro=sem-permissao");
  return profile;
}

/** Resultado padrão das ações de formulário. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Valores enviados, para repreencher o formulário quando houver erro. */
  values?: Record<string, string>;
};

/** Copia os campos de texto do formulário (ignora campos internos do Next). */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  });
  return out;
}
