"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Building2, CalendarClock, CheckCircle2, FileCheck2, LoaderCircle, Plus, RotateCcw, Save, Search, X } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import { MONTHS, PERIODICITIES, PERIODICITY_LABEL, describeRule } from "@/lib/documents";
import { Alert, FormMessage } from "@/components/page-header";
import { IconField } from "@/components/form-controls";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Dep = "contabil" | "fiscal" | "dp";
type Periodicity = (typeof PERIODICITIES)[number];
type Person = { id: string; full_name: string; department: string | null };
type DocType = { id: string; name: string; department: Dep; default_periodicity: Periodicity; default_due_day: number; description?: string | null };

function useManualAction(action: Action) {
  const [state, dispatch, pending] = useActionState(action, {});
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, submit, pending, err: state.errors ?? {} };
}

const personLabel = (p: Person) =>
  `${p.full_name}${p.department ? ` (${DEPARTMENT_LABEL[p.department as keyof typeof DEPARTMENT_LABEL]})` : " (gestão)"}`;
const sortPeople = (people: Person[], dep?: string) =>
  [...people].sort((a, b) => Number(b.department === dep) - Number(a.department === dep) || a.full_name.localeCompare(b.full_name));

// ---------------- Situação da pendência ----------------

const STATUS_OPTIONS = [
  { value: "recebido", label: "Recebido", note: "Observação (opcional)", placeholder: "Ex.: recebido pelo WhatsApp, faltou o extrato da conta 2" },
  { value: "dispensado", label: "Dispensar", note: "Motivo da dispensa *", placeholder: "Ex.: sem movimento no mês" },
  { value: "nao_exigivel", label: "Não exigível", note: "Por que deixou de ser exigível? *", placeholder: "Ex.: conta bancária encerrada" },
] as const;

export function DocStatusPanel({ status, action }: { status: string; action: Action }) {
  const { state, submit: send, pending, err: allErr } = useManualAction(action);
  const [target, setTarget] = useState<string | null>(null);
  // Erro do campo vale só para a opção que foi enviada (trocar de opção limpa a mensagem)
  const [sentFor, setSentFor] = useState<string | null>(null);
  const err = sentFor === target ? allErr : {};
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    setSentFor(target);
    send(e);
  };
  const opt = STATUS_OPTIONS.find((o) => o.value === target);

  if (status !== "pendente") {
    return (
      <form onSubmit={submit} className="space-y-3">
        <FormMessage state={state} />
        <input type="hidden" name="status" value="pendente" />
        <p className="text-sm text-muted">Registrado por engano? Volte para pendente e os lembretes recomeçam.</p>
        <button className="btn-secondary w-full" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Voltar para pendente
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={target === o.value}
            onClick={() => setTarget(target === o.value ? null : o.value)}
            className={`btn px-3 py-1.5 text-xs ${target === o.value ? "bg-brand-600 text-white" : o.value === "recebido" ? "btn-secondary border-brand-500 text-link" : "btn-secondary"}`}
          >
            {o.value === "recebido" && <CheckCircle2 className="h-3.5 w-3.5" />} {o.label}
          </button>
        ))}
      </div>
      {opt && (
        <>
          <input type="hidden" name="status" value={opt.value} />
          <div>
            <label htmlFor="doc-note" className="label">{opt.note}</label>
            <textarea id="doc-note" name="note" rows={2} className="input" placeholder={opt.placeholder} />
            {err.note && <p className="field-error">{err.note}</p>}
            <p className="mt-1 text-xs text-muted">Os lembretes deste documento param ao confirmar.</p>
          </div>
          <button className="btn-primary w-full" disabled={pending}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />} Confirmar: {opt.label}
          </button>
        </>
      )}
    </form>
  );
}

/** Botão rápido "Recebido" nas listas. */
export function QuickReceive({ action, label }: { action: Action; label: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  if (result?.ok) return <span className="text-xs font-semibold text-ok">Recebido ✓</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        className="btn-secondary px-2.5 py-1 text-xs"
        disabled={pending}
        aria-label={`Marcar ${label} como recebido`}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("status", "recebido");
            setResult(await action({}, fd));
          })
        }
      >
        {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Recebido
      </button>
      {result?.errors?._form && <span className="mt-1 text-xs text-danger">{result.errors._form}</span>}
    </span>
  );
}

