"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Clock, LoaderCircle, Search, Send, X } from "lucide-react";
import { DEPARTMENT_LABEL } from "@/lib/labels";
import { ORIGIN_LABEL, PRIORITY_LABEL, formatSla } from "@/lib/tickets";
import { useFormat } from "@/components/format-provider";
import { Alert } from "@/components/page-header";
import { ChoiceChips, IconField } from "@/components/form-controls";
import { createTicketAction } from "../actions";
import { previewSlaAction } from "../preview-action";

type Dep = "contabil" | "fiscal" | "dp";
type Category = { id: string; name: string; department: Dep; resolution_value: number; resolution_unit: "horas_uteis" | "dias_uteis"; needs_review: boolean };
type Origin = keyof typeof ORIGIN_LABEL;
type Priority = keyof typeof PRIORITY_LABEL;

export function TicketForm({
  clients,
  categories,
  people,
  initialClientId,
}: {
  clients: { id: string; legal_name: string; trade_name: string | null }[];
  categories: Category[];
  people: { id: string; full_name: string; department: string | null }[];
  initialClientId?: string;
}) {
  const f = useFormat();
  const [state, dispatch, pending] = useActionState(createTicketAction, {});
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [clientQuery, setClientQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [preview, setPreview] = useState<{ firstResponse: string; resolution: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState<Origin>("whatsapp");
  const [priority, setPriority] = useState<Priority>("normal");
  const [assignee, setAssignee] = useState("");
  const err = state.errors ?? {};

  const client = clients.find((c) => c.id === clientId);
  const category = categories.find((c) => c.id === categoryId);
  const matches = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients.slice(0, 8);
    return clients.filter((c) => `${c.legal_name} ${c.trade_name ?? ""}`.toLowerCase().includes(q)).slice(0, 8);
  }, [clientQuery, clients]);

  async function chooseCategory(id: string) {
    setCategoryId(id);
    setPreview(null);
    setLoadingPreview(true);
    setPreview(await previewSlaAction(id));
    setLoadingPreview(false);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  const byDep = (["contabil", "fiscal", "dp"] as Dep[]).map((d) => ({ dep: d, items: categories.filter((c) => c.department === d) }));

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-3xl space-y-6">
      {err._form && <Alert tone="danger">{err._form}</Alert>}

      {/* Cliente */}
      <section className="card space-y-3 p-6">
        <h2 className="font-extrabold">1. Cliente</h2>
        <input type="hidden" name="client_id" value={clientId} />
        {client ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-500 bg-brand-50 px-4 py-3">
            <span className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-link" /> {client.legal_name}</span>
            <button type="button" onClick={() => setClientId("")} className="rounded-lg p-1 text-muted hover:bg-surface" aria-label="Trocar cliente">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div>
            <IconField label="Buscar cliente" name="client_search" icon={Search} value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Razão social ou nome fantasia" autoComplete="off" error={err.client_id} />
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line" role="listbox" aria-label="Clientes encontrados">
              {matches.length ? (
                matches.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setClientId(c.id)} className="w-full px-4 py-2.5 text-left text-sm transition hover:bg-surface-2" role="option" aria-selected={false}>
                      <span className="font-semibold">{c.legal_name}</span>
                      {c.trade_name && <span className="text-muted"> · {c.trade_name}</span>}
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-4 py-3 text-sm text-muted">Nenhum cliente encontrado. <Link href="/clientes/novo" className="link">Cadastrar cliente</Link></li>
              )}
            </ul>
          </div>
        )}
      </section>

      {/* Tipo de solicitação */}
      <section className="card space-y-4 p-6">
        <h2 className="font-extrabold">2. Tipo de solicitação</h2>
        <input type="hidden" name="category_id" value={categoryId} />
        {err.category_id && <p className="field-error">{err.category_id}</p>}
        {byDep.map(({ dep, items }) =>
          items.length ? (
            <div key={dep}>
              <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">{DEPARTMENT_LABEL[dep]}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((c) => {
                  const selected = c.id === categoryId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => chooseCategory(c.id)}
                      aria-pressed={selected}
                      className={`rounded-xl border px-4 py-3 text-left transition duration-150 ${
                        selected ? "border-brand-500 bg-brand-50 shadow-[0_0_0_1px_var(--color-brand-500)]" : "border-line hover:-translate-y-0.5 hover:border-brand-500/60"
                      }`}
                    >
                      <span className="block font-semibold">{c.name}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                        <Clock className="h-3 w-3" /> Prazo: {formatSla(c.resolution_value, c.resolution_unit)}
                        {c.needs_review && " (a confirmar)"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null,
        )}
        {category && (
          <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
            {loadingPreview ? (
              <span className="flex items-center gap-2 text-muted"><LoaderCircle className="h-4 w-4 animate-spin" /> Calculando prazos…</span>
            ) : preview ? (
              <span>
                Se aberto agora: <strong>1ª resposta até {f.dateTime(preview.firstResponse)}</strong> · <strong>resolução até {f.dateTime(preview.resolution)}</strong>
                <span className="block text-xs text-muted">Considera expediente, fins de semana e feriados cadastrados.</span>
              </span>
            ) : (
              <span className="text-muted">Não foi possível calcular a prévia agora; o prazo será calculado ao salvar.</span>
            )}
          </div>
        )}
      </section>

      {/* Detalhes */}
      <section className="card space-y-5 p-6">
        <h2 className="font-extrabold">3. Detalhes</h2>
        <IconField label="Resumo do pedido *" name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Certidão negativa de débitos estaduais" error={err.title} />
        <div>
          <label htmlFor="description" className="label">Descrição (opcional)</label>
          <textarea id="description" name="description" rows={4} className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que o cliente pediu, documentos citados, observações…" />
        </div>
        <ChoiceChips label="Como o pedido chegou" name="origin" columns={5} value={origin} onChange={setOrigin}
          options={(Object.keys(ORIGIN_LABEL) as Origin[]).map((o) => ({ value: o, label: ORIGIN_LABEL[o] }))} />
        <ChoiceChips label="Prioridade" name="priority" columns={4} value={priority} onChange={setPriority}
          options={(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        <div>
          <label htmlFor="assignee_id" className="label">Responsável (opcional)</label>
          <select id="assignee_id" name="assignee_id" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Deixar na fila do departamento (todos são avisados)</option>
            {[...people]
              .sort((a, b) => Number(b.department === category?.department) - Number(a.department === category?.department) || a.full_name.localeCompare(b.full_name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}{p.department ? ` (${DEPARTMENT_LABEL[p.department as keyof typeof DEPARTMENT_LABEL]})` : " (gestão)"}
                </option>
              ))}
          </select>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Link href="/tickets" className="btn-secondary">Cancelar</Link>
        <button className="btn-primary px-6" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {pending ? "Abrindo…" : "Abrir ticket"}
        </button>
      </div>
    </form>
  );
}
