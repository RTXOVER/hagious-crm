import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "../../client-form";
import { deleteClientAction, updateClientAction } from "../../actions";
import { DeleteClientButton } from "../client-admin-actions";
import { isUuid } from "@/lib/validation/ids";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditClientPage(props: PageProps<"/clientes/[id]/editar">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const count = (table: "client_contacts" | "client_services" | "client_responsibles") =>
    supabase.from(table).select("client_id", { count: "exact", head: true }).eq("client_id", id);
  const [profile, { data: client }, contacts, services, responsibles] = await Promise.all([
    requireManager(),
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    count("client_contacts"),
    count("client_services"),
    count("client_responsibles"),
  ]);
  if (!client) notFound();

  return (
    <>
      <PageHeader title="Editar cliente" description={client.legal_name} />
      <div className="max-w-3xl space-y-6">
        <ClientForm action={updateClientAction.bind(null, id)} client={client} cancelHref={`/clientes/${id}`} />

        {profile.role === "admin" && (
          <section className="card border-danger/30 p-6" aria-labelledby="zona-perigo">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 id="zona-perigo" className="font-extrabold text-danger">Zona de perigo</h2>
                <p className="mt-1 max-w-md text-sm text-muted">
                  Excluir remove o cliente e todos os dados ligados a ele de forma permanente. Se ele apenas deixou a
                  Hagious, prefira mudar a situação para Encerrado.
                </p>
              </div>
              <DeleteClientButton
                clientName={client.legal_name}
                counts={{
                  contacts: contacts.count ?? 0,
                  services: services.count ?? 0,
                  responsibles: responsibles.count ?? 0,
                }}
                action={deleteClientAction.bind(null, id)}
              />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
