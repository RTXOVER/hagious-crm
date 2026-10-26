import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/validation/ids";
import { saveContactAction } from "../../../actions";
import { ContactForm } from "../contact-form";

export const metadata: Metadata = { title: "Novo contato" };

export default async function NewContactPage(props: PageProps<"/clientes/[id]/contatos/novo">) {
  await requireProfile();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, legal_name").eq("id", id).maybeSingle();
  if (!client) notFound();

  return (
    <>
      <PageHeader title="Novo contato" description={client.legal_name} />
      <div className="max-w-3xl">
        <ContactForm action={saveContactAction.bind(null, id, null)} cancelHref={`/clientes/${id}`} />
      </div>
    </>
  );
}
