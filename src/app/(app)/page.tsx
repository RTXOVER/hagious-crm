import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  History,
  MessageCircle,
  Plus,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/dashboard";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { BarList, ColumnChart, Meter } from "@/components/charts";
import { DEPARTMENT_LABEL, TAX_REGIME_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Painel" };

const TABLE_LABEL: Record<string, string> = {
  clients: "Cadastro do cliente",
  client_contacts: "Contato",
  client_services: "Serviço",
  client_responsibles: "Responsável",
  profiles: "Conta da equipe",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "criado", UPDATE: "alterado", DELETE: "removido" };
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function DashboardPage(props: PageProps<"/">) {
  const supabase = await createClient();
  // Perfil, indicadores e histórico em paralelo (cada consulta ao banco leva ~0,3 s)
  const [profile, dash, { erro }] = await Promise.all([requireProfile(), loadDashboard(supabase), props.searchParams]);
  const manager = isManager(profile);

  const activity = manager
    ? await supabase
        .from("audit_log")
        .select("id, table_name, action, actor_id, created_at, record_id, client_ref:new_data->>client_id, old_client_ref:old_data->>client_id")
        .neq("table_name", "profiles")
        .order("created_at", { ascending: false })
        .limit(8)
    : { data: null };

  const t = dash.totals;
  const todayRaw = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
  const today = todayRaw.charAt(0).toUpperCase() + todayRaw.slice(1); // "Segunda-feira, 26 de outubro"

  return (
    <>
      <PageHeader
        title={`Olá, ${profile.full_name.split(" ")[0]}`}
        description={today}
        actions={
          manager && (
            <Link href="/clientes/novo" className="btn-primary">
              <Plus className="h-4 w-4" /> Novo cliente
            </Link>
          )
        }
      />

      {erro === "sem-permissao" && (
        <div className="mb-6"><Alert tone="warn">Você não tem permissão para acessar aquela página.</Alert></div>
      )}

      {t.clients === 0 ? (
        <EmptyState manager={manager} admin={profile.role === "admin"} />
      ) : (
        <>
          {/* Indicadores principais */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              href="/clientes?status=ativo"
              icon={Building2}
              label="Clientes ativos"
              value={t.active}
              note={t.suspended ? `${t.suspended} suspenso(s)` : `${t.clients} no total`}
            />
            <Stat href="/clientes?novos=30" icon={Sparkles} label="Novos nos últimos 30 dias" value={t.new30} note="Cadastrados no sistema" />
            <Stat href="/clientes" icon={MessageCircle} label="Contatos com WhatsApp autorizado" value={t.whatsappOptIn}>
              <Meter value={t.whatsappOptIn} total={t.contactsWithWhatsapp} label="Contatos com WhatsApp autorizado" />
            </Stat>
            <Stat href="#atencao" icon={CheckCircle2} label="Cadastros completos" value={t.complete}>
              <Meter value={t.complete} total={t.active} label="Clientes ativos com cadastro completo" />
            </Stat>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <Panel title="Clientes ativos por departamento" subtitle="Com ao menos um serviço ativo do departamento">
              <BarList
                unit="clientes"
                labelHeader="Departamento"
                data={dash.byDepartment.map((d) => ({
                  key: d.key,
                  label: DEPARTMENT_LABEL[d.key],
                  value: d.value,
                  href: `/clientes?status=ativo&departamento=${d.key}`,
                }))}
              />
            </Panel>
            <Panel title="Novos clientes por mês" subtitle="Últimos 6 meses, pela data de cadastro no sistema">
              <ColumnChart unit="clientes" labelHeader="Mês" data={dash.months} />
            </Panel>
            <Panel title="Clientes ativos por regime" subtitle="Regime tributário informado no cadastro">
              <BarList
                unit="clientes"
                labelHeader="Regime"
                data={dash.byRegime.map((d) => ({
                  key: d.key,
                  label: TAX_REGIME_LABEL[d.key],
                  value: d.value,
                  href: `/clientes?status=ativo&regime=${d.key}`,
                }))}
              />
            </Panel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            {/* Pendências de cadastro */}
            <section id="atencao" className="card scroll-mt-24 p-6 xl:col-span-2" aria-labelledby="atencao-title">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="atencao-title" className="flex items-center gap-2 text-lg font-extrabold">
                    <AlertTriangle className="h-5 w-5 text-warn" /> Precisa de atenção
                  </h2>
                  <p className="text-sm text-muted">Clientes ativos com cadastro incompleto. Corrija para que lembretes e tarefas funcionem.</p>
                </div>
                <Badge tone={dash.attention.length ? "amber" : "green"}>{dash.attention.length} cliente(s)</Badge>
              </div>
              {!dash.attention.length ? (
                <Alert tone="ok">Todos os clientes ativos estão com o cadastro completo.</Alert>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr><th>Cliente</th><th>Pendências</th><th className="sr-only">Abrir</th></tr>
                    </thead>
                    <tbody>
                      {dash.attention.slice(0, 8).map((a) => (
                        <tr key={a.id}>
                          <td><Link href={`/clientes/${a.id}`} className="link">{a.name}</Link></td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {a.issues.map((i) => <Badge key={i} tone="amber">{i}</Badge>)}
                            </div>
                          </td>
                          <td className="text-right">
                            <Link href={`/clientes/${a.id}`} className="inline-flex text-muted hover:text-ink" aria-label={`Abrir ${a.name}`}>
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {dash.attention.length > 8 && (
                    <p className="mt-3 text-xs text-muted">Mostrando 8 de {dash.attention.length}. Os mais incompletos aparecem primeiro.</p>
                  )}
                </div>
              )}
            </section>

            {manager ? (
              <Panel title="Carteira por responsável" subtitle="Clientes ativos sob responsabilidade de cada pessoa">
                {dash.byResponsible.length ? (
                  <BarList
                    unit="clientes"
                    labelHeader="Responsável"
                    data={dash.byResponsible.slice(0, 8).map((r) => ({ key: r.key, label: r.label, value: r.value }))}
                  />
                ) : (
                  <p className="text-sm text-muted">Nenhum responsável definido ainda. Defina na página de cada cliente.</p>
                )}
              </Panel>
            ) : null}
          </div>

          {manager && (
            <section className="card mt-6 p-6" aria-labelledby="atividade">
              <h2 id="atividade" className="mb-4 flex items-center gap-2 text-lg font-extrabold">
                <History className="h-5 w-5 text-muted" /> Atividade recente
              </h2>
              {!activity.data?.length ? (
                <p className="text-sm text-muted">Sem atividade registrada.</p>
              ) : (
                <ol className="divide-y divide-line">
                  {activity.data.map((h) => {
                    const clientId = h.table_name === "clients" ? h.record_id : (h.client_ref ?? h.old_client_ref);
                    const clientName = clientId ? dash.clientNames.get(String(clientId)) : undefined;
                    return (
                      <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <span>
                          <span className="font-semibold">{TABLE_LABEL[h.table_name] ?? h.table_name}</span>{" "}
                          {ACTION_LABEL[h.action] ?? h.action}
                          {clientName && (
                            <>
                              {" · "}
                              <Link href={`/clientes/${clientId}`} className="link">{clientName}</Link>
                            </>
                          )}
                        </span>
                        <span className="text-xs text-muted">
                          {h.actor_id ? dash.peopleNames.get(h.actor_id) ?? "Usuário" : "Sistema"} · {dateTime.format(new Date(h.created_at))}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          )}

          <p className="mt-6 text-xs text-muted">
            Os números consideram apenas os clientes que você tem permissão para ver. Tickets, prazos e documentos entram no painel a partir da Etapa 3.
          </p>
        </>
      )}
    </>
  );
}

function Stat({
  href,
  icon: Icon,
  label,
  value,
  note,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="card-link group p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-muted">{label}</p>
        <span className="rounded-lg bg-brand-50 p-2 text-link transition group-hover:scale-110">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 text-3xl font-extrabold">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      {children && <div className="mt-3">{children}</div>}
    </Link>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-extrabold">{title}</h2>
      {subtitle && <p className="mb-5 text-sm text-muted">{subtitle}</p>}
      {children}
    </section>
  );
}

function EmptyState({ manager, admin }: { manager: boolean; admin: boolean }) {
  const steps = [
    ...(admin
      ? [{ icon: UserPlus, title: "Monte a equipe", text: "Crie as contas da equipe em Equipe → Nova conta.", href: "/equipe/nova" }]
      : []),
    { icon: Building2, title: "Cadastre os clientes", text: "Informe CNPJ, regime e o contato principal com WhatsApp.", href: "/clientes/novo" },
    { icon: CheckCircle2, title: "Defina responsáveis", text: "Na página de cada cliente, escolha o responsável de cada departamento.", href: "/clientes" },
  ];
  return (
    <section className="card p-8">
      <h2 className="text-xl font-extrabold">Comece por aqui</h2>
      <p className="mt-1 text-sm text-muted">
        {manager ? "O painel ganha vida assim que os primeiros clientes forem cadastrados." : "Você ainda não está vinculado a nenhum cliente. Fale com seu gestor."}
      </p>
      {manager && (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text, href }, i) => (
            <Link key={title} href={href} className="card-link p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-link"><Icon className="h-5 w-5" /></span>
              <p className="mt-3 text-xs font-bold text-muted">Passo {i + 1}</p>
              <p className="font-bold">{title}</p>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
