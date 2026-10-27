import type { Metadata } from "next";
import { getFormatter } from "@/lib/preferences-server";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { departmentOptions, peopleOptions } from "@/components/ui/options";
import { isUuid } from "@/lib/validation/ids";
import { isRealDate } from "@/lib/validation/schemas";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import {
  OPEN_STATUSES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  relativeTime,
  slaState,
  ticketNumber,
} from "@/lib/tickets";
import { nowIso } from "@/lib/dates";

export const metadata: Metadata = { title: "Tickets" };

const VIEWS = [
  { key: "abertos", label: "Abertos" },
  { key: "meus", label: "Meus" },
  { key: "risco", label: "Em risco" },
  { key: "atrasados", label: "Atrasados" },
  { key: "sem_responsavel", label: "Sem responsável" },
  { key: "encerrados", label: "Encerrados" },
  { key: "todos", label: "Todos" },
] as const;
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isRealDate(v) ? v : undefined);
type View = (typeof VIEWS)[number]["key"];

export default async function TicketsPage(props: PageProps<"/tickets">) {
  const f = await getFormatter();
  const sp = await props.searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.visao) ? (sp.visao as View) : "abertos";
  const dep = OPERATIONAL_DEPARTMENTS.find((d) => d === sp.departamento);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  // Filtros usados pelos links do painel de indicadores
  const resp = typeof sp.responsavel === "string" && (isUuid(sp.responsavel) || sp.responsavel === "nenhum") ? sp.responsavel : undefined;
  const cat = typeof sp.categoria === "string" && isUuid(sp.categoria) ? sp.categoria : undefined;
  const from = day(sp.de);
  const to = day(sp.ate);
  const now = nowIso();

  const supabase = await createClient();
  const profile = await requireProfile();

  let query = supabase
    .from("tickets")
    .select(
      "id, number, title, status, priority, department, resolution_due_at, risk_at, resolved_at, closed_at, created_at, client:clients(id, legal_name), assignee:profiles!tickets_assignee_id_fkey(full_name), category:ticket_categories(name)",
      { count: "exact" },
    )
    .limit(100);

  if (view === "encerrados") {
    query = query.in("status", ["concluido", "cancelado"]).order("closed_at", { ascending: false });
  } else if (view === "todos") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.in("status", [...OPEN_STATUSES]).order("resolution_due_at", { ascending: true });
    if (view === "meus") query = query.eq("assignee_id", profile.id);
    if (view === "sem_responsavel") query = query.is("assignee_id", null);
    // Atrasado / em risco: mesmas regras dos alertas (tickets pausados não contam)
    if (view === "atrasados") query = query.neq("status", "aguardando_cliente").lt("resolution_due_at", now);
    if (view === "risco") query = query.neq("status", "aguardando_cliente").lte("risk_at", now).gte("resolution_due_at", now);
  }
  if (dep) query = query.eq("department", dep);
  if (resp === "nenhum") query = query.is("assignee_id", null);
  else if (resp) query = query.eq("assignee_id", resp);
  if (cat) query = query.eq("category_id", cat);
  // Período: encerrados pela data de encerramento; as demais visões pela data de abertura (fuso de Brasília)
  const periodCol = view === "encerrados" ? "closed_at" : "created_at";
  if (from) query = query.gte(periodCol, `${from}T00:00:00-03:00`);
  if (to) query = query.lte(periodCol, `${to}T23:59:59.999-03:00`);
  if (q) {
    const num = Number(q.replace(/^#/, ""));
    const safe = q.replace(/[,()*%\\:"]/g, " ").trim();
    query = Number.isInteger(num) && num > 0 ? query.eq("number", num) : query.ilike("title", `%${safe}%`);
  }

  const [{ data: tickets, count, error }, people, category] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name, department, active").order("full_name"),
    cat ? supabase.from("ticket_categories").select("name").eq("id", cat).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const href = (v: View) => {
    const p = new URLSearchParams();
    if (v !== "abertos") p.set("visao", v);
    if (dep) p.set("departamento", dep);
    if (resp) p.set("responsavel", resp);
    if (cat) p.set("categoria", cat);
    if (from) p.set("de", from);
    if (to) p.set("ate", to);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/tickets?${s}` : "/tickets";
  };

  return (
    <>
      <PageHeader
        title="Tickets"
        description="Toda solicitação de cliente registrada, com responsável e prazo."
        actions={<Link href="/tickets/novo" className="btn-primary"><Plus className="h-4 w-4" /> Novo ticket</Link>}
      />

      <nav className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Visões">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={href(v.key)}
            aria-current={view === v.key ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              view === v.key ? "bg-brand-600 text-white" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <form key={JSON.stringify(sp)} className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        {view !== "abertos" && <input type="hidden" name="visao" value={view} />}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Buscar por número (#12) ou título" className="input pl-9" aria-label="Buscar tickets" />
        </div>
        <Select name="departamento" size="sm" className="w-56" aria-label="Departamento" defaultValue={dep ?? ""} submitOnChange
          options={departmentOptions({ all: "Todos os departamentos" })} />
        {view !== "meus" && view !== "sem_responsavel" && (
          <Select name="responsavel" size="sm" className="w-56" aria-label="Responsável" defaultValue={resp ?? ""} submitOnChange searchable
            options={[...peopleOptions((people.data ?? []).filter((p) => p.active || p.id === resp), { empty: "Todos os responsáveis" }), { value: "nenhum", label: "Sem responsável" }]} />
        )}
        {cat && <input type="hidden" name="categoria" value={cat} />}
        {from && <input type="hidden" name="de" value={from} />}
        {to && <input type="hidden" name="ate" value={to} />}
        <button className="btn-secondary">Filtrar</button>
      </form>

      {(cat || from || to) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Filtros do painel:</span>
          {cat && <Badge tone="blue">Tipo: {category.data?.name ?? "—"}</Badge>}
          {(from || to) && (
            <Badge tone="blue">
              {view === "encerrados" ? "Encerrados" : "Abertos"} {from && to ? `de ${f.date(from)} a ${f.date(to)}` : from ? `desde ${f.date(from)}` : `até ${f.date(to)}`}
            </Badge>
          )}
          <Link href={(() => { const p = new URLSearchParams(); if (view !== "abertos") p.set("visao", view); if (dep) p.set("departamento", dep); if (resp) p.set("responsavel", resp); const x = p.toString(); return x ? `/tickets?${x}` : "/tickets"; })()}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink"><X className="h-3.5 w-3.5" /> Limpar</Link>
        </div>
      )}

      {error ? (
        <p role="alert" className="card p-6 text-sm text-danger">Não foi possível carregar os tickets. Recarregue a página.</p>
      ) : !tickets?.length ? (
        <div className="card p-10 text-center">
          <p className="font-semibold">Nenhum ticket nesta visão.</p>
          <p className="mt-1 text-sm text-muted">
            {view === "atrasados" ? "Ótimo: nada atrasado." : "Registre cada pedido de cliente como ticket para não perder prazos."}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Cliente</th>
                <th>Departamento</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const sla = slaState(t);
                return (
                  <tr key={t.id}>
                    <td className="max-w-xs">
                      <Link href={`/tickets/${t.id}`} className="link">
                        <span className="mr-1 text-muted tabular-nums">{ticketNumber(t.number)}</span>
                        {t.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted">
                        {t.category?.name} · <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                      </p>
                    </td>
                    <td>{t.client ? <Link href={`/clientes/${t.client.id}`} className="hover:underline">{t.client.legal_name}</Link> : "—"}</td>
                    <td>{DEPARTMENT_LABEL[t.department]}</td>
                    <td>{t.assignee?.full_name ?? <span className="text-warn">Sem responsável</span>}</td>
                    <td className="whitespace-nowrap">
                      <Badge tone={sla.tone}>{sla.label}</Badge>
                      <p className="mt-0.5 text-xs text-muted" title={f.dateTime(t.resolution_due_at)}>
                        {view === "encerrados" ? f.dateTime(t.closed_at) : `${f.dateTime(t.resolution_due_at)} (${relativeTime(t.resolution_due_at)})`}
                      </p>
                    </td>
                    <td><Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(count ?? 0) > 100 && <p className="p-3 text-xs text-muted">Mostrando 100 de {count}. Use os filtros para refinar.</p>}
        </div>
      )}
    </>
  );
}
