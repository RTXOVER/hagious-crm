import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { createUserAction } from "../actions";
import { CreateUserForm } from "../team-forms";

export const metadata: Metadata = { title: "Nova conta" };

export default async function NewMemberPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Nova conta"
        description="Crie o acesso de uma pessoa da equipe. Ela entra com o e-mail e a senha provisória gerada aqui."
        actions={<Link href="/equipe" className="btn-secondary">Voltar para Equipe</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,32rem)_1fr]">
        <section className="card p-6">
          <CreateUserForm action={createUserAction} />
        </section>
        <aside className="card h-fit p-6 text-sm">
          <h2 className="mb-3 flex items-center gap-2 font-extrabold">
            <ShieldCheck className="h-5 w-5 text-link" /> O que cada cargo pode fazer
          </h2>
          <dl className="space-y-3">
            <div>
              <dt className="font-bold">Administrador</dt>
              <dd className="text-muted">Tudo, inclusive criar contas e mudar cargos.</dd>
            </div>
            <div>
              <dt className="font-bold">Gestor</dt>
              <dd className="text-muted">Vê e edita todos os clientes, define responsáveis e vê o histórico de alterações.</dd>
            </div>
            <div>
              <dt className="font-bold">Colaborador</dt>
              <dd className="text-muted">
                Vê apenas clientes do seu departamento (que tenham serviço ativo dele) ou pelos quais é responsável.
                Pode atualizar os contatos desses clientes.
              </dd>
            </div>
            <div>
              <dt className="font-bold">Colaborador do Atendimento</dt>
              <dd className="text-muted">Vê todos os clientes, para conseguir atender o WhatsApp.</dd>
            </div>
          </dl>
          <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-muted">
            Por segurança, o sistema não permite que pessoas criem a própria conta na tela de login. Todo acesso nasce aqui.
          </p>
        </aside>
      </div>
    </>
  );
}
