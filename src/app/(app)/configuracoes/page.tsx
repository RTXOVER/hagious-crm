import type { Metadata } from "next";
import { AlertTriangle, CalendarDays, Clock, ListChecks } from "lucide-react";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { DEPARTMENT_LABEL } from "@/lib/labels";
import { formatSla } from "@/lib/tickets";
import { ConfirmButton } from "../clientes/[id]/detail-forms";
import { addHolidayAction, removeHolidayAction, saveCategoryAction, saveSettingsAction } from "./actions";
import { CategoryForm, HolidayForm, SettingsForm } from "./config-forms";

export const metadata: Metadata = { title: "Prazos e calendário" };

const SCOPE_LABEL = { nacional: "Nacional", estadual: "Estadual", municipal: "Municipal", empresa: "Empresa" } as const;
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

export default async function SettingsPage() {
  const supabase = await createClient();
  const [profile, { data: settings }, { data: categories }, { data: holidays }] = await Promise.all([
    requireManager(),
    supabase.from("sla_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("ticket_categories").select("*").order("department").order("name"),
    supabase.from("holidays").select("*").gte("day", new Date().getFullYear() + "-01-01").order("day"),
  ]);
  const pending = (categories ?? []).filter((c) => c.needs_review).length + (settings?.needs_review ? 1 : 0);

  return (
    <>
      <PageHeader title="Prazos e calendário" description="Regras usadas para calcular os prazos (SLA) de todos os tickets." />

      {pending > 0 && (
        <div className="mb-6">
          <Alert tone="warn">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Há {pending} valor(es) <strong>iniciais a confirmar</strong> com a gestão (marcados abaixo). Eles foram
                preenchidos para o sistema funcionar, mas não vieram do documento de requisitos. Ao salvar, deixam de ser
                marcados.
              </span>
            </span>
          </Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-6" aria-labelledby="expediente">
          <h2 id="expediente" className="mb-1 flex items-center gap-2 text-lg font-extrabold">
            <Clock className="h-5 w-5 text-muted" /> Expediente {settings?.needs_review && <Badge tone="amber">a confirmar</Badge>}
          </h2>
          <p className="mb-4 text-sm text-muted">Prazos só correm dentro do expediente, em dias úteis. Fuso: horário de Brasília.</p>
          {settings ? (
            <SettingsForm action={saveSettingsAction} initial={settings} canEdit={profile.role === "admin"} />
          ) : (
            <Alert tone="danger">Configuração não encontrada. A migração do banco da Etapa 3 foi aplicada?</Alert>
          )}
        </section>

        <section className="card p-6" aria-labelledby="feriados">
          <h2 id="feriados" className="mb-1 flex items-center gap-2 text-lg font-extrabold"><CalendarDays className="h-5 w-5 text-muted" /> Feriados</h2>
          <p className="mb-4 text-sm text-muted">
            Feriados nacionais já cadastrados. Inclua os <strong>municipais e estaduais</strong> da cidade da Hagious e
            recessos (ex.: Carnaval, se não houver expediente).
          </p>
          <HolidayForm action={addHolidayAction} />
          <ul className="mt-4 max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {(holidays ?? []).map((h) => (
              <li key={h.day} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <span className="font-semibold tabular-nums">{dateFmt.format(new Date(`${h.day}T12:00:00Z`))}</span> · {h.name}{" "}
                  <Badge tone={h.scope === "nacional" ? "gray" : "blue"}>{SCOPE_LABEL[h.scope]}</Badge>
                </span>
                <ConfirmButton action={removeHolidayAction.bind(null, h.day)} label="Remover" question={`Remover o feriado "${h.name}"?`} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card mt-6 p-6" aria-labelledby="tipos">
        <h2 id="tipos" className="mb-1 flex items-center gap-2 text-lg font-extrabold"><ListChecks className="h-5 w-5 text-muted" /> Tipos de solicitação e prazos</h2>
        <p className="mb-4 text-sm text-muted">
          Cada ticket herda o prazo do seu tipo no momento da abertura. Mudanças aqui valem para os próximos tickets.
        </p>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Tipo</th><th>Departamento</th><th>Resolução</th><th>1ª resposta</th><th>Situação</th><th className="text-right">Editar</th></tr>
            </thead>
            <tbody>
              {(categories ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold">{c.name} {c.needs_review && <Badge tone="amber">a confirmar</Badge>}</td>
                  <td>{DEPARTMENT_LABEL[c.department]}</td>
                  <td>{formatSla(c.resolution_value, c.resolution_unit)}</td>
                  <td>{c.first_response_minutes ? `${c.first_response_minutes / 60} h úteis` : <span className="text-muted">padrão</span>}</td>
                  <td>{c.active ? <Badge tone="green">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                  <td className="text-right">
                    <details className="inline-block text-left">
                      <summary className="btn-secondary cursor-pointer list-none px-3 py-1.5 text-xs">Editar</summary>
                      <div className="absolute right-6 z-10 mt-2 w-[min(36rem,calc(100vw-3rem))] rounded-2xl border border-line bg-surface p-5 shadow-(--shadow-lift)">
                        <CategoryForm
                          action={saveCategoryAction.bind(null, c.id)}
                          submitLabel="Salvar tipo"
                          initial={{ ...c, department: c.department as "contabil" | "fiscal" | "dp" }}
                        />
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 font-bold">Novo tipo de solicitação</h3>
          <CategoryForm action={saveCategoryAction.bind(null, null)} submitLabel="Criar tipo" />
        </div>
      </section>
    </>
  );
}
