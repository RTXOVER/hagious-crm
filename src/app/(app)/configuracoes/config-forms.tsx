"use client";

import { startTransition, useActionState, useState } from "react";
import { LoaderCircle, Plus, Save } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import { FormMessage } from "@/components/page-header";

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
          <label className="label">Departamento</label>
          <select name="department" className="input" defaultValue={initial?.department ?? "contabil"}>
            {OPERATIONAL_DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Prazo de resolução</label>
          <div className="flex gap-2">
            <input name="resolution_value" type="number" min={1} className="input w-24" defaultValue={initial?.resolution_value ?? 1} />
            <select name="resolution_unit" className="input" defaultValue={initial?.resolution_unit ?? "dias_uteis"}>
              <option value="horas_uteis">horas úteis</option>
              <option value="dias_uteis">dias úteis</option>
            </select>
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
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
            <input type="checkbox" name="active" defaultChecked={initial.active} className="h-4 w-4 accent-brand-600" /> Ativo (aparece ao abrir tickets)
          </label>
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
          <label className="label">Abrangência</label>
          <select name="scope" className="input" defaultValue="municipal">
            <option value="municipal">Municipal</option>
            <option value="estadual">Estadual</option>
            <option value="empresa">Empresa (recesso)</option>
            <option value="nacional">Nacional</option>
          </select>
        </div>
        <button className="btn-secondary" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar
        </button>
      </div>
    </form>
  );
}
