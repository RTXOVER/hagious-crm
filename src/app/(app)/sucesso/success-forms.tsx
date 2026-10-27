"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CalendarClock, CheckCircle2, LoaderCircle, MessageSquarePlus, Plus, RotateCcw, Save, Search, X, XCircle } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { Alert, FormMessage } from "@/components/page-header";
import { IconField } from "@/components/form-controls";
import { Select } from "@/components/ui/select";
import { RadioCards, Segmented } from "@/components/ui/controls";
import { peopleOptions } from "@/components/ui/options";
import { useManualAction } from "../documentos/doc-forms";
import {
  RECURRENCE_LABEL,
  SUCCESS_RECURRENCES,
  SUCCESS_TYPES,
  SUCCESS_TYPE_DEFAULT_RECURRENCE,
  SUCCESS_TYPE_HINT,
  SUCCESS_TYPE_LABEL,
  SUCCESS_TYPE_OBJECTIVE,
  type SuccessRecurrence,
  type SuccessType,
} from "@/lib/success";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Person = { id: string; full_name: string; department: string | null };

// ---------------- Nova ação ----------------

export function NewSuccessForm({
  action,
  clients,
  people,
  initialClientId,
  initialType,
  currentUserId,
  today,
}: {
  action: Action;
  clients: { id: string; legal_name: string; trade_name: string | null }[];
  people: Person[];
  initialClientId?: string;
  initialType?: SuccessType;
  currentUserId: string;
  today: string;
}) {
  const { state, submit, pending, err } = useManualAction(action);
  const v = state.values;
  const [clientId, setClientId] = useState(v?.client_id ?? initialClientId ?? "");
  const [query, setQuery] = useState("");
  const startType = (v?.type as SuccessType) ?? initialType ?? "contato_trimestral";
  const [type, setType] = useState<SuccessType>(startType);
  const [objective, setObjective] = useState(v?.objective ?? SUCCESS_TYPE_OBJECTIVE[startType]);
  const [recurrence, setRecurrence] = useState<SuccessRecurrence>((v?.recurrence as SuccessRecurrence) ?? SUCCESS_TYPE_DEFAULT_RECURRENCE[startType]);
  const client = clients.find((c) => c.id === clientId);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? clients.filter((c) => `${c.legal_name} ${c.trade_name ?? ""}`.toLowerCase().includes(q)) : clients).slice(0, 8);
  }, [query, clients]);

  const pickType = (t: SuccessType) => {
    // Troca a sugestão só se a pessoa ainda não escreveu um objetivo próprio
    if (!objective.trim() || Object.values(SUCCESS_TYPE_OBJECTIVE).includes(objective)) setObjective(SUCCESS_TYPE_OBJECTIVE[t]);
    setRecurrence(SUCCESS_TYPE_DEFAULT_RECURRENCE[t]);
    setType(t);
  };

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
        <h2 className="font-extrabold">2. Tipo e objetivo</h2>
        <RadioCards name="type" aria-label="Tipo de ação" value={type} onChange={pickType}
          options={SUCCESS_TYPES.map((t) => ({ value: t, label: SUCCESS_TYPE_LABEL[t], description: SUCCESS_TYPE_HINT[t] }))} />
        {err.type && <p className="field-error">{err.type}</p>}
        <div>
          <label htmlFor="objective" className="label">Objetivo do contato *</label>
          <input id="objective" name="objective" className="input" value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={300}
            placeholder="Ex.: Apresentar simulação de troca para o Lucro Presumido" aria-invalid={err.objective ? true : undefined} />
          {err.objective && <p className="field-error">{err.objective}</p>}
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-extrabold">3. Quando e quem</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="planned_date" className="label">Data prevista *</label>
            <input id="planned_date" name="planned_date" type="date" className="input" min={today} defaultValue={v?.planned_date ?? ""} aria-invalid={err.planned_date ? true : undefined} />
            {err.planned_date && <p className="field-error">{err.planned_date}</p>}
          </div>
          <div>
            <label htmlFor="responsible_id" className="label">Responsável</label>
            <Select id="responsible_id" name="responsible_id" defaultValue={v?.responsible_id ?? currentUserId} searchable options={peopleOptions(people)} />
          </div>
        </div>
        <div>
          <p className="label">Repetir</p>
          <Segmented name="recurrence" aria-label="Repetir" value={recurrence} onChange={setRecurrence} size="sm"
            options={SUCCESS_RECURRENCES.map((r) => ({ value: r, label: RECURRENCE_LABEL[r] }))} />
          <p className="mt-1 text-xs text-muted">
            {recurrence === "nenhuma" ? "Acontece uma vez." : "Ao registrar como realizada, a próxima já fica programada automaticamente."}
          </p>
        </div>
        <p className="text-xs text-muted">O responsável recebe um aviso no dia previsto e outro se a data passar sem registro.</p>
      </section>

      <div className="flex justify-end gap-2">
        <Link href="/sucesso" className="btn-secondary">Cancelar</Link>
        <button className="btn-primary px-6" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {pending ? "Salvando…" : "Programar ação"}
        </button>
      </div>
    </form>
  );
}

