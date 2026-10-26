"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { formatPhone } from "@/lib/validation/cnpj";
import { FormMessage } from "@/components/page-header";
import { Field } from "../../client-form";

type Contact = Database["public"]["Tables"]["client_contacts"]["Row"];

export function ContactForm({
  action,
  contact,
  cancelHref,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  contact?: Contact;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const err = state.errors ?? {};
  const sv = state.values;
  const text = (name: string, fallback?: string | null) => sv?.[name] ?? fallback ?? "";
  const check = (name: string, fallback: boolean) => (sv ? sv[name] === "on" : fallback);

  return (
    <form action={formAction} className="card space-y-5 p-6" noValidate key={JSON.stringify(sv ?? {})}>
      <FormMessage state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome *" name="name" error={err.name} defaultValue={text("name", contact?.name)} required />
        <Field label="Cargo / função" name="job_title" error={err.job_title} defaultValue={text("job_title", contact?.job_title)} />
        <Field label="E-mail" name="email" type="email" error={err.email} defaultValue={text("email", contact?.email)} />
        <Field
          label="WhatsApp"
          name="whatsapp"
          error={err.whatsapp}
          defaultValue={text("whatsapp", contact?.whatsapp ? formatPhone(contact.whatsapp) : "")}
          placeholder="(11) 99999-8888"
          inputMode="tel"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_primary" defaultChecked={check("is_primary", contact?.is_primary ?? false)} />
        Contato principal da empresa
      </label>

      <div className="rounded-lg bg-surface-2 p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="whatsapp_opt_in"
            className="mt-1"
            defaultChecked={check("whatsapp_opt_in", contact?.whatsapp_opt_in ?? false)}
          />
          <span>
            <span className="font-semibold">O contato autorizou receber mensagens da Hagious pelo WhatsApp</span>
            <span className="block text-muted">
              Necessário para enviar lembretes automáticos. Marque somente se a autorização foi efetivamente obtida
              (a data e o responsável pelo registro ficam gravados).
            </span>
          </span>
        </label>
        {err.whatsapp_opt_in && <p className="field-error">{err.whatsapp_opt_in}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar contato"}</button>
        <Link href={cancelHref} className="btn-secondary">Cancelar</Link>
      </div>
    </form>
  );
}
