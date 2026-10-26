import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "../../client-form";
import { updateClientAction } from "../../actions";
import { isUuid } from "@/lib/validation/ids";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditClientPage(props: PageProps<"/clientes/[id]/editar">) {
  await requireManager();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) notFound();

  return (
    <>
      <PageHeader title="Editar cliente" description={client.legal_name} />
      <div className="max-w-3xl">
        <ClientForm action={updateClientAction.bind(null, id)} client={client} cancelHref={`/clientes/${id}`} />
      </div>
    </>
  );
}
