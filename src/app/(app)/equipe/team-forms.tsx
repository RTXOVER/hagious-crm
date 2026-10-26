"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CircleCheck, Copy, KeyRound, LoaderCircle, Mail, Trash2, UserPlus, UserRound, X } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { DEPARTMENT_LABEL, ROLE_LABEL } from "@/lib/labels";
import { Alert, FormMessage } from "@/components/page-header";
import { ChoiceChips, IconField } from "@/components/form-controls";
import type { CreateUserState } from "./actions";

type Role = keyof typeof ROLE_LABEL;
type DepChoice = keyof typeof DEPARTMENT_LABEL | "nenhum";

const ROLE_HINT: Record<Role, string> = {
  admin: "Acesso total",
  gestor: "Todos os clientes",
  colaborador: "Clientes do departamento",
};

export function CreateUserForm({
  action,
}: {
  action: (prev: CreateUserState, formData: FormData) => Promise<CreateUserState>;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("colaborador");
  const [dep, setDep] = useState<DepChoice>("contabil");
  const [copied, setCopied] = useState(false);
  // Senha já exibida e dispensada com "Criar outra conta"
  const [dismissed, setDismissed] = useState<string | null>(null);
  const err = state.errors ?? {};

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setCopied(false);
    // Envio manual: em caso de erro, o que foi digitado continua na tela
    startTransition(() => dispatch(fd));
  }

  function createAnother() {
    setName("");
    setEmail("");
    setDismissed(state.tempPassword ?? null);
  }

  if (state.tempPassword && state.tempPassword !== dismissed) {
    return (
      <div role="status" className="space-y-4 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ok-soft text-ok">
          <CircleCheck className="h-7 w-7" />
        </span>
        <div>
          <p className="text-xl font-extrabold">Conta criada!</p>
          <p className="text-sm text-muted">{state.createdEmail}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface-2 p-4 text-left">
          <p className="text-xs font-bold tracking-wide text-muted uppercase">Senha provisória (aparece só agora)</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-lg select-all">{state.tempPassword}</code>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.tempPassword!);
                setCopied(true);
              }}
            >
              {copied ? <CircleCheck className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            Entregue pessoalmente ou por um canal seguro. No primeiro acesso, a pessoa deve trocar a senha em “Minha conta”.
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={createAnother} className="btn-primary"><UserPlus className="h-4 w-4" /> Criar outra conta</button>
          <Link href="/equipe" className="btn-secondary">Ver equipe</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <FormMessage state={{ errors: state.errors }} />
      <IconField label="Nome completo" name="full_name" icon={UserRound} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome e sobrenome" error={err.full_name} autoFocus />
      <IconField label="E-mail de acesso" name="email" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@hagious.com.br" error={err.email} />
      <ChoiceChips
        label="Cargo"
        name="role"
        value={role}
        onChange={(r) => { setRole(r); if (r === "colaborador" && dep === "nenhum") setDep("contabil"); }}
        options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] }))}
      />
      <ChoiceChips
        label={role === "colaborador" ? "Departamento" : "Departamento (opcional)"}
        name="department_choice"
        columns={role === "colaborador" ? 4 : 5}
        value={dep}
        onChange={setDep}
        error={err.department}
        options={[
          ...(Object.keys(DEPARTMENT_LABEL) as (keyof typeof DEPARTMENT_LABEL)[]).map((d) => ({
            value: d as DepChoice,
            label: d === "dp" ? "DP" : DEPARTMENT_LABEL[d],
          })),
          ...(role === "colaborador" ? [] : [{ value: "nenhum" as DepChoice, label: "Nenhum" }]),
        ]}
      />
      <input type="hidden" name="department" value={dep === "nenhum" ? "" : dep} />
      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        {pending ? "Criando…" : "Criar conta"}
      </button>
    </form>
  );
}

