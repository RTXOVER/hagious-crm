import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/ids";
import { todaySP } from "@/lib/documents";
import { createDocumentAction } from "../actions";
import { NewDocumentForm } from "../doc-forms";

export const metadata: Metadata = { title: "Nova pendência" };

export default async function NewDocumentPage(props: PageProps<"/documentos/novo">) {
  const supabase = await createClient();
  const [, sp, { data: clients }, { data: types }, { data: people }] = await Promise.all([
    requireProfile(),
    props.searchParams,
    supabase.from("clients").select("id, legal_name, trade_name").eq("status", "ativo").order("legal_name").limit(2000),
    supabase.from("document_types").select("id, name, department, default_periodicity, default_due_day, description").eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name, department").eq("active", true).order("full_name"),
  ]);
  const initial = typeof sp.cliente === "string" && isUuid(sp.cliente) ? sp.cliente : undefined;

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Nova pendência de documento</h1>
        <p className="mt-1 text-sm text-muted">Para um pedido pontual (ex.: contrato social atualizado). Os lembretes saem automaticamente.</p>
      </div>
      <NewDocumentForm
        action={createDocumentAction}
        clients={clients ?? []}
        types={(types ?? []).filter((t) => t.department !== "atendimento") as Parameters<typeof NewDocumentForm>[0]["types"]}
        people={people ?? []}
        initialClientId={initial}
        today={todaySP()}
      />
    </>
  );
}
