"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/page-header";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  const err = state.errors ?? {};

  return (
    // key: limpa os campos depois de trocar a senha com sucesso
    <form action={action} key={state.ok ? "ok" : "form"} className="card max-w-md space-y-4 self-start p-6">
      <h2 className="text-lg font-extrabold">Trocar senha</h2>
      <FormMessage state={state} />
      <div>
        <label htmlFor="current" className="label">Senha atual</label>
        <input id="current" name="current" type="password" autoComplete="current-password" className="input" />
        {err.current && <p className="field-error">{err.current}</p>}
      </div>
      <div>
        <label htmlFor="password" className="label">Nova senha</label>
        <input id="password" name="password" type="password" autoComplete="new-password" className="input" />
        <p className="mt-1 text-xs text-muted">Mínimo de 10 caracteres, com letras e números.</p>
        {err.password && <p className="field-error">{err.password}</p>}
      </div>
      <div>
        <label htmlFor="confirm" className="label">Confirme a nova senha</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className="input" />
        {err.confirm && <p className="field-error">{err.confirm}</p>}
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Salvando…" : "Trocar senha"}</button>
    </form>
  );
}