/** Edição completa de uma pessoa da equipe. */
export function EditMemberForm({
  action,
  member,
  isSelf,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  member: { full_name: string; email: string; role: Role; department: keyof typeof DEPARTMENT_LABEL | null; active: boolean };
  isSelf: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [name, setName] = useState(member.full_name);
  const [email, setEmail] = useState(member.email);
  const [role, setRole] = useState<Role>(member.role);
  const [dep, setDep] = useState<DepChoice>(member.department ?? "nenhum");
  const [active, setActive] = useState(member.active);
  const err = state.errors ?? {};

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <IconField label="Nome completo" name="full_name" icon={UserRound} value={name} onChange={(e) => setName(e.target.value)} error={err.full_name} />
      <IconField
        label="E-mail de acesso"
        name="email"
        type="email"
        icon={Mail}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={err.email}
        hint="Ao mudar, a pessoa passa a entrar com o novo e-mail."
      />
      {isSelf ? (
        <>
          <input type="hidden" name="role" value={role} />
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
            Você é <strong className="text-ink">{ROLE_LABEL[role]}</strong>. Por segurança, não é possível mudar o próprio cargo nem desativar a própria conta.
          </p>
        </>
      ) : (
        <ChoiceChips
          label="Cargo"
          name="role"
          value={role}
          onChange={(r) => { setRole(r); if (r === "colaborador" && dep === "nenhum") setDep("contabil"); }}
          options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] }))}
        />
      )}
      <ChoiceChips
        label={role === "colaborador" ? "Departamento" : "Departamento (opcional)"}
        name="department_choice"
        columns={role === "colaborador" ? 4 : 5}
        value={dep}
        onChange={setDep}
        error={err.department}
        options={[
          ...(Object.keys(DEPARTMENT_LABEL) as (keyof typeof DEPARTMENT_LABEL)[]).map((d) => ({
            value: d as DepChoice,
            label: d === "dp" ? "DP" : DEPARTMENT_LABEL[d],
          })),
          ...(role === "colaborador" ? [] : [{ value: "nenhum" as DepChoice, label: "Nenhum" }]),
        ]}
      />
      <input type="hidden" name="department" value={dep === "nenhum" ? "" : dep} />

      {isSelf ? (
        <input type="hidden" name="active" value="on" />
      ) : (
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
            active ? "border-line hover:border-brand-500/60" : "border-danger/40 bg-danger-soft"
          }`}
        >
          <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-600" />
          <span>
            <span className="font-bold">Acesso ativo</span>
            <span className="block text-sm text-muted">
              Desmarque para bloquear o login imediatamente. O histórico e as responsabilidades são mantidos.
            </span>
          </span>
        </label>
      )}

      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
        {pending ? "Salvando…" : "Salvar alterações"}
      </button>
    </form>
  );
}

/** Gera e mostra uma nova senha provisória. */
export function ResetPasswordButton({ action }: { action: () => Promise<CreateUserState> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CreateUserState | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() => start(async () => { setCopied(false); setResult(await action()); })}
      >
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Gerar nova senha provisória
      </button>
      {result?.errors?._form && <p className="text-sm font-medium text-danger">{result.errors._form}</p>}
      {result?.tempPassword && (
        <div role="status" className="rounded-2xl border border-line bg-surface-2 p-4">
          <p className="text-xs font-bold tracking-wide text-muted uppercase">Nova senha provisória (aparece só agora)</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-lg select-all">{result.tempPassword}</code>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => { await navigator.clipboard.writeText(result.tempPassword!); setCopied(true); }}
            >
              {copied ? <CircleCheck className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">A senha anterior deixou de valer. Entregue por um canal seguro.</p>
        </div>
      )}
    </div>
  );
}

/** Botão + janela de confirmação para excluir uma conta da equipe. */
export function DeleteMemberButton({
  name,
  responsibilities,
  people,
  action,
  compact = false,
}: {
  name: string;
  /** Quantos vínculos de responsável a pessoa tem (undefined = não informado). */
  responsibilities?: number;
  people: { id: string; full_name: string }[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact ? "btn-danger px-3 py-1.5 text-xs" : "btn-danger"}
        aria-label={`Excluir ${name}`}
      >
        <Trash2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} /> Excluir
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-labelledby={`${uid}-t`}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-left text-ink shadow-(--shadow-lift) backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      >
        <form action={formAction} className="p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft text-danger"><AlertTriangle className="h-5 w-5" /></span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fechar"><X className="h-5 w-5" /></button>
          </div>
          <h2 id={`${uid}-t`} className="mt-4 text-xl font-extrabold">Excluir conta?</h2>
          <p className="mt-1 text-sm text-muted">
            A conta de <strong className="text-ink">{name}</strong> será removida de forma <strong className="text-ink">permanente</strong> e
            a pessoa não conseguirá mais entrar.
          </p>

          <div className="mt-4">
            <label htmlFor={`${uid}-tr`} className="label">
              Responsabilidades sobre clientes{typeof responsibilities === "number" ? ` (${responsibilities})` : ""}
            </label>
            <select id={`${uid}-tr`} name="transfer_to" className="input" defaultValue="">
              <option value="">Remover (os clientes ficam sem responsável)</option>
              {people.map((p) => <option key={p.id} value={p.id}>Transferir para {p.full_name}</option>)}
            </select>
          </div>

          <div className="mt-4">
            <Alert tone="info">
              Se a pessoa apenas saiu da empresa, prefira <strong>desativar</strong> o acesso na tela de edição: o login
              é bloqueado e o nome continua aparecendo corretamente no histórico.
            </Alert>
          </div>

          <label htmlFor={`${uid}-c`} className="label mt-5">Para confirmar, digite <strong>EXCLUIR</strong></label>
          <input id={`${uid}-c`} name="confirm" className="input" autoComplete="off" autoFocus />
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
