"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, CircleCheck, CirclePause, CircleX, LoaderCircle, Trash2, X } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { Alert } from "@/components/page-header";

type Status = "ativo" | "suspenso" | "encerrado";

const OPTIONS: { value: Status; label: string; icon: React.ComponentType<{ className?: string }>; active: string }[] = [
  { value: "ativo", label: "Ativo", icon: CircleCheck, active: "bg-ok-soft text-ok ring-ok/40" },
  { value: "suspenso", label: "Suspenso", icon: CirclePause, active: "bg-warn-soft text-warn ring-warn/40" },
  { value: "encerrado", label: "Encerrado", icon: CircleX, active: "bg-neutral-soft text-ink ring-muted/40" },
];

/** Troca rápida da situação do cliente (gestor/admin). */
export function StatusControl({
  current,
  action,
}: {
  current: Status;
  action: (status: string) => Promise<ActionState>;
}) {
  const [pending, startTransition] = useTransition();
  // Situação exibida: atualizada assim que o servidor confirma
  const [value, setValue] = useState<Status>(current);
  const [target, setTarget] = useState<Status | null>(null);
  const [result, setResult] = useState<ActionState | null>(null);

  function change(status: Status) {
    if (status === value || pending) return;
    setTarget(status);
    setResult(null);
    startTransition(async () => {
      const r = await action(status);
      if (r.ok) setValue(status);
      setResult(r);
      setTarget(null);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-semibold text-muted">Situação:</span>
      <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="radiogroup" aria-label="Situação do cliente">
        {OPTIONS.map(({ value: option, label, icon: Icon, active }) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending}
              onClick={() => change(option)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition duration-150 disabled:cursor-wait ${
                selected ? `ring-1 ring-inset ${active}` : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {pending && target === option ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              {label}
            </button>
          );
        })}
      </div>
      {result?.errors?._form && <span className="text-sm font-medium text-danger">{result.errors._form}</span>}
      {result?.ok && <span className="text-sm font-medium text-ok">Situação atualizada</span>}
    </div>
  );
}

/** Botão + janela de confirmação para excluir o cliente (somente admin). */
export function DeleteClientButton({
  clientName,
  counts,
  action,
}: {
  clientName: string;
  counts: { contacts: number; services: number; responsibles: number };
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-danger">
        <Trash2 className="h-4 w-4" /> Excluir
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-(--shadow-lift) backdrop:bg-black/50 backdrop:backdrop-blur-sm"
        aria-labelledby="excluir-titulo"
      >
        <form action={formAction} className="p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fechar">
              <X className="h-5 w-5" />
            </button>
          </div>
          <h2 id="excluir-titulo" className="mt-4 text-xl font-extrabold">Excluir cliente?</h2>
          <p className="mt-1 text-sm text-muted">
            <strong className="text-ink">{clientName}</strong> será removido de forma <strong className="text-ink">permanente</strong>, junto com:
          </p>
          <ul className="mt-3 space-y-1 rounded-xl bg-surface-2 p-4 text-sm">
            <li>{counts.contacts} contato(s)</li>
            <li>{counts.services} serviço(s) contratado(s)</li>
            <li>{counts.responsibles} responsável(is) definido(s)</li>
          </ul>
          <div className="mt-4">
            <Alert tone="info">
              Se o cliente apenas deixou a Hagious, prefira mudar a situação para <strong>Encerrado</strong>: o histórico
              é preservado e ele some dos indicadores de clientes ativos.
            </Alert>
          </div>

          <label htmlFor="confirm" className="label mt-5">Para confirmar, digite <strong>EXCLUIR</strong></label>
          <input id="confirm" name="confirm" className="input" autoComplete="off" autoFocus />
          {state.errors?.confirm && <p className="field-error">{state.errors.confirm}</p>}
          {state.errors?._form && <div className="mt-3"><Alert tone="danger">{state.errors._form}</Alert></div>}

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={pending} className="btn bg-danger text-white hover:brightness-110">
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {pending ? "Excluindo…" : "Excluir definitivamente"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
