import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/ids";
import { TicketForm } from "./ticket-form";

export const metadata: Metadata = { title: "Novo ticket" };

export default async function NewTicketPage(props: PageProps<"/tickets/novo">) {
  const supabase = await createClient();
  const [, sp, { data: clients }, { data: categories }, { data: people }] = await Promise.all([
    requireProfile(),
    props.searchParams,
    // Só clientes que a pessoa pode ver (regra do banco)
    supabase.from("clients").select("id, legal_name, trade_name").neq("status", "encerrado").order("legal_name").limit(2000),
    supabase.from("ticket_categories").select("id, name, department, resolution_value, resolution_unit, needs_review").eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name, department").eq("active", true).order("full_name"),
  ]);
  const initial = typeof sp.cliente === "string" && isUuid(sp.cliente) ? sp.cliente : undefined;
  // Vindo de Conversas: título, descrição e origem da mensagem
  const text = (k: string, max: number) => (typeof sp[k] === "string" ? String(sp[k]).slice(0, max) : undefined);
  const origem = text("origem", 20);
  const prefill = {
    title: text("titulo", 200),
    description: text("descricao", 2000),
    origin: origem === "whatsapp" || origem === "email" ? (origem as "whatsapp" | "email") : undefined,
  };

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Novo ticket</h1>
        <p className="mt-1 text-sm text-muted">Registre o pedido do cliente. O prazo é calculado automaticamente pelo tipo de solicitação.</p>
      </div>
      <TicketForm
        clients={clients ?? []}
        categories={(categories ?? []).filter((c) => c.department !== "atendimento") as Parameters<typeof TicketForm>[0]["categories"]}
        people={people ?? []}
        initialClientId={initial}
        initial={prefill}
      />
    </>
  );
}
