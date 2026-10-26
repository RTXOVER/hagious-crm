import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, UserPlus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert, type Tone } from "@/components/page-header";
import { DEPARTMENT_LABEL, ROLE_LABEL } from "@/lib/labels";
import { deleteMemberAction } from "./actions";
import { DeleteMemberButton } from "./team-forms";

export const metadata: Metadata = { title: "Equipe" };

const ROLE_TONE: Record<keyof typeof ROLE_LABEL, Tone> = { admin: "blue", gestor: "green", colaborador: "gray" };

export default async function TeamPage(props: PageProps<"/equipe">) {
  const supabase = await createClient();
  const [admin, { data: members }, { data: resp }, sp] = await Promise.all([
    requireAdmin(),
    supabase.from("profiles").select("*").order("active", { ascending: false }).order("full_name"),
    supabase.from("client_responsibles").select("user_id"),
    props.searchParams,
  ]);

  const respCount = new Map<string, number>();
  for (const r of resp ?? []) respCount.set(r.user_id, (respCount.get(r.user_id) ?? 0) + 1);
  const activePeople = (members ?? []).filter((m) => m.active);

  return (
    <>
      <PageHeader
        title="Equipe"
        description={`${members?.length ?? 0} conta(s). Só administradores veem esta página.`}
        actions={<Link href="/equipe/nova" className="btn-primary"><UserPlus className="h-4 w-4" /> Nova conta</Link>}
      />
      {sp.excluido === "1" && <div className="mb-4"><Alert tone="ok">Conta excluída. O registro da exclusão ficou no histórico.</Alert></div>}

      <section className="card overflow-x-auto" aria-label="Membros da equipe">
        <table className="table-base">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Cargo e departamento</th>
              <th title="Clientes sob responsabilidade">Clientes</th>
              <th>Acesso</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => {
              const isSelf = m.id === admin.id;
              const initials = m.full_name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
              return (
                <tr key={m.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white ${m.active ? "bg-brand-600" : "bg-muted"}`}>
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {m.full_name} {isSelf && <Badge tone="blue">Você</Badge>}
                        </p>
                        <p className="truncate text-xs text-muted">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    {m.department && <p className="mt-1 text-xs text-muted">{DEPARTMENT_LABEL[m.department]}</p>}
                  </td>
                  <td className="tabular-nums">{respCount.get(m.id) ?? 0}</td>
                  <td>{m.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Desativado</Badge>}</td>
                  <td>
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      <Link href={`/equipe/${m.id}`} className="btn-secondary px-3 py-1.5 text-xs" aria-label={`Editar ${m.full_name}`}>
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Link>
                      {!isSelf && (
                        <DeleteMemberButton
                          compact
                          name={m.full_name}
                          responsibilities={respCount.get(m.id) ?? 0}
                          people={activePeople.filter((p) => p.id !== m.id).map((p) => ({ id: p.id, full_name: p.full_name }))}
                          action={deleteMemberAction.bind(null, m.id)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
