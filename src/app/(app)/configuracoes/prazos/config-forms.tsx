"use client";

import { startTransition, useActionState, useState } from "react";
import { LoaderCircle, Plus, Save } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { FormMessage } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/controls";
import { departmentOptions } from "@/components/ui/options";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function useForm(action: Action) {
  const [state, dispatch, pending] = useActionState(action, {});
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, submit, pending, err: state.errors ?? {} };
}

const DAYS = [
  [1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"],
] as const;

export function SettingsForm({
  action,
  initial,
  canEdit,
}: {
  action: Action;
  initial: { work_start: string; work_end: string; workdays: number[]; risk_percent: number; default_first_response_minutes: number };
  canEdit: boolean;
}) {
  const { state, submit, pending, err } = useForm(action);
  const [days, setDays] = useState<number[]>(initial.workdays);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="work_start" className="label">Início do expediente</label>
            <input id="work_start" name="work_start" type="time" className="input" defaultValue={initial.work_start.slice(0, 5)} />
            {err.work_start && <p className="field-error">{err.work_start}</p>}
          </div>
          <div>
            <label htmlFor="work_end" className="label">Fim do expediente</label>
            <input id="work_end" name="work_end" type="time" className="input" defaultValue={initial.work_end.slice(0, 5)} />
            {err.work_end && <p className="field-error">{err.work_end}</p>}
          </div>
        </div>
        <fieldset>
          <legend className="label">Dias com expediente</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(([n, l]) => {
              const on = days.includes(n);
              return (
                <label key={n} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-link" : "border-line hover:border-brand-500/60"}`}>
                  <input type="checkbox" name="workdays" value={n} checked={on} className="sr-only"
                    onChange={(e) => setDays((d) => (e.target.checked ? [...d, n] : d.filter((x) => x !== n)))} />
                  {l}
                </label>
              );
            })}
          </div>
          {err.workdays && <p className="field-error">{err.workdays}</p>}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="risk_percent" className="label">Alerta preventivo quando restar (%)</label>
            <input id="risk_percent" name="risk_percent" type="number" min={5} max={90} className="input" defaultValue={initial.risk_percent} />
            <p className="mt-1 text-xs text-muted">Ex.: 25 = avisa quando faltar 1/4 do prazo.</p>
            {err.risk_percent && <p className="field-error">{err.risk_percent}</p>}
          </div>
          <div>
            <label htmlFor="default_first_response_hours" className="label">1ª resposta padrão (horas úteis)</label>
            <input id="default_first_response_hours" name="default_first_response_hours" type="number" step="0.25" min={0.25} className="input"
              defaultValue={initial.default_first_response_minutes / 60} />
            <p className="mt-1 text-xs text-muted">Usado quando o tipo de solicitação não define o seu.</p>
            {err.default_first_response_hours && <p className="field-error">{err.default_first_response_hours}</p>}
          </div>
        </div>
        {canEdit && (
          <button className="btn-primary" disabled={pending}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar expediente
          </button>
        )}
      </fieldset>
      {!canEdit && <p className="text-xs text-muted">Somente administradores alteram o expediente.</p>}
    </form>
  );
}

type Category = {
  name: string; department: "contabil" | "fiscal" | "dp"; resolution_value: number;
  resolution_unit: "horas_uteis" | "dias_uteis"; first_response_minutes: number | null; active: boolean;
};

export function CategoryForm({ action, initial, submitLabel }: { action: Action; initial?: Category; submitLabel: string }) {
  const { state, submit, pending, err } = useForm(action);
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nome do tipo</label>
          <input name="name" className="input" defaultValue={initial?.name} placeholder="Ex.: Admissão de funcionário" />
          {err.name && <p className="field-error">{err.name}</p>}
        </div>
        <div>
          <p className="label">Departamento</p>
          <Select name="department" aria-label="Departamento" defaultValue={initial?.department ?? "contabil"} options={departmentOptions()} />
        </div>
        <div>
          <p className="label">Prazo de resolução</p>
          <div className="flex gap-2">
            <input name="resolution_value" type="number" min={1} className="input w-24" aria-label="Quantidade" defaultValue={initial?.resolution_value ?? 1} />
            <Select name="resolution_unit" aria-label="Unidade" className="flex-1" defaultValue={initial?.resolution_unit ?? "dias_uteis"}
              options={[{ value: "horas_uteis", label: "horas úteis", badge: "H" }, { value: "dias_uteis", label: "dias úteis", badge: "D" }]} />
          </div>
          {err.resolution_value && <p className="field-error">{err.resolution_value}</p>}
        </div>
        <div>
          <label className="label">1ª resposta (horas úteis)</label>
          <input name="first_response_hours" className="input" inputMode="decimal" placeholder="Usar o padrão"
            defaultValue={initial?.first_response_minutes ? String(initial.first_response_minutes / 60) : ""} />
          {err.first_response_hours && <p className="field-error">{err.first_response_hours}</p>}
        </div>
        {initial && (
          <div className="self-end pb-1">
            <Switch name="active" defaultChecked={initial.active} label="Ativo" description="Aparece ao abrir tickets" />
          </div>
        )}
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : initial ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {submitLabel}
      </button>
    </form>
  );
}

export function HolidayForm({ action }: { action: Action }) {
  const { state, submit, pending, err } = useForm(action);
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end">
        <div>
          <label className="label">Data</label>
          <input name="day" type="date" className="input" />
          {err.day && <p className="field-error">{err.day}</p>}
        </div>
        <div>
          <label className="label">Nome</label>
          <input name="name" className="input" placeholder="Ex.: Aniversário da cidade" />
          {err.name && <p className="field-error">{err.name}</p>}
        </div>
        <div>
          <p className="label">Abrangência</p>
          <Select name="scope" aria-label="Abrangência" defaultValue="municipal"
            options={[
              { value: "municipal", label: "Municipal", dot: "#2f6fc4" },
              { value: "estadual", label: "Estadual", dot: "#8a5cd6" },
              { value: "empresa", label: "Empresa", hint: "Recesso", dot: "#c27a12" },
              { value: "nacional", label: "Nacional", dot: "#1f8a6a" },
            ]} />
        </div>
        <button className="btn-secondary" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar
        </button>
      </div>
    </form>
  );
}
