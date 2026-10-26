"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/ids";

/** Prévia dos prazos (calculada pelo banco, com dias úteis e feriados) para o tipo escolhido. */
export async function previewSlaAction(categoryId: string): Promise<{ firstResponse: string; resolution: string } | null> {
  await requireProfile();
  if (!isUuid(categoryId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sla_preview", { p_category: categoryId });
  if (error || !data?.[0]) return null;
  return { firstResponse: data[0].first_response_due, resolution: data[0].resolution_due };
}
