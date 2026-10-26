import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/validation/ids";
import { saveContactAction } from "../../../actions";
import { ContactForm } from "../contact-form";

export const metadata: Metadata = { title: "Editar contato" };

export default async function EditContactPage(props: PageProps<"/clientes/[id]/contatos/[contactId]">) {
  await requireProfile();
  const { id, contactId } = await props.params;
  if (!isUuid(id) || !isUuid(contactId)) notFound();

  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("client_contacts")
    .select("*")
    .eq("id", contactId)
    .eq("client_id", id)
    .maybeSingle();
  if (!contact) notFound();

  return (
    <>
      <PageHeader title="Editar contato" description={contact.name} />
      <div className="max-w-3xl">
        <ContactForm
          action={saveContactAction.bind(null, id, contactId)}
          contact={contact}
          cancelHref={`/clientes/${id}`}
        />
      </div>
    </>
  );
}