export function DueDateForm({ action, current }: { action: Action; current: string }) {
  const { state, submit, pending, err } = useManualAction(action);
  return (
    <form onSubmit={submit} className="space-y-2">
      <FormMessage state={state} />
      <label htmlFor="due_date" className="label">Novo vencimento</label>
      <div className="flex gap-2">
        <input id="due_date" name="due_date" type="date" className="input" defaultValue={current} />
        <button className="btn-secondary px-3" disabled={pending} aria-label="Salvar vencimento">
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
        </button>
      </div>
      {err.due_date && <p className="field-error">{err.due_date}</p>}
      <p className="text-xs text-muted">Ex.: prazo combinado com o cliente. Os lembretes recomeçam pela nova data.</p>
    </form>
  );
}

export function DocResponsibleForm({ action, current, people, department }: { action: Action; current: string | null; people: Person[]; department: string }) {
  const { state, submit, pending } = useManualAction(action);
  return (
    <form onSubmit={submit} className="space-y-2">
      <FormMessage state={state} />
      <div className="flex gap-2">
        <select name="responsible_id" defaultValue={current ?? ""} className="input" aria-label="Responsável pela cobrança">
          <option value="">Responsável do cliente / departamento</option>
          {sortPeople(people, department).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
        </select>
        <button className="btn-secondary px-3" disabled={pending} aria-label="Salvar responsável">
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}

// ---------------- Exigência do cliente ----------------

type RequirementInitial = {
  document_type_id: string; periodicity: Periodicity; due_day: number; first_month: number | null;
  responsible_id: string | null; starts_on: string; ends_on: string | null; notes: string | null;
};

export function RequirementForm({
  action,
  types,
  people,
  initial,
  today,
  submitLabel,
}: {
  action: Action;
  types: DocType[];
  people: Person[];
  initial?: RequirementInitial;
  today: string;
  submitLabel: string;
}) {
  const { state, submit, pending, err } = useManualAction(action);
  const v = state.ok ? undefined : state.values;
  const [typeId, setTypeId] = useState(v?.document_type_id ?? initial?.document_type_id ?? "");
  const type = types.find((t) => t.id === typeId);
  const [periodicity, setPeriodicity] = useState<Periodicity>((v?.periodicity as Periodicity) ?? initial?.periodicity ?? "mensal");
  const [dueDay, setDueDay] = useState(String(v?.due_day ?? initial?.due_day ?? 10));
  const [firstMonth, setFirstMonth] = useState(String(v?.first_month ?? initial?.first_month ?? 1));

  function chooseType(id: string) {
    setTypeId(id);
    const t = types.find((x) => x.id === id);
    if (t && !initial) {
      setPeriodicity(t.default_periodicity);
      setDueDay(String(t.default_due_day));
    }
  }

  const preview = Number(dueDay) >= 1 && Number(dueDay) <= 31 ? describeRule(periodicity, Number(dueDay), periodicity === "mensal" ? null : Number(firstMonth)) : null;

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`rq-type-${initial ? "e" : "n"}`} className="label">Documento</label>
          {initial ? (
            <>
              <input type="hidden" name="document_type_id" value={typeId} />
              <p className="input bg-surface-2">{type?.name ?? "—"}</p>
            </>
          ) : (
            <select id="rq-type-n" name="document_type_id" className="input" value={typeId} onChange={(e) => chooseType(e.target.value)}>
              <option value="">Escolha…</option>
              {OPERATIONAL_DEPARTMENTS.map((d) => (
                <optgroup key={d} label={DEPARTMENT_LABEL[d]}>
                  {types.filter((t) => t.department === d).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
          {err.document_type_id && <p className="field-error">{err.document_type_id}</p>}
          {type?.description && <p className="mt-1 text-xs text-muted">{type.description}</p>}
        </div>
        <div>
          <label className="label" htmlFor={`rq-per-${initial ? "e" : "n"}`}>Frequência</label>
          <select id={`rq-per-${initial ? "e" : "n"}`} name="periodicity" className="input" value={periodicity} onChange={(e) => setPeriodicity(e.target.value as Periodicity)}>
            {PERIODICITIES.map((p) => <option key={p} value={p}>{PERIODICITY_LABEL[p]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor={`rq-day-${initial ? "e" : "n"}`}>Vence no dia</label>
            <input id={`rq-day-${initial ? "e" : "n"}`} name="due_day" type="number" min={1} max={31} className="input" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </div>
          {periodicity !== "mensal" && (
            <div>
              <label className="label" htmlFor={`rq-mon-${initial ? "e" : "n"}`}>{periodicity === "anual" ? "Mês" : "A partir de"}</label>
              <select id={`rq-mon-${initial ? "e" : "n"}`} name="first_month" className="input" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          )}
          {err.due_day && <p className="field-error col-span-2">{err.due_day}</p>}
          {err.first_month && <p className="field-error col-span-2">{err.first_month}</p>}
        </div>
        {preview && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm sm:col-span-2"><strong>Regra:</strong> {preview}. Dia 31 = último dia do mês.</p>}
        <div>
          <label className="label" htmlFor={`rq-resp-${initial ? "e" : "n"}`}>Quem cobra (opcional)</label>
          <select id={`rq-resp-${initial ? "e" : "n"}`} name="responsible_id" className="input" defaultValue={v?.responsible_id ?? initial?.responsible_id ?? ""}>
            <option value="">Responsável do cliente no departamento</option>
            {sortPeople(people, type?.department).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor={`rq-start-${initial ? "e" : "n"}`}>Exigir a partir de</label>
            <input id={`rq-start-${initial ? "e" : "n"}`} name="starts_on" type="date" className="input" defaultValue={v?.starts_on ?? initial?.starts_on ?? today} />
            {err.starts_on && <p className="field-error">{err.starts_on}</p>}
          </div>
          <div>
            <label className="label" htmlFor={`rq-end-${initial ? "e" : "n"}`}>Até (opcional)</label>
            <input id={`rq-end-${initial ? "e" : "n"}`} name="ends_on" type="date" className="input" defaultValue={v?.ends_on ?? initial?.ends_on ?? ""} />
            {err.ends_on && <p className="field-error">{err.ends_on}</p>}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`rq-notes-${initial ? "e" : "n"}`}>Observações (opcional)</label>
          <input id={`rq-notes-${initial ? "e" : "n"}`} name="notes" className="input" defaultValue={v?.notes ?? initial?.notes ?? ""} placeholder="Ex.: enviar extratos das contas Itaú e Nubank" />
        </div>
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : initial ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {submitLabel}
      </button>
    </form>
  );
}

// ---------------- Nova pendência avulsa ----------------

export function NewDocumentForm({
  action,
  clients,
  types,
  people,
  initialClientId,
  today,
}: {
  action: Action;
  clients: { id: string; legal_name: string; trade_name: string | null }[];
  types: DocType[];
  people: Person[];
  initialClientId?: string;
  today: string;
}) {
  const { state, submit, pending, err } = useManualAction(action);
  const v = state.values;
  const [clientId, setClientId] = useState(v?.client_id ?? initialClientId ?? "");
  const [query, setQuery] = useState("");
  const [typeId, setTypeId] = useState(v?.document_type_id ?? "");
  const client = clients.find((c) => c.id === clientId);
  const type = types.find((t) => t.id === typeId);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? clients.filter((c) => `${c.legal_name} ${c.trade_name ?? ""}`.toLowerCase().includes(q)) : clients).slice(0, 8);
  }, [query, clients]);

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-3xl space-y-6">
      {err._form && <Alert tone="danger">{err._form}</Alert>}
      <section className="card space-y-3 p-6">
        <h2 className="font-extrabold">1. Cliente</h2>
        <input type="hidden" name="client_id" value={clientId} />
        {client ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-500 bg-brand-50 px-4 py-3">
            <span className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-link" /> {client.legal_name}</span>
            <button type="button" onClick={() => setClientId("")} className="rounded-lg p-1 text-muted hover:bg-surface" aria-label="Trocar cliente"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div>
            <IconField label="Buscar cliente" name="client_search" icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Razão social ou nome fantasia" autoComplete="off" error={err.client_id} />
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line" role="listbox" aria-label="Clientes encontrados">
              {matches.length ? (
                matches.map((c) => (
                  <li key={c.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => setClientId(c.id)} className="w-full px-4 py-2.5 text-left text-sm transition hover:bg-surface-2">
                      <span className="font-semibold">{c.legal_name}</span>{c.trade_name && <span className="text-muted"> · {c.trade_name}</span>}
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-4 py-3 text-sm text-muted">Nenhum cliente encontrado.</li>
              )}
            </ul>
          </div>
        )}
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-extrabold">2. Documento</h2>
        <input type="hidden" name="document_type_id" value={typeId} />
        {err.document_type_id && <p className="field-error">{err.document_type_id}</p>}
        {OPERATIONAL_DEPARTMENTS.map((d) => {
          const items = types.filter((t) => t.department === d);
          if (!items.length) return null;
          return (
            <div key={d}>
              <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">{DEPARTMENT_LABEL[d]}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((t) => (
                  <button key={t.id} type="button" aria-pressed={t.id === typeId} onClick={() => setTypeId(t.id)}
                    className={`rounded-xl border px-4 py-3 text-left transition duration-150 ${t.id === typeId ? "border-brand-500 bg-brand-50 shadow-[0_0_0_1px_var(--color-brand-500)]" : "border-line hover:-translate-y-0.5 hover:border-brand-500/60"}`}>
                    <span className="block font-semibold">{t.name}</span>
                    {t.description && <span className="mt-0.5 block text-xs text-muted">{t.description}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted">
          Documento que se repete todo mês? Cadastre como <strong>exigência</strong> na página do cliente: as pendências são criadas sozinhas.
        </p>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-extrabold">3. Prazo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="due_date" className="label">Vencimento *</label>
            <input id="due_date" name="due_date" type="date" className="input" min={today} defaultValue={v?.due_date ?? ""} />
            {err.due_date && <p className="field-error">{err.due_date}</p>}
          </div>
          <div>
            <label htmlFor="responsible_id" className="label">Quem cobra (opcional)</label>
            <select id="responsible_id" name="responsible_id" className="input" defaultValue={v?.responsible_id ?? ""}>
              <option value="">Responsável do cliente no departamento</option>
              {sortPeople(people, type?.department).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="title" className="label">Descrição (opcional)</label>
            <input id="title" name="title" className="input" defaultValue={v?.title ?? ""} placeholder={type ? `Padrão: ${type.name}` : "Ex.: Contrato social atualizado"} />
          </div>
        </div>
        <p className="text-xs text-muted">Lembretes automáticos antes do vencimento, conforme configurado pela gestão.</p>
      </section>

      <div className="flex justify-end gap-2">
        <Link href="/documentos" className="btn-secondary">Cancelar</Link>
        <button className="btn-primary px-6" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {pending ? "Salvando…" : "Registrar pendência"}
        </button>
      </div>
    </form>
  );
}

// ---------------- Configurações ----------------

const DAY_CHOICES = [15, 10, 7, 5, 3, 2, 1, 0];

export function DocSettingsForm({ action, initial }: { action: Action; initial: { reminder_days: number[]; generate_ahead_days: number } }) {
  const { state, submit, pending, err } = useManualAction(action);
  const [days, setDays] = useState<number[]>(initial.reminder_days);
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <fieldset>
        <legend className="label">Lembrar a equipe (e o cliente, na Etapa 4)</legend>
        <div className="flex flex-wrap gap-2">
          {DAY_CHOICES.map((n) => {
            const on = days.includes(n);
            return (
              <label key={n} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-link" : "border-line hover:border-brand-500/60"}`}>
                <input type="checkbox" name="reminder_days" value={n} checked={on} className="sr-only"
                  onChange={(e) => setDays((d) => (e.target.checked ? [...d, n] : d.filter((x) => x !== n)))} />
                {n === 0 ? "No dia" : `${n} ${n === 1 ? "dia" : "dias"} antes`}
              </label>
            );
          })}
        </div>
        {err.reminder_days && <p className="field-error">{err.reminder_days}</p>}
      </fieldset>
      <div className="max-w-xs">
        <label htmlFor="generate_ahead_days" className="label">Criar pendências com antecedência de (dias)</label>
        <input id="generate_ahead_days" name="generate_ahead_days" type="number" min={7} max={120} className="input" defaultValue={initial.generate_ahead_days} />
        {err.generate_ahead_days && <p className="field-error">{err.generate_ahead_days}</p>}
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar lembretes
      </button>
    </form>
  );
}

type DocTypeInitial = { name: string; department: Dep; description: string | null; default_periodicity: Periodicity; default_due_day: number; active: boolean };

export function DocTypeForm({ action, initial, submitLabel }: { action: Action; initial?: DocTypeInitial; submitLabel: string }) {
  const { state, submit, pending, err } = useManualAction(action);
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nome do documento</label>
          <input name="name" className="input" defaultValue={initial?.name} placeholder="Ex.: Comprovantes de pagamento" />
          {err.name && <p className="field-error">{err.name}</p>}
        </div>
        <div>
          <label className="label">Departamento</label>
          <select name="department" className="input" defaultValue={initial?.department ?? "contabil"}>
            {OPERATIONAL_DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Frequência padrão</label>
            <select name="default_periodicity" className="input" defaultValue={initial?.default_periodicity ?? "mensal"}>
              {PERIODICITIES.map((p) => <option key={p} value={p}>{PERIODICITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Dia padrão</label>
            <input name="default_due_day" type="number" min={1} max={31} className="input" defaultValue={initial?.default_due_day ?? 10} />
            {err.default_due_day && <p className="field-error">{err.default_due_day}</p>}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Descrição para a equipe (opcional)</label>
          <input name="description" className="input" defaultValue={initial?.description ?? ""} placeholder="O que exatamente o cliente deve enviar" />
        </div>
        {initial && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="active" defaultChecked={initial.active} className="h-4 w-4 accent-brand-600" /> Ativo (aparece para novas exigências)
          </label>
        )}
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : initial ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {submitLabel}
      </button>
    </form>
  );
}
