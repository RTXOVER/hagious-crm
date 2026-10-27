import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarCheck2, CheckCircle2, Clock, FileClock, Gauge, HeartHandshake, Info, Ticket, Timer, UserX } from "lucide-react";
import { getFormatter } from "@/lib/preferences-server";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { departmentOptions, peopleOptions } from "@/components/ui/options";
import { BarList, RateList } from "@/components/charts";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import { todaySP } from "@/lib/documents";
import { isUuid } from "@/lib/validation/ids";
import { nowIso } from "@/lib/dates";
import { PERIOD_OPTIONS, aggregateTickets, formatBusinessMinutes, periodBounds, rate, resolvePeriod, type MetricRow } from "@/lib/indicators";

export const metadata: Metadata = { title: "Indicadores" };

export default async function IndicatorsPage(props: PageProps<"/indicadores">) {
  const f = await getFormatter();
  const sp = await props.searchParams;
  const today = todaySP();
  const period = resolvePeriod(sp, today);
  const { start, end } = periodBounds(period);
  const dep = OPERATIONAL_DEPARTMENTS.find((d) => d === sp.departamento);
  const resp = typeof sp.responsavel === "string" && (isUuid(sp.responsavel) || sp.responsavel === "nenhum") ? sp.responsavel : undefined;
  const now = nowIso();
  const supabase = await createClient();

  // Situação agora (não depende do período), com os mesmos filtros
  const openBase = () => {
    let b = supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", ["aberto", "em_andamento", "aguardando_cliente"]);
    if (dep) b = b.eq("department", dep);
    if (resp === "nenhum") b = b.is("assignee_id", null);
    else if (resp) b = b.eq("assignee_id", resp);
    return b;
  };
  const docBase = () => {
    let b = supabase.from("client_documents").select("id", { count: "exact", head: true }).eq("status", "pendente");
    if (dep) b = b.eq("department", dep);
    return b;
  };
  const successBase = () => {
    let b = supabase.from("success_actions").select("id", { count: "exact", head: true });
    if (resp === "nenhum") b = b.is("responsible_id", null);
    else if (resp) b = b.eq("responsible_id", resp);
    return b;
  };
  let lateDocsQ = supabase.from("client_documents").select("client_id, client:clients(legal_name)").eq("status", "pendente").lt("due_date", today).limit(5000);
  if (dep) lateDocsQ = lateDocsQ.eq("department", dep);

  const [profile, metrics, people, sla, tOpen, tLate, tRisk, dPending, lateDocs, sPlanned, sDone, sLate, overview] = await Promise.all([
    requireProfile(),
    supabase.rpc("ticket_metrics", { p_from: start, p_to: end }),
    supabase.from("profiles").select("id, full_name, department, active").order("full_name"),
    supabase.from("sla_settings").select("work_start, work_end").eq("id", 1).maybeSingle(),
    openBase(),
    openBase().neq("status", "aguardando_cliente").lt("resolution_due_at", now),
    openBase().neq("status", "aguardando_cliente").lte("risk_at", now).gte("resolution_due_at", now),
    docBase(),
    lateDocsQ,
    successBase().gte("planned_date", period.from).lte("planned_date", period.to),
    successBase().eq("status", "realizada").gte("done_at", start).lt("done_at", end),
    successBase().eq("status", "planejada").lt("planned_date", today),
    supabase.rpc("success_client_overview"),
  ]);

  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const toMin = (t?: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 0);
  const workday = sla.data ? Math.max(60, toMin(sla.data.work_end) - toMin(sla.data.work_start)) : 600;
  const fmtMin = (m: number | null) => formatBusinessMinutes(m, workday, f.prefs.language);
  const agg = aggregateTickets((metrics.data ?? []) as MetricRow[], period, { department: dep, assignee: resp }, {
    department: (k) => DEPARTMENT_LABEL[k as keyof typeof DEPARTMENT_LABEL] ?? k,
    person: (id) => nameOf.get(id) ?? "Usuário removido",
  });
  const T = agg.total;
  const critical = new Map<string, { id: string; name: string; count: number }>();
  for (const d of lateDocs.data ?? []) {
    const c = critical.get(d.client_id) ?? { id: d.client_id, name: d.client?.legal_name ?? "Cliente", count: 0 };
    c.count++;
    critical.set(d.client_id, c);
  }
  const criticalList = [...critical.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const staleCount = (overview.data ?? []).filter((o) => o.stale).length;

  // Links que levam aos registros de origem, já filtrados
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return p.toString();
  };
  const range = { de: period.from, ate: period.to };
  const ticketsHref = (extra: Record<string, string | undefined>) => `/tickets?${qs({ departamento: dep, responsavel: resp, ...extra })}`;
  const selfHref = (extra: Record<string, string | undefined>) => {
    const s = qs({ departamento: dep, responsavel: resp, ...extra });
    return s ? `/indicadores?${s}` : "/indicadores";
  };
  const periodText = `${f.date(period.from)} a ${f.date(period.to)}`;

  return (
    <>
      <PageHeader
        title="Indicadores"
        description={`Visão gerencial de prazos, volume, documentos e relacionamento · ${periodText}`}
      />

      {/* Filtros */}
      <div className="card mb-6 space-y-3 p-4">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Período">
          <span className="mr-1 text-xs font-bold tracking-wide text-muted uppercase">Período</span>
          {PERIOD_OPTIONS.map((o) => (
            <Link key={o.value} href={selfHref({ periodo: o.value === "30d" ? undefined : o.value })} aria-current={period.key === o.value ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${period.key === o.value ? "bg-brand-600 text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
              {o.label}
            </Link>
          ))}
        </nav>
        <form key={JSON.stringify(sp)} className="flex flex-wrap items-end gap-2" role="search" aria-label="Filtros dos indicadores">
          {period.key !== "personalizado" && period.key !== "30d" && <input type="hidden" name="periodo" value={period.key} />}
          <div>
            <label htmlFor="de" className="label">De</label>
            <input id="de" name="de" type="date" max={today} defaultValue={period.from} className="input py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="ate" className="label">Até</label>
            <input id="ate" name="ate" type="date" max={today} defaultValue={period.to} className="input py-1.5 text-sm" />
          </div>
          <Select name="departamento" size="sm" className="w-52" aria-label="Departamento" defaultValue={dep ?? ""}
            options={departmentOptions({ all: "Todos os departamentos" })} />
          <Select name="responsavel" size="sm" className="w-52" aria-label="Responsável" defaultValue={resp ?? ""} searchable
            options={[...peopleOptions((people.data ?? []).filter((p) => p.active || p.id === resp), { empty: "Todos os responsáveis" }), { value: "nenhum", label: "Sem responsável" }]} />
          <button className="btn-secondary">Aplicar</button>
          {(dep || resp || sp.periodo || sp.de) && <Link href="/indicadores" className="self-center px-2 py-2 text-xs font-semibold text-muted hover:text-ink">Limpar</Link>}
        </form>
        {sp.de && period.key !== "personalizado" && (
          <p className="text-xs text-warn">Período personalizado inválido (máximo de 1 ano, sem datas futuras). Mostrando os últimos 30 dias.</p>
        )}
      </div>

      {metrics.error && (
        <div className="mb-6"><Alert tone="danger">Não foi possível calcular os indicadores de tickets. Recarregue a página.</Alert></div>
      )}

      {/* Tickets */}
      <SectionTitle icon={Ticket}>Tickets {dep && <Badge>{DEPARTMENT_LABEL[dep]}</Badge>} {resp && <Badge>{resp === "nenhum" ? "Sem responsável" : nameOf.get(resp)}</Badge>}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi href={ticketsHref({})} icon={Ticket} label="Abertos agora" value={String(tOpen.count ?? 0)} note="Aberto, em andamento ou aguardando cliente" />
        <Kpi href={ticketsHref({ visao: "risco" })} icon={Clock} label="Perto de vencer" value={String(tRisk.count ?? 0)} note="Passaram do ponto de alerta" tone={(tRisk.count ?? 0) > 0 ? "warn" : undefined} />
        <Kpi href={ticketsHref({ visao: "atrasados" })} icon={AlertTriangle} label="Atrasados" value={String(tLate.count ?? 0)} note="Prazo de resolução vencido" tone={(tLate.count ?? 0) > 0 ? "danger" : undefined} />
        <Kpi href={ticketsHref({ visao: "todos", ...range })} icon={CalendarCheck2} label="Abertos no período" value={String(T.opened)} note={`${T.concluded} concluído(s) no período`} />
        <Kpi href={ticketsHref({ visao: "encerrados", ...range })} icon={CheckCircle2} label="Prazo de resolução cumprido" value={pct(rate(T.onTime, T.concluded))} note={T.concluded ? `${T.onTime} de ${T.concluded} concluídos` : "Nenhum concluído no período"} />
        <Kpi href={ticketsHref({ visao: "todos", ...range })} icon={Gauge} label="1ª resposta no prazo" value={pct(rate(T.respondedOnTime, T.responded))} note={T.responded ? `${T.respondedOnTime} de ${T.responded} respondidos` : "Nenhuma resposta no período"} />
        <Kpi href={ticketsHref({ visao: "todos", ...range })} icon={Timer} label="Tempo médio de 1ª resposta" value={fmtMin(T.avgFirstResponse)} note="Em horário útil" />
        <Kpi href={ticketsHref({ visao: "encerrados", ...range })} icon={Timer} label="Tempo médio de resolução" value={fmtMin(T.avgResolution)} note="Em horário útil, sem a espera do cliente" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Prazo cumprido por departamento" subtitle="Concluídos no período resolvidos até o prazo">
          {agg.byDepartment.some((g) => g.concluded) ? (
            <RateList labelHeader="Departamento" partHeader="No prazo" totalHeader="Concluídos"
              data={agg.byDepartment.filter((g) => g.concluded).map((g) => ({ key: g.key, label: g.label, part: g.onTime, total: g.concluded, href: `/tickets?${qs({ visao: "encerrados", departamento: g.key, responsavel: resp, ...range })}` }))} />
          ) : <Empty>Nenhum ticket concluído no período.</Empty>}
        </Panel>
        <Panel title="Prazo cumprido por tipo de solicitação" subtitle="Mesma regra, separada pelo tipo do ticket">
          {agg.byCategory.some((g) => g.concluded) ? (
            <RateList labelHeader="Tipo" partHeader="No prazo" totalHeader="Concluídos"
              data={agg.byCategory.filter((g) => g.concluded).slice(0, 10).map((g) => ({ key: g.key, label: g.label, part: g.onTime, total: g.concluded, href: `/tickets?${qs({ visao: "encerrados", categoria: g.key, departamento: dep, responsavel: resp, ...range })}` }))} />
          ) : <Empty>Nenhum ticket concluído no período.</Empty>}
        </Panel>
        <Panel title="Volume por departamento" subtitle="Tickets abertos no período">
          {T.opened ? (
            <BarList unit="tickets" labelHeader="Departamento"
              data={agg.byDepartment.filter((g) => g.opened).map((g) => ({ key: g.key, label: g.label, value: g.opened, href: `/tickets?${qs({ visao: "todos", departamento: g.key, responsavel: resp, ...range })}` }))} />
          ) : <Empty>Nenhum ticket aberto no período.</Empty>}
        </Panel>
        <Panel title="Volume por responsável" subtitle="Tickets abertos no período, pelo responsável atual">
          {T.opened ? (
            <BarList unit="tickets" labelHeader="Responsável"
              data={agg.byAssignee.filter((g) => g.opened).slice(0, 10).map((g) => ({ key: g.key, label: g.label, value: g.opened, href: `/tickets?${qs({ visao: "todos", responsavel: g.key, departamento: dep, ...range })}` }))} />
          ) : <Empty>Nenhum ticket aberto no período.</Empty>}
        </Panel>
      </div>

      <section className="card mt-6 overflow-x-auto p-6" aria-labelledby="tempos">
        <h2 id="tempos" className="text-lg font-extrabold">Tempos médios por departamento</h2>
        <p className="mb-4 text-sm text-muted">Em horário útil (expediente e feriados cadastrados). A resolução desconta o tempo aguardando o cliente.</p>
        {agg.byDepartment.length ? (
          <table className="table-base">
            <thead>
              <tr><th>Departamento</th><th className="text-right">1ª resposta</th><th className="text-right">Respondidos</th><th className="text-right">Resolução</th><th className="text-right">Concluídos</th></tr>
            </thead>
            <tbody>
              {agg.byDepartment.map((g) => (
                <tr key={g.key}>
                  <td><Link href={`/tickets?${qs({ visao: "todos", departamento: g.key, responsavel: resp, ...range })}`} className="link">{g.label}</Link></td>
                  <td className="text-right tabular-nums">{fmtMin(g.avgFirstResponse)}</td>
                  <td className="text-right tabular-nums text-muted">{g.responded}</td>
                  <td className="text-right tabular-nums">{fmtMin(g.avgResolution)}</td>
                  <td className="text-right tabular-nums text-muted">{g.concluded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Sem tickets no período.</Empty>}
      </section>

      {/* Documentos */}
      <SectionTitle icon={FileClock}>Documentos {dep && <Badge>{DEPARTMENT_LABEL[dep]}</Badge>}</SectionTitle>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Kpi href={`/documentos?${qs({ departamento: dep })}`} icon={FileClock} label="Pendentes agora" value={String(dPending.count ?? 0)} note="Aguardando entrega do cliente" />
        <Kpi href={`/documentos?${qs({ visao: "criticos", departamento: dep })}`} icon={AlertTriangle} label="Atrasados" value={String(lateDocs.data?.length ?? 0)} note="Vencidos sem entrega" tone={lateDocs.data?.length ? "danger" : undefined} />
        <Panel title="Clientes críticos" subtitle="Com documento atrasado (mais pendências primeiro)">
          {criticalList.length ? (
            <ul className="space-y-1.5 text-sm">
              {criticalList.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link href={`/clientes/${c.id}#documentos`} className="link truncate">{c.name}</Link>
                  <Badge tone="red">{c.count}</Badge>
                </li>
              ))}
              {criticalList.length > 5 && <li><Link href={`/documentos?${qs({ visao: "criticos", departamento: dep })}`} className="text-xs text-muted hover:text-ink">Ver todos ({criticalList.length})</Link></li>}
            </ul>
          ) : <Empty>Nenhum cliente com documento atrasado.</Empty>}
        </Panel>
      </div>

      {/* Sucesso do cliente */}
      <SectionTitle icon={HeartHandshake}>Contatos proativos {resp && <Badge>{resp === "nenhum" ? "Sem responsável" : nameOf.get(resp)}</Badge>}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi href={`/sucesso?${qs({ visao: "todas", responsavel: resp })}`} icon={CalendarCheck2} label="Previstos no período" value={String(sPlanned.count ?? 0)} note="Com data prevista dentro do período" />
        <Kpi href={`/sucesso?${qs({ visao: "realizadas", responsavel: resp })}`} icon={CheckCircle2} label="Realizados no período" value={String(sDone.count ?? 0)} note="Com resultado registrado" />
        <Kpi href={`/sucesso?${qs({ visao: "atrasadas", responsavel: resp })}`} icon={AlertTriangle} label="Pendentes atrasados" value={String(sLate.count ?? 0)} note="Data prevista já passou" tone={(sLate.count ?? 0) > 0 ? "danger" : undefined} />
        <Kpi href="/sucesso?visao=sem_acompanhamento" icon={UserX} label="Clientes sem acompanhamento" value={String(staleCount)} note="Sem ação realizada no prazo configurado" tone={staleCount > 0 ? "warn" : undefined} />
      </div>

      <details className="card mt-8 p-5 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-bold"><Info className="h-4 w-4 text-muted" /> Como cada número é calculado</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
          <li><strong className="text-ink">Período:</strong> datas de Brasília, do início ao fim (inclusive). Padrão: últimos 30 dias.</li>
          <li><strong className="text-ink">Abertos agora, perto de vencer e atrasados:</strong> situação neste momento, com as mesmas regras dos alertas automáticos (tickets aguardando o cliente não contam como atrasados).</li>
          <li><strong className="text-ink">Abertos no período:</strong> tickets criados dentro do período, em qualquer situação atual.</li>
          <li><strong className="text-ink">Prazo de resolução cumprido:</strong> concluídos no período resolvidos até o prazo ÷ concluídos no período. Cancelados não entram.</li>
          <li><strong className="text-ink">1ª resposta no prazo:</strong> tickets com 1ª resposta no período respondidos até o prazo de 1ª resposta.</li>
          <li><strong className="text-ink">Tempos médios:</strong> média em horário útil ({fmtMin(workday)} por dia útil, feriados excluídos). A resolução desconta o tempo em “aguardando cliente”.</li>
          <li><strong className="text-ink">Volume por responsável:</strong> pelo responsável atual do ticket.</li>
          <li><strong className="text-ink">Documentos:</strong> situação neste momento; o filtro de responsável não se aplica (a cobrança pode ser automática).</li>
          <li><strong className="text-ink">Contatos proativos:</strong> ações de Sucesso do cliente; o filtro de departamento não se aplica.</li>
          <li><strong className="text-ink">Permissões:</strong> {isManager(profile) ? "a gestão vê todos os clientes." : "você vê apenas os números dos clientes que atende."} Clicar em um número abre a lista de origem com os mesmos filtros.</li>
        </ul>
      </details>
    </>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-3 flex flex-wrap items-center gap-2 text-sm font-bold tracking-wide text-muted uppercase first:mt-0">
      <Icon className="h-4 w-4" /> {children}
    </h2>
  );
}

function Kpi({ href, icon: Icon, label, value, note, tone }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; value: string; note?: string; tone?: "warn" | "danger" }) {
  return (
    <Link href={href} className="card-link group p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-muted">{label}</p>
        <span className={`rounded-lg p-2 transition group-hover:scale-110 ${tone === "danger" ? "bg-danger-soft text-danger" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-brand-50 text-link"}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 text-3xl font-extrabold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </Link>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h3 className="text-lg font-extrabold">{title}</h3>
      {subtitle && <p className="mb-5 text-sm text-muted">{subtitle}</p>}
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted">{children}</p>;
