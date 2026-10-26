import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge } from "@/components/page-header";
import { updateMemberAction } from "./actions";
import { MemberForm } from "./team-forms";

export const metadata: Metadata = { title: "Equipe" };

export default async function TeamPage() {
  const supabase = await createClient();
  const [admin, { data: members }] = await Promise.all([
    requireAdmin(),
    supabase.from("profiles").select("*").order("active", { ascending: false }).order("full_name"),
  ]);

  return (
    <>
      <PageHeader
        title="Equipe"
        description={`${members?.length ?? 0} conta(s). Só administradores veem esta página.`}
        actions={
          <Link href="/equipe/nova" className="btn-primary">
            <UserPlus className="h-4 w-4" /> Nova conta
          </Link>
        }
      />
      <section className="card overflow-x-auto" aria-label="Membros da equipe">
        <table className="table-base">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Cargo, departamento e acesso</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m.id}>
                <td>
                  <p className="font-semibold">
                    {m.full_name} {m.id === admin.id && <Badge tone="blue">Você</Badge>}{" "}
                    {!m.active && <Badge tone="red">Desativado</Badge>}
                  </p>
                  <p className="text-xs text-muted">{m.email}</p>
                </td>
                <td>
                  <MemberForm action={updateMemberAction.bind(null, m.id)} member={m} isSelf={m.id === admin.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
