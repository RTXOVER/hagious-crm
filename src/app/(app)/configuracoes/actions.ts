"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, type ActionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizePreferences, type Preferences } from "@/lib/preferences";
import { getPreferences, writePreferencesCookie } from "@/lib/preferences-server";

/** Salva preferências pessoais (no banco e no cookie deste navegador). Valores inválidos viram o padrão. */
async function save(partial: Partial<Preferences>): Promise<ActionState> {
  const profile = await requireProfile();
  const next = normalizePreferences({ ...(await getPreferences()), ...partial });
  const supabase = await createClient();
  const { error } = await supabase.from("user_preferences").upsert({ user_id: profile.id, ...next }, { onConflict: "user_id" });
  if (error) {
    console.error("[preferencias]", error);
    return { errors: { _form: "Não foi possível salvar. Tente novamente." } };
  }
  await writePreferencesCookie(next);
  revalidatePath("/", "layout");
  return { ok: true, message: "Preferências salvas." };
}

/** Tema e tamanho da letra: salvos na hora, ao clicar. */
export async function saveVisualAction(partial: Pick<Partial<Preferences>, "theme" | "font_scale">): Promise<ActionState> {
  // Só o que veio preenchido (um campo indefinido não pode apagar a escolha atual)
  const change: Partial<Preferences> = {};
  if (partial.theme) change.theme = partial.theme;
  if (partial.font_scale) change.font_scale = partial.font_scale;
  return save(change);
}

export async function saveRegionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const get = (k: string) => String(formData.get(k) ?? "");
  const result = await save({
    language: get("language") as Preferences["language"],
    date_format: get("date_format") as Preferences["date_format"],
    time_format: get("time_format") as Preferences["time_format"],
    timezone: get("timezone"),
    currency: get("currency") as Preferences["currency"],
  });
  return result.ok ? { ok: true, message: "Idioma e região salvos. Datas e horários já seguem o novo formato." } : result;
}
