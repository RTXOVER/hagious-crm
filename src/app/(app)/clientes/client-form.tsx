"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { CLIENT_STATUS_LABEL, TAX_REGIME_LABEL } from "@/lib/labels";
import { formatCnpj, formatPhone } from "@/lib/validation/cnpj";
import { FormMessage } from "@/components/page-header";

type Client = Database["public"]["Tables"]["clients"]["Row"];

export function ClientForm({
  action,
  client,
  cancelHref,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  client?: Client;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const err = state.errors ?? {};
  // Após erro, mostra o que foi digitado; senão, os dados atuais do cliente
  const v = (name: keyof Client, fallback?: string | null) => state.values?.[name] ?? fallback ?? "";
  // key força o React a recriar os selects com o novo valor padrão
  const formKey = JSON.stringify(state.values ?? {});

  return (
    <form action={formAction} className="card space-y-5 p-6" noValidate>
      <FormMessage state={state} />

      <div className="grid gap-4 md:grid-cols-2" key={formKey}>
        <Field label="Razão social *" name="legal_name" error={err.legal_name} defaultValue={v("legal_name", client?.legal_name)} required />
        <Field label="Nome fantasia" name="trade_name" error={err.trade_name} defaultValue={v("trade_name", client?.trade_name)} />
        <Field
          label="CNPJ *"
          name="cnpj"
          error={err.cnpj}
          defaultValue={v("cnpj", client ? formatCnpj(client.cnpj) : "")}
          placeholder="00.000.000/0000-00"
          inputMode="numeric"
          required
        />
        <div>
          <label htmlFor="tax_regime" className="label">Regime tributário *</label>
          <select id="tax_regime" name="tax_regime" className="input" defaultValue={v("tax_regime", client?.tax_regime ?? "simples_nacional")}>
            {Object.entries(TAX_REGIME_LABEL).map(([val, l]) => (
              <option key={val} value={val}>{l}</option>
            ))}
          </select>
          {err.tax_regime && <p className="field-error">{err.tax_regime}</p>}
        </div>
        <div>
          <label htmlFor="status" className="label">Situação *</label>
          <select id="status" name="status" className="input" defaultValue={v("status", client?.status ?? "ativo")}>
            {Object.entries(CLIENT_STATUS_LABEL).map(([val, l]) => (
              <option key={val} value={val}>{l}</option>
            ))}
          </select>
        </div>
        <Field label="Cliente desde" name="client_since" type="date" error={err.client_since} defaultValue={v("client_since", client?.client_since)} />
        <Field label="E-mail da empresa" name="email" type="email" error={err.email} defaultValue={v("email", client?.email)} />
        <Field
          label="Telefone da empresa"
          name="phone"
          error={err.phone}
          defaultValue={v("phone", client?.phone ? formatPhone(client.phone) : "")}
          placeholder="(11) 3333-4444"
          inputMode="tel"
        />
      </div>
      <Field key={`a${formKey}`} label="Endereço" name="address" error={err.address} defaultValue={v("address", client?.address)} />
      <div key={`n${formKey}`}>
        <label htmlFor="notes" className="label">Observações internas</label>
        <textarea id="notes" name="notes" rows={4} className="input" defaultValue={v("notes", client?.notes)} />
        <p className="mt-1 text-xs text-muted">Evite registrar dados pessoais sensíveis aqui (saúde, religião, etc.).</p>
        {err.notes && <p className="field-error">{err.notes}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
        <Link href={cancelHref} className="btn-secondary">Cancelar</Link>
      </div>
    </form>
  );
}

export function Field({
  label,
  name,
  error,
  defaultValue,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  defaultValue?: string | null;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "name">) {
  return (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      <input
        id={name}
        name={name}
        className="input"
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        {...rest}
      />
      {error && <p id={`${name}-error`} className="field-error">{error}</p>}
    </div>
  );
}
