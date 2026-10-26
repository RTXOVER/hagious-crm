import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge } from "@/components/page-header";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import {
  OPEN_STATUSES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  formatDateTime,
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
  { key: "encerrados", label: "Encerrados" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function TicketsPage(props: PageProps<"/tickets">) {
  const sp = await props.searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.visao) ? (sp.visao as View) : "abertos";
  const dep = OPERATIONAL_DEPARTMENTS.find((d) => d === sp.departamento);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
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
  } else {
    query = query.in("status", [...OPEN_STATUSES]).order("resolution_due_at", { ascending: true });
    if (view === "meus") query = query.eq("assignee_id", profile.id);
    // Atrasado / em risco: mesmas regras dos alertas (tickets pausados não contam)
    if (view === "atrasados") query = query.neq("status", "aguardando_cliente").lt("resolution_due_at", now);
    if (view === "risco") query = query.neq("status", "aguardando_cliente").lte("risk_at", now).gte("resolution_due_at", now);
  }
  if (dep) query = query.eq("department", dep);
  if (q) {
    const num = Number(q.replace(/^#/, ""));
    const safe = q.replace(/[,()*%\\:"]/g, " ").trim();
    query = Number.isInteger(num) && num > 0 ? query.eq("number", num) : query.ilike("title", `%${safe}%`);
  }

  const { data: tickets, count, error } = await query;
  const href = (v: View) => {
    const p = new URLSearchParams();
    if (v !== "abertos") p.set("visao", v);
    if (dep) p.set("departamento", dep);
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

      <form className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        {view !== "abertos" && <input type="hidden" name="visao" value={view} />}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Buscar por número (#12) ou título" className="input pl-9" aria-label="Buscar tickets" />
        </div>
        <select name="departamento" defaultValue={dep ?? ""} className="input w-auto" aria-label="Departamento">
          <option value="">Todos os departamentos</option>
          {OPERATIONAL_DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>)}
        </select>
        <button className="btn-secondary">Filtrar</button>
      </form>

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
                      <p className="mt-0.5 text-xs text-muted" title={formatDateTime(t.resolution_due_at)}>
                        {view === "encerrados" ? formatDateTime(t.closed_at) : `${formatDateTime(t.resolution_due_at)} (${relativeTime(t.resolution_due_at)})`}
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