// ---------------- Situação ----------------

const STATUS_OPTIONS = [
  { value: "realizada", label: "Registrar como realizada", note: "Resultado *", placeholder: "Ex.: Cliente satisfeito. Pediu simulação de pró-labore até dia 20." },
  { value: "cancelada", label: "Cancelar", note: "Motivo do cancelamento *", placeholder: "Ex.: Cliente pediu para remarcar no próximo trimestre" },
] as const;

export function SuccessStatusPanel({ status, action, canReopen, recurrent }: { status: string; action: Action; canReopen: boolean; recurrent: boolean }) {
  const { state, submit: send, pending, err: allErr } = useManualAction(action);
  const [target, setTarget] = useState<string | null>(null);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const err = sentFor === target ? allErr : {};
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    setSentFor(target);
    send(e);
  };
  const opt = STATUS_OPTIONS.find((o) => o.value === target);

  if (status !== "planejada") {
    if (!canReopen) return <FormMessage state={state} />;
    return (
      <form onSubmit={submit} className="space-y-3">
        <FormMessage state={state} />
        <input type="hidden" name="status" value="planejada" />
        <p className="text-sm text-muted">Registrado por engano? A gestão pode reabrir a ação (o resultado anterior fica no histórico).</p>
        <button className="btn-secondary w-full" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reabrir ação
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((o) => (
          <button key={o.value} type="button" aria-pressed={target === o.value} onClick={() => setTarget(target === o.value ? null : o.value)}
            className={`btn px-3 py-1.5 text-xs ${target === o.value ? "bg-brand-600 text-white" : o.value === "realizada" ? "btn-secondary border-brand-500 text-link" : "btn-secondary"}`}>
            {o.value === "realizada" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {o.label}
          </button>
        ))}
      </div>
      {opt && (
        <>
          <input type="hidden" name="status" value={opt.value} />
          <div>
            <label htmlFor="success-note" className="label">{opt.note}</label>
            <textarea id="success-note" name="note" rows={4} className="input" placeholder={opt.placeholder} />
            {err.note && <p className="field-error">{err.note}</p>}
            {opt.value === "realizada" && recurrent && <p className="mt-1 text-xs text-muted">Ação recorrente: a próxima é programada ao confirmar.</p>}
          </div>
          <button className="btn-primary w-full" disabled={pending}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar
          </button>
        </>
      )}
    </form>
  );
}

export function RescheduleForm({ action, current }: { action: Action; current: string }) {
  const { state, submit, pending, err } = useManualAction(action);
  const v = state.ok ? undefined : state.values;
  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <FormMessage state={state} />
      <div>
        <label htmlFor="planned_date" className="label">Nova data</label>
        <input id="planned_date" name="planned_date" type="date" className="input" defaultValue={v?.planned_date ?? current} />
        {err.planned_date && <p className="field-error">{err.planned_date}</p>}
      </div>
      <div>
        <label htmlFor="reason" className="label">Motivo</label>
        <input id="reason" name="reason" className="input" defaultValue={v?.reason ?? ""} placeholder="Ex.: cliente pediu para a semana que vem" />
        {err.reason && <p className="field-error">{err.reason}</p>}
      </div>
      <button className="btn-secondary w-full" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Reagendar
      </button>
    </form>
  );
}

export function SuccessResponsibleForm({ action, current, people }: { action: Action; current: string | null; people: Person[] }) {
  const { state, submit, pending } = useManualAction(action);
  return (
    <form onSubmit={submit} className="space-y-2">
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Select name="responsible_id" defaultValue={current ?? ""} aria-label="Responsável" className="min-w-0 flex-1" searchable options={peopleOptions(people)} />
        <button className="btn-secondary px-3" disabled={pending} aria-label="Salvar responsável">
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}

export function CommentForm({ action }: { action: Action }) {
  const { state, submit, pending, err, version } = useManualAction(action);
  return (
    <form onSubmit={submit} className="space-y-2" key={version} noValidate>
      {state.errors?._form && <Alert tone="danger">{state.errors._form}</Alert>}
      <label htmlFor="comment-body" className="sr-only">Comentário</label>
      <textarea id="comment-body" name="body" rows={2} className="input" placeholder="Anotação para a equipe: tentativa de contato, combinado, próximo passo…" />
      {err.body && <p className="field-error">{err.body}</p>}
      <button className="btn-secondary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />} Comentar
      </button>
    </form>
  );
}

// ---------------- Configuração (gestão) ----------------

export function SuccessSettingsForm({ action, initial }: { action: Action; initial: { stale_days: number } }) {
  const { state, submit, pending, err } = useManualAction(action);
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="max-w-xs">
        <label htmlFor="stale_days" className="label">Sem acompanhamento depois de (dias)</label>
        <input id="stale_days" name="stale_days" type="number" min={15} max={365} className="input" defaultValue={initial.stale_days} />
        {err.stale_days && <p className="field-error">{err.stale_days}</p>}
        <p className="mt-1 text-xs text-muted">Cliente ativo sem nenhuma ação realizada nesse período entra na lista “Sem acompanhamento”.</p>
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
      </button>
    </form>
  );
}
