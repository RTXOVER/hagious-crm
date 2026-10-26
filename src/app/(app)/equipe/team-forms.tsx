"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { CircleCheck, Copy, LoaderCircle, Mail, UserPlus, UserRound } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { DEPARTMENT_LABEL, ROLE_LABEL } from "@/lib/labels";
import { FormMessage } from "@/components/page-header";
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

export function MemberForm({
  action,
  member,
  isSelf,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  member: { role: string; department: string | null; active: boolean };
  isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <select name="role" defaultValue={member.role} className="input w-auto py-1" aria-label="Cargo" disabled={isSelf}>
        {Object.entries(ROLE_LABEL).map(([val, l]) => (
          <option key={val} value={val}>{l}</option>
        ))}
      </select>
      {/* Campo desabilitado não é enviado: repete o valor para a própria conta */}
      {isSelf && <input type="hidden" name="role" value={member.role} />}
      <select name="department" defaultValue={member.department ?? ""} className="input w-auto py-1" aria-label="Departamento">
        <option value="">— Nenhum —</option>
        {Object.entries(DEPARTMENT_LABEL).map(([val, l]) => (
          <option key={val} value={val}>{l}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs font-semibold">
        <input type="checkbox" name="active" defaultChecked={member.active} disabled={isSelf} />
        Ativo
      </label>
      {isSelf && <input type="hidden" name="active" value="on" />}
      <button className="btn-secondary py-1" disabled={pending}>{pending ? "…" : "Salvar"}</button>
      {state.errors?._form && <span className="text-xs font-medium text-danger">{state.errors._form}</span>}
      {state.ok && <span className="text-xs font-medium text-ok">Salvo</span>}
    </form>
  );
}
