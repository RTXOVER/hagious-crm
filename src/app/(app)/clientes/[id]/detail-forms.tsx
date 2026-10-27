"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/auth";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import { FormMessage } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { departmentOptions, peopleOptions } from "@/components/ui/options";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function AddServiceForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const err = state.errors ?? {};
  const v = state.ok ? undefined : state.values;

  return (
    <form action={formAction} className="mt-4 space-y-3 border-t border-line pt-4" key={JSON.stringify(state)}>
      <p className="text-sm font-bold">Adicionar serviço</p>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end">
        <div>
          <label htmlFor="svc-dep" className="label">Departamento</label>
          <Select id="svc-dep" name="department" defaultValue={v?.department ?? "contabil"} options={departmentOptions()} />
        </div>
        <div>
          <label htmlFor="svc-desc" className="label">Descrição</label>
          <input id="svc-desc" name="description" className="input" placeholder="Ex.: Folha de pagamento" defaultValue={v?.description ?? ""} />
          {err.description && <p className="field-error">{err.description}</p>}
        </div>
        <div>
          <label htmlFor="svc-start" className="label">Início</label>
          <input id="svc-start" name="started_on" type="date" className="input" defaultValue={v?.started_on ?? ""} />
        </div>
        <button className="btn-secondary" disabled={pending}>{pending ? "Salvando…" : "Adicionar"}</button>
      </div>
    </form>
  );
}

export function ResponsiblesForm({
  action,
  current,
  people,
}: {
  action: Action;
  current: Partial<Record<string, string>>;
  people: { id: string; full_name: string; department: string | null }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      {OPERATIONAL_DEPARTMENTS.map((d) => (
        <div key={d}>
          <label htmlFor={`resp_${d}`} className="label">{DEPARTMENT_LABEL[d]}</label>
          {/* Pessoas do próprio departamento primeiro */}
          <Select id={`resp_${d}`} name={`resp_${d}`} defaultValue={current[d] ?? ""} searchable
            options={peopleOptions(people, { empty: "Sem responsável", department: d })} />
        </div>
      ))}
      <button className="btn-secondary" disabled={pending}>{pending ? "Salvando…" : "Salvar responsáveis"}</button>
    </form>
  );
}

/** Botão que pede confirmação antes de enviar uma ação destrutiva. */
export function ConfirmButton({
  action,
  label,
  question,
}: {
  action: () => Promise<void>;
  label: string;
  question: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(question)) e.preventDefault();
      }}
    >
      <button type="submit" className="text-xs font-semibold text-danger hover:underline">{label}</button>
    </form>
  );
}
