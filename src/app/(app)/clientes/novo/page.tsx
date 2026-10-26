import type { Metadata } from "next";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClientWizard } from "./client-wizard";

export const metadata: Metadata = { title: "Novo cliente" };

export default async function NewClientPage() {
  const supabase = await createClient();
  const [, { data: people }] = await Promise.all([
    requireManager(),
    supabase.from("profiles").select("id, full_name, department").eq("active", true).order("full_name"),
  ]);

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Novo cliente</h1>
        <p className="mt-1 text-sm text-muted">Leva cerca de 1 minuto. Só a razão social e o CNPJ são obrigatórios.</p>
      </div>
      <ClientWizard people={people ?? []} />
    </>
  );
}
