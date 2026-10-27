"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { ArrowRightLeft, CircleCheck, Hand, LoaderCircle, MessageSquare, Send, UserRound } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import { NEXT_STATUS, PRIORITY_LABEL, STATUS_LABEL } from "@/lib/tickets";
import { Alert, FormMessage } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { departmentOptions, peopleOptions } from "@/components/ui/options";

const PRIORITY_DOT: Record<string, string> = { baixa: "#9aaaa5", normal: "#2f6fc4", alta: "#c27a12", urgente: "#b42318" };

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Person = { id: string; full_name: string; department: string | null };
type Status = keyof typeof STATUS_LABEL;
type Priority = keyof typeof PRIORITY_LABEL;

function useManualAction(action: Action) {
  const [state, dispatch, pending] = useActionState(action, {});
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, submit, pending };
}

const STATUS_BUTTON: Partial<Record<Status, string>> = {
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardar cliente",
  concluido: "Concluir",
  cancelado: "Cancelar ticket",
};

/** Mudança de situação; concluir e cancelar pedem descrição/motivo. */
export function StatusPanel({ current, action, canReopen }: { current: Status; action: Action; canReopen: boolean }) {
  const { state, submit, pending } = useManualAction(action);
  const [target, setTarget] = useState<Status | null>(null);
  const reopening = current === "concluido" || current === "cancelado";
  // Reabrir ticket encerrado é só da gestão (o banco também impõe)
  const options = reopening && !canReopen ? [] : NEXT_STATUS[current];
  const needsNote = target === "concluido" || target === "cancelado";

  if (!options.length) return <p className="text-sm text-muted">Somente a gestão pode reabrir este ticket.</p>;

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {options.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setTarget(target === s ? null : s)}
            aria-pressed={target === s}
            className={`btn px-3 py-1.5 text-xs ${target === s ? "bg-brand-600 text-white" : s === "cancelado" ? "btn-danger" : "btn-secondary"}`}
          >
            {reopening ? "Reabrir" : STATUS_BUTTON[s]}
          </button>
        ))}
      </div>
      {target && (
        <>
          <input type="hidden" name="status" value={target} />
          <div>
            <label htmlFor="status-note" className="label">
              {target === "concluido" ? "O que foi feito? *" : target === "cancelado" ? "Motivo do cancelamento *" : target === "aguardando_cliente" ? "O que estamos aguardando? (opcional)" : "Observação (opcional)"}
            </label>
            <textarea id="status-note" name="note" rows={3} className="input" />
            {state.errors?.note && <p className="field-error">{state.errors.note}</p>}
            {target === "aguardando_cliente" && <p className="mt-1 text-xs text-muted">O prazo fica pausado enquanto aguarda o cliente.</p>}
            {needsNote && <p className="mt-1 text-xs text-muted">Fica registrado no histórico como conclusão do atendimento.</p>}
          </div>
          <button className="btn-primary w-full" disabled={pending}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
            Confirmar: {reopening ? "Reabrir" : STATUS_LABEL[target]}
          </button>
        </>
      )}
    </form>
  );
}

export function TakeButton({ action }: { action: () => Promise<ActionState> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  return (
    <div>
      <button type="button" className="btn-primary w-full" disabled={pending} onClick={() => start(async () => setResult(await action()))}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />} Assumir ticket
      </button>
      {result?.errors?._form && <p className="mt-2 text-xs text-danger">{result.errors._form}</p>}
    </div>
  );
}

export function AssignPanel({ action, current, people }: { action: Action; current: string | null; people: Person[] }) {
  const { state, submit, pending } = useManualAction(action);
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Select name="assignee_id" defaultValue={current ?? ""} aria-label="Responsável" className="min-w-0 flex-1" searchable
        options={peopleOptions(people, { empty: "Sem responsável", emptyHint: "Fila do departamento" })} />
      <button className="btn-secondary px-3" disabled={pending} aria-label="Salvar responsável">
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
      </button>
      {state.errors?._form && <span className="sr-only" role="alert">{state.errors._form}</span>}
    </form>
  );
}

