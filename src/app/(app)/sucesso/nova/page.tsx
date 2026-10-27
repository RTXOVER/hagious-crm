import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/ids";
import { todaySP } from "@/lib/documents";
import { SUCCESS_TYPES } from "@/lib/success";
import { createSuccessAction } from "../actions";
import { NewSuccessForm } from "../success-forms";

export const metadata: Metadata = { title: "Programar ação" };

export default async function NewSuccessPage(props: PageProps<"/sucesso/nova">) {
  const supabase = await createClient();
  const [profile, sp, { data: clients }, { data: people }] = await Promise.all([
    requireProfile(),
    props.searchParams,
    supabase.from("clients").select("id, legal_name, trade_name").eq("status", "ativo").order("legal_name").limit(2000),
    supabase.from("profiles").select("id, full_name, department").eq("active", true).order("full_name"),
  ]);
  const initial = typeof sp.cliente === "string" && isUuid(sp.cliente) ? sp.cliente : undefined;
  const type = SUCCESS_TYPES.find((t) => t === sp.tipo);

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Programar ação de sucesso do cliente</h1>
        <p className="mt-1 text-sm text-muted">Registre o contato antes que o cliente precise pedir. O responsável é lembrado na data.</p>
      </div>
      <NewSuccessForm
        action={createSuccessAction}
        clients={clients ?? []}
        people={people ?? []}
        initialClientId={initial}
        initialType={type}
        currentUserId={profile.id}
        today={todaySP()}
      />
    </>
  );
}
