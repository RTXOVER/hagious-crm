import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { makeFormatter } from "@/lib/format";
import {
  DEFAULT_PREFERENCES,
  PREFS_COOKIE,
  normalizePreferences,
  parsePreferencesCookie,
  serializePreferences,
  type Preferences,
} from "@/lib/preferences";

const COOKIE_OPTIONS = { path: "/", sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 365, httpOnly: false };

/** Lê só o cookie (rápido, sem banco). Usado pelo layout raiz para tema e tamanho da letra. */
export async function readPreferencesCookie(): Promise<Preferences | null> {
  return parsePreferencesCookie((await cookies()).get(PREFS_COOKIE)?.value);
}

/** Preferências da pessoa logada: cookie; se não houver (ex.: outro computador), busca no banco. */
export const getPreferences = cache(async (): Promise<Preferences> => {
  const fromCookie = await readPreferencesCookie();
  if (fromCookie) return fromCookie;
  return loadPreferencesFromDb();
});

export async function loadPreferencesFromDb(): Promise<Preferences> {
  const supabase = await createClient();
  const { data } = await supabase.from("user_preferences").select("*").maybeSingle();
  return data ? normalizePreferences(data) : DEFAULT_PREFERENCES;
}

/** Formatador de datas/valores conforme as preferências (uma vez por requisição). */
export const getFormatter = cache(async () => makeFormatter(await getPreferences()));

/** Grava o cookie (somente em ações do servidor). */
export async function writePreferencesCookie(prefs: Preferences) {
  (await cookies()).set(PREFS_COOKIE, serializePreferences(prefs), COOKIE_OPTIONS);
}

export async function clearPreferencesCookie() {
  (await cookies()).delete(PREFS_COOKIE);
}