export function ForwardPanel({ action, currentDepartment, people }: { action: Action; currentDepartment: string; people: Person[] }) {
  const { state, submit, pending } = useManualAction(action);
  const [dep, setDep] = useState(OPERATIONAL_DEPARTMENTS.find((d) => d !== currentDepartment) ?? "contabil");
  return (
    <form onSubmit={submit} className="space-y-3">
      <FormMessage state={state} />
      <div>
        <label htmlFor="fw-dep" className="label">Para o departamento</label>
        <Select id="fw-dep" name="department" value={dep} onChange={(v) => setDep(v as typeof dep)}
          options={departmentOptions().filter((o) => o.value !== currentDepartment)} />
      </div>
      <div>
        <label htmlFor="fw-assignee" className="label">Responsável (opcional)</label>
        <Select key={dep} id="fw-assignee" name="assignee_id" defaultValue=""
          options={peopleOptions(people.filter((p) => p.department === dep || !p.department), { empty: "Fila do departamento", emptyHint: "Todos são avisados", department: dep })} />
      </div>
      <div>
        <label htmlFor="fw-reason" className="label">Motivo *</label>
        <textarea id="fw-reason" name="reason" rows={2} className="input" placeholder="Ex.: é admissão de funcionário, cabe ao DP" />
        {state.errors?.reason && <p className="field-error">{state.errors.reason}</p>}
      </div>
      <button className="btn-secondary w-full" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />} Encaminhar
      </button>
    </form>
  );
}

export function PriorityControl({ current, action }: { current: Priority; action: (p: string) => Promise<ActionState> }) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  return (
    <Select
      aria-label="Prioridade"
      size="sm"
      className="w-52"
      value={value}
      disabled={pending}
      onChange={(v) => {
        const p = v as Priority;
        start(async () => {
          const r = await action(p);
          if (r.ok) setValue(p);
        });
      }}
      options={(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: `Prioridade: ${PRIORITY_LABEL[p]}`, dot: PRIORITY_DOT[p] }))}
    />
  );
}

/** Comentário interno ou resposta ao cliente, com menções. */
export function CommentBox({ action, people }: { action: Action; people: Person[] }) {
  const [kind, setKind] = useState<"comentario" | "resposta">("comentario");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  // Limpa o texto somente depois que o servidor confirmar
  const [state, dispatch, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) {
      setBody("");
      setMentions([]);
    }
    return r;
  }, {});

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {state.errors?._form && <Alert tone="danger">{state.errors._form}</Alert>}
      {state.ok && state.message && <Alert tone="ok">{state.message}</Alert>}
      <div className="inline-flex rounded-xl border border-line p-1" role="radiogroup" aria-label="Tipo de registro">
        {([["comentario", "Comentário interno"], ["resposta", "Resposta ao cliente"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${kind === k ? "bg-brand-600 text-white" : "text-muted hover:text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind} />
      <textarea
        name="body"
        rows={3}
        className="input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === "resposta" ? "Registre o que foi respondido ao cliente (conta como primeira resposta)" : "Anotação para a equipe"}
        aria-label="Texto"
      />
      {state.errors?.body && <p className="field-error">{state.errors.body}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-muted hover:text-ink">Mencionar alguém {mentions.length ? `(${mentions.length})` : ""}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {people.map((p) => {
            const on = mentions.includes(p.id);
            return (
              <label key={p.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-link" : "border-line hover:border-brand-500/60"}`}>
                <input type="checkbox" name="mentions" value={p.id} checked={on} className="sr-only"
                  onChange={(e) => setMentions((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))} />
                @{p.full_name}
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted">Quem for mencionado recebe um aviso e passa a poder acompanhar o ticket.</p>
      </details>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending || body.trim().length < 2}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : kind === "resposta" ? <Send className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          {kind === "resposta" ? "Registrar resposta" : "Comentar"}
        </button>
      </div>
    </form>
  );
}
