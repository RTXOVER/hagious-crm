import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarCheck2, CalendarClock, HeartHandshake, Plus, Search, UserX } from "lucide-react";
import { getFormatter } from "@/lib/preferences-server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { peopleOptions } from "@/components/ui/options";
import { addDays, todaySP } from "@/lib/documents";
import { isUuid } from "@/lib/validation/ids";
import { RECURRENCE_LABEL, SUCCESS_TYPES, SUCCESS_TYPE_LABEL, planState, sinceLabel, type SuccessType } from "@/lib/success";

export const metadata: Metadata = { title: "Sucesso do cliente" };

const VIEWS = [
  { key: "proximas", label: "Programadas" },
  { key: "atrasadas", label: "Atrasadas" },
  { key: "minhas", label: "Minhas" },
  { key: "sem_acompanhamento", label: "Sem acompanhamento" },
  { key: "realizadas", label: "Realizadas" },
  { key: "todas", label: "Todas" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function SuccessPage(props: PageProps<"/sucesso">) {
  const f = await getFormatter();
  const sp = await props.searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.visao) ? (sp.visao as View) : "proximas";
  const type = SUCCESS_TYPES.find((t) => t === sp.tipo);
  const resp = typeof sp.responsavel === "string" && isUuid(sp.responsavel) ? sp.responsavel : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const today = todaySP();
  const monthStart = `${today.slice(0, 7)}-01`;
  const supabase = await createClient();
  const profile = await requireProfile();

  let query = supabase
    .from("success_actions")
    .select("id, type, objective, planned_date, status, recurrence, responsible_id, done_at, result, client:clients!inner(id, legal_name, status)", { count: "exact" })
    .limit(200);
  if (view === "proximas") query = query.eq("status", "planejada").order("planned_date");
  if (view === "atrasadas") query = query.eq("status", "planejada").lt("planned_date", today).order("planned_date");
  if (view === "minhas") query = query.eq("status", "planejada").eq("responsible_id", profile.id).order("planned_date");
  if (view === "realizadas") query = query.eq("status", "realizada").order("done_at", { ascending: false });
  if (view === "todas") query = query.order("planned_date", { ascending: false });
  if (type) query = query.eq("type", type);
  if (resp) query = query.eq("responsible_id", resp);
  if (q) query = query.ilike("client.legal_name", `%${q.replace(/[,()*%\\:"]/g, " ").trim()}%`);

  function count() {
    let b = supabase.from("success_actions").select("id", { count: "exact", head: true });
    if (type) b = b.eq("type", type);
    if (resp) b = b.eq("responsible_id", resp);
    return b;
  }

  const [{ data: rows, count: total, error }, people, overview, cLate, cWeek, cDone, cMine, settings] = await Promise.all([
    view === "sem_acompanhamento" ? Promise.resolve({ data: null, count: null, error: null }) : query,
    supabase.from("profiles").select("id, full_name, department, active").order("full_name"),
    supabase.rpc("success_client_overview"),
    count().eq("status", "planejada").lt("planned_date", today),
    count().eq("status", "planejada").gte("planned_date", today).lte("planned_date", addDays(today, 7)),
    count().eq("status", "realizada").gte("done_at", `${monthStart}T00:00:00-03:00`),
    supabase.from("success_actions").select("id", { count: "exact", head: true }).eq("status", "planejada").eq("responsible_id", profile.id),
    supabase.from("success_settings").select("stale_days").eq("id", 1).maybeSingle(),
  ]);
  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const staleDays = settings.data?.stale_days ?? 90;
  const stale = (overview.data ?? [])
    .filter((o) => o.stale && (!q || o.legal_name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(a.next_planned !== null) - Number(b.next_planned !== null) || (b.days_without ?? 1e9) - (a.days_without ?? 1e9));
  const staleTotal = (overview.data ?? []).filter((o) => o.stale).length;
  const counts: Partial<Record<View, number | null>> = { atrasadas: cLate.count, minhas: cMine.count, sem_acompanhamento: staleTotal };

  const href = (v: View) => {
    const p = new URLSearchParams();
    if (v !== "proximas") p.set("visao", v);
    if (type) p.set("tipo", type);
    if (resp) p.set("responsavel", resp);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/sucesso?${s}` : "/sucesso";
  };

  const tiles = [
    { label: "Atrasadas", value: cLate.count ?? 0, icon: AlertTriangle, tone: (cLate.count ?? 0) > 0 ? "text-danger" : "text-muted", href: href("atrasadas") },
    { label: "Próximos 7 dias", value: cWeek.count ?? 0, icon: CalendarClock, tone: "text-warn", href: href("proximas") },
    { label: "Realizadas no mês", value: cDone.count ?? 0, icon: CalendarCheck2, tone: "text-ok", href: href("realizadas") },
    { label: "Sem acompanhamento", value: staleTotal, icon: UserX, tone: staleTotal > 0 ? "text-warn" : "text-muted", href: href("sem_acompanhamento") },
  ];

  return (
    <>
      <PageHeader
        title="Sucesso do cliente"
        description="Contatos proativos: acompanhamento periódico, reuniões de saúde financeira, alertas tributários e ações consultivas."
        actions={<Link href="/sucesso/nova" className="btn-primary"><Plus className="h-4 w-4" /> Programar ação</Link>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card-link flex items-center gap-3 p-4">
            <t.icon className={`h-5 w-5 shrink-0 ${t.tone}`} />
            <span className="min-w-0">
              <span className="block text-2xl font-extrabold tabular-nums">{t.value}</span>
              <span className="block truncate text-xs text-muted">{t.label}</span>
            </span>
          </Link>
        ))}
      </div>

      <nav className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Visões">
        {VIEWS.map((v) => {
          const n = counts[v.key];
          return (
            <Link key={v.key} href={href(v.key)} aria-current={view === v.key ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${view === v.key ? "bg-brand-600 text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
              {v.label}
              {typeof n === "number" && n > 0 && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${view === v.key ? "bg-white/25" : v.key === "atrasadas" ? "bg-danger-soft text-danger" : "bg-surface-2"}`}>{n}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <form key={JSON.stringify(sp)} className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        {view !== "proximas" && <input type="hidden" name="visao" value={view} />}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Buscar pelo nome do cliente" className="input pl-9" aria-label="Buscar ações por cliente" />
        </div>
        {view !== "sem_acompanhamento" && (
          <>
            <Select name="tipo" size="sm" className="w-60" aria-label="Tipo de ação" defaultValue={type ?? ""} submitOnChange
              options={[{ value: "", label: "Todos os tipos" }, ...SUCCESS_TYPES.map((t) => ({ value: t, label: SUCCESS_TYPE_LABEL[t] }))]} />
            {view !== "minhas" && (
              <Select name="responsavel" size="sm" className="w-56" aria-label="Responsável" defaultValue={resp ?? ""} submitOnChange searchable
                options={peopleOptions((people.data ?? []).filter((p) => p.active || p.id === resp), { empty: "Todos os responsáveis" })} />
            )}
          </>
        )}
        <button className="btn-secondary">Filtrar</button>
      </form>

      {view === "sem_acompanhamento" ? (
        overview.error ? (
          <p role="alert" className="card p-6 text-sm text-danger">Não foi possível carregar os clientes. Recarregue a página.</p>
        ) : !stale.length ? (
          <div className="card p-10 text-center">
            <HeartHandshake className="mx-auto mb-2 h-8 w-8 text-ok" />
            <p className="font-semibold">Todos os clientes ativos tiveram acompanhamento nos últimos {staleDays} dias.</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <p className="border-b border-line px-4 py-3 text-sm text-muted">
              Clientes ativos sem nenhuma ação realizada nos últimos <strong className="text-ink">{staleDays} dias</strong>. Os sem nada programado aparecem primeiro.
            </p>
            <table className="table-base">
              <thead>
                <tr><th>Cliente</th><th>Último acompanhamento</th><th>Próxima ação</th><th className="text-right">Ação</th></tr>
              </thead>
              <tbody>
                {stale.map((o) => (
                  <tr key={o.client_id}>
                    <td><Link href={`/clientes/${o.client_id}#sucesso`} className="link">{o.legal_name}</Link></td>
                    <td className="text-sm">
                      {o.last_done_at ? <>{f.date(o.last_done_at)} <span className="text-xs text-muted">· {sinceLabel(o.days_without)}</span></> : <Badge tone="amber">Nunca acompanhado</Badge>}
                    </td>
                    <td className="text-sm">
                      {o.next_planned && o.next_action_id ? (
                        <Link href={`/sucesso/${o.next_action_id}`} className="hover:underline">{f.date(o.next_planned)}</Link>
                      ) : (
                        <span className="text-danger">Nada programado</span>
                      )}
                    </td>
                    <td className="text-right">
                      {!o.next_planned && (
                        <Link href={`/sucesso/nova?cliente=${o.client_id}`} className="btn-secondary px-2.5 py-1 text-xs"><Plus className="h-3.5 w-3.5" /> Programar</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : error ? (
        <p role="alert" className="card p-6 text-sm text-danger">Não foi possível carregar as ações. Recarregue a página.</p>
      ) : !rows?.length ? (
        <div className="card p-10 text-center">
          <p className="font-semibold">Nenhuma ação nesta visão.</p>
          <p className="mt-1 text-sm text-muted">
            {view === "atrasadas" ? "Ótimo: nenhuma ação atrasada." : "Programe contatos periódicos e reuniões para manter o relacionamento com os clientes."}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Ação</th>
                <th>Cliente</th>
                <th>{view === "realizadas" ? "Realizada em" : "Data prevista"}</th>
                <th>Responsável</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const st = planState(a.status, a.planned_date, today);
                return (
                  <tr key={a.id}>
                    <td className="max-w-sm">
                      <Link href={`/sucesso/${a.id}`} className="link">{a.objective}</Link>
                      <p className="mt-0.5 text-xs text-muted">
                        {SUCCESS_TYPE_LABEL[a.type as SuccessType]}
                        {a.recurrence !== "nenhuma" && <> · {RECURRENCE_LABEL[a.recurrence].toLowerCase()}</>}
                      </p>
                      {view === "realizadas" && a.result && <p className="mt-1 line-clamp-2 text-xs">{a.result}</p>}
                    </td>
                    <td>
                      <Link href={`/clientes/${a.client.id}#sucesso`} className="hover:underline">{a.client.legal_name}</Link>
                      {a.client.status !== "ativo" && <p className="text-xs text-warn">Cliente {a.client.status}: sem lembretes</p>}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="tabular-nums">{view === "realizadas" ? f.date(a.done_at) : f.date(a.planned_date)}</span>
                      {view !== "realizadas" && <p className="mt-0.5"><Badge tone={st.tone}>{st.label}</Badge></p>}
                    </td>
                    <td className="text-sm">{a.responsible_id ? nameOf.get(a.responsible_id) ?? "—" : <span className="text-muted">Sem responsável</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(total ?? 0) > 200 && <p className="p-3 text-xs text-muted">Mostrando 200 de {total}. Use os filtros para refinar.</p>}
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        {profile.role === "colaborador" ? "Você vê as ações dos clientes que atende. " : ""}
        O responsável recebe um aviso no dia previsto e outro se a data passar sem registro (verificação a cada hora, no expediente).
      </p>
      {view === "todas" && <div className="mt-2"><Alert tone="info">“Todas” mostra as 200 ações mais recentes.</Alert></div>}
    </>
  );
}
