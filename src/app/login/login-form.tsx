"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { Alert } from "@/components/page-header";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, {});

  return (
    <form action={action} className="space-y-4" key={state.values?.email ?? ""}>
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="label">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" defaultValue={state.values?.email ?? ""} />
      </div>
      <div>
        <label htmlFor="password" className="label">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" autoFocus={Boolean(state.values?.email)} />
      </div>
      {state.errors?._form && <Alert tone="danger">{state.errors._form}</Alert>}
      <button type="submit" disabled={pending} className="btn-primary w-full py-2.5">
        <LogIn className="h-4 w-4" />
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
