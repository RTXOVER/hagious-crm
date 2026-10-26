import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/validation/ids";
import { deleteMemberAction, resetPasswordAction, updateMemberAction } from "../actions";
import { DeleteMemberButton, EditMemberForm, ResetPasswordButton } from "../team-forms";

export const metadata: Metadata = { title: "Editar conta" };

export default async function EditMemberPage(props: PageProps<"/equipe/[id]">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [admin, { data: member }, { count: responsibilities }, { data: people }] = await Promise.all([
    requireAdmin(),
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("client_responsibles").select("user_id", { count: "exact", head: true }).eq("user_id", id),
    supabase.from("profiles").select("id, full_name").eq("active", true).neq("id", id).order("full_name"),
  ]);
  if (!member) notFound();
  const isSelf = member.id === admin.id;

  return (
    <>
      <PageHeader
        title="Editar conta"
        description={member.full_name}
        actions={<Link href="/equipe" className="btn-secondary">Voltar para Equipe</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,34rem)_1fr]">
        <section className="card p-6">
          <EditMemberForm
            action={updateMemberAction.bind(null, id)}
            isSelf={isSelf}
            member={{
              full_name: member.full_name,
              email: member.email,
              role: member.role,
              department: member.department,
              active: member.active,
            }}
          />
        </section>

        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="font-extrabold">Senha</h2>
            {isSelf ? (
              <p className="mt-1 text-sm text-muted">
                Para trocar a sua senha, use <Link href="/conta" className="link">Minha conta</Link>.
              </p>
            ) : (
              <>
                <p className="mt-1 mb-4 text-sm text-muted">
                  Se a pessoa esqueceu a senha, gere uma provisória. A senha atual deixa de valer na hora.
                </p>
                <ResetPasswordButton action={resetPasswordAction.bind(null, id)} />
              </>
            )}
          </section>

          {!isSelf && (
            <section className="card border-danger/30 p-6" aria-labelledby="zona-perigo">
              <h2 id="zona-perigo" className="font-extrabold text-danger">Zona de perigo</h2>
              <p className="mt-1 mb-4 text-sm text-muted">
                Excluir remove a conta permanentemente. {responsibilities ?? 0} vínculo(s) de responsável por clientes
                serão transferidos ou removidos.
              </p>
              <DeleteMemberButton
                name={member.full_name}
                responsibilities={responsibilities ?? 0}
                people={people ?? []}
                action={deleteMemberAction.bind(null, id)}
              />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
