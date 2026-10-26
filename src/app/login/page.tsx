import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const HIGHLIGHTS = [
  "Clientes, contatos e responsáveis em um só lugar",
  "Cada pessoa vê apenas o que precisa para o seu trabalho",
  "Toda alteração fica registrada com autor e horário",
];

export default async function LoginPage(props: PageProps<"/login">) {
  const [profile, { next }] = await Promise.all([getCurrentProfile(), props.searchParams]);
  if (profile) redirect("/");

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Painel da marca (computador) */}
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl"
        />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-[#6fd3ae]/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-xl font-extrabold">H</span>
          <span className="text-lg font-extrabold">Hagious</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-extrabold tracking-tight">
            A central de relacionamento e operação da contabilidade.
          </h2>
          <ul className="mt-8 space-y-3 text-white/80">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#6fd3ae]" /> {h}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">Acesso restrito à equipe Hagious.</p>
      </section>

      {/* Formulário */}
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-900 text-lg font-extrabold text-white lg:hidden">
              H
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">Entrar</h1>
            <p className="mt-1 text-sm text-muted">Use o e-mail e a senha fornecidos pelo administrador.</p>
          </div>
          <div className="card p-6 shadow-(--shadow-lift)">
            <LoginForm next={typeof next === "string" ? next : "/"} />
          </div>
          <p className="mt-6 text-center text-xs text-muted">
            Não tem conta? Peça ao administrador do sistema. Por segurança, não há cadastro aberto.
          </p>
        </div>
      </section>
    </main>
  );
}
