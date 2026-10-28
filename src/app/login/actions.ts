"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LAST_SEEN_COOKIE } from "@/lib/security/headers";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/auth";
import { loginBlocked, recordLogin } from "@/lib/security/throttle";
import { clearPreferencesCookie, loadPreferencesFromDb, writePreferencesCookie } from "@/lib/preferences-server";

/** Aceita apenas caminhos internos, evitando redirecionamento para sites externos. */
function safeNext(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  // Só caminhos deste site: rejeita "//", "/\" e caracteres de controle (ex.: "/\t/site.com" vira "//site.com")
  if (!v.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(v)) return "/";
  try {
    const u = new URL(v, "http://crm.local");
    return u.origin === "http://crm.local" ? `${u.pathname}${u.search}${u.hash}` : "/";
  } catch {
    return "/";
  }
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const values = { email };
  if (!email || !password) return { errors: { _form: "Informe e-mail e senha." }, values };
  if (email.length > 254 || password.length > 200) return { errors: { _form: "E-mail ou senha incorretos." }, values };

  // Bloqueio contra tentativas em série: nem confere a senha enquanto estiver bloqueado
  const wait = await loginBlocked(email);
  if (wait) {
    return { errors: { _form: `Muitas tentativas sem sucesso. Por segurança, tente de novo em ${wait} ${wait === 1 ? "minuto" : "minutos"}.` }, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  await recordLogin(email, !error && !!data.user);
  // Mensagem genérica: não revela se o e-mail existe
  if (error || !data.user) return { errors: { _form: "E-mail ou senha incorretos." }, values };

  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { errors: { _form: "Seu acesso está desativado. Procure o administrador." } };
  }

  // Começa a contar o tempo sem uso a partir deste login
  (await cookies()).delete(LAST_SEEN_COOKIE);
  // Aplica as preferências salvas da pessoa (tema, letra, região) neste navegador
  await writePreferencesCookie(await loadPreferencesFromDb());
  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(LAST_SEEN_COOKIE);
  // Em computador compartilhado, a próxima pessoa não herda as preferências
  await clearPreferencesCookie();
  redirect("/login");
}
