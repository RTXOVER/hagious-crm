import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS } from "@/lib/labels";
import { addDays, daysBetween, dueState, formatDate, stageLabel, todaySP } from "@/lib/documents";
import { formatDateTime } from "@/lib/tickets";
import { setDocStatusAction } from "./actions";
import { QuickReceive } from "./doc-forms";

export const metadata: Metadata = { title: "Documentos" };

const VIEWS = [
  { key: "pendentes", label: "Pendentes" },
  { key: "semana", label: "Vencem em 7 dias" },
  { key: "criticos", label: "Atrasados (crítico)" },
  { key: "recebidos", label: "Recebidos" },
  { key: "todos", label: "Todos" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function DocumentsPage(props: PageProps<"/documentos">) {
  const sp = await props.searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.visao) ? (sp.visao as View) : "pendentes";
  const dep = OPERATIONAL_DEPARTMENTS.find((d) => d === sp.departamento);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const today = todaySP();
  const supabase = await createClient();

  let query = supabase
    .from("client_documents")
    .select("id, title, status, department, due_date, received_at, responsible_id, requirement_id, client:clients!inner(id, legal_name, status)", { count: "exact" })
    .limit(200);
  if (view === "pendentes") query = query.eq("status", "pendente").order("due_date");
  if (view === "semana") query = query.eq("status", "pendente").gte("due_date", today).lte("due_date", addDays(today, 7)).order("due_date");
  if (view === "criticos") query = query.eq("status", "pendente").lt("due_date", today).order("due_date");
  if (view === "recebidos") query = query.eq("status", "recebido").order("received_at", { ascending: false });
  if (view === "todos") query = query.order("due_date", { ascending: false });
  if (dep) query = query.eq("department", dep);
  if (q) query = query.ilike("client.legal_name", `%${q.replace(/[,()*%\\:"]/g, " ").trim()}%`);

  const pendingCount = (f: (x: ReturnType<typeof base>) => ReturnType<typeof base>) => f(base());
  function base() {
    let b = supabase.from("client_documents").select("id", { count: "exact", head: true }).eq("status", "pendente");
    if (dep) b = b.eq("department", dep);
    return b;
  }

  const [profile, { data: docs, count, error }, people, cPending, cWeek, cLate] = await Promise.all([
    requireProfile(),
    query,
    supabase.from("profiles").select("id, full_name"),
    pendingCount((b) => b),
    pendingCount((b) => b.gte("due_date", today).lte("due_date", addDays(today, 7))),
    pendingCount((b) => b.lt("due_date", today)),
  ]);
  const ids = (docs ?? []).map((d) => d.id);
  const { data: rem } = ids.length
    ? await supabase.from("document_reminders").select("document_id, days_before, sent_at").in("document_id", ids).eq("channel", "interno").eq("status", "enviado")
    : { data: [] };
  const lastReminder = new Map<string, { days_before: number; sent_at: string | null }>();
  for (const r of rem ?? []) {
    const cur = lastReminder.get(r.document_id);
    if (!cur || (r.sent_at ?? "") > (cur.sent_at ?? "")) lastReminder.set(r.document_id, r);
  }
  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const counts: Partial<Record<View, number | null>> = { pendentes: cPending.count, semana: cWeek.count, criticos: cLate.count };

  // Relatório crítico: clientes com documentos vencidos
  const byClient = new Map<string, { id: string; name: string; count: number; oldest: number }>();
  if (view === "criticos") {
    for (const d of docs ?? []) {
      const late = daysBetween(d.due_date, today);
      const cur = byClient.get(d.client.id) ?? { id: d.client.id, name: d.client.legal_name, count: 0, oldest: 0 };
      cur.count++;
      cur.oldest = Math.max(cur.oldest, late);
      byClient.set(d.client.id, cur);
    }
  }
  const critical = [...byClient.values()].sort((a, b) => b.count - a.count || b.oldest - a.oldest);

  const href = (v: View) => {
    const p = new URLSearchParams();
    if (v !== "pendentes") p.set("visao", v);
    if (dep) p.set("departamento", dep);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/documentos?${s}` : "/documentos";
  };

  return (
    <>
      <PageHeader
        title="Documentos"
        description="Cobrança preventiva: o que cada cliente precisa entregar, quando vence e o que já foi lembrado."
        actions={<Link href="/documentos/novo" className="btn-primary"><Plus className="h-4 w-4" /> Nova pendência</Link>}
      />

      <nav className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Visões">
        {VIEWS.map((v) => {
          const n = counts[v.key];
          return (
            <Link key={v.key} href={href(v.key)} aria-current={view === v.key ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${view === v.key ? "bg-brand-600 text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
              {v.label}
              {typeof n === "number" && n > 0 && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${view === v.key ? "bg-white/25" : v.key === "criticos" ? "bg-danger-soft text-danger" : "bg-surface-2"}`}>{n}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <form className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        {view !== "pendentes" && <input type="hidden" name="visao" value={view} />}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Buscar pelo nome do cliente" className="input pl-9" aria-label="Buscar documentos por cliente" />
        </div>
        <select name="departamento" defaultValue={dep ?? ""} className="input w-auto" aria-label="Departamento">
          <option value="">Todos os departamentos</option>
          {OPERATIONAL_DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>)}
        </select>
        <button className="btn-secondary">Filtrar</button>
      </form>

      {view === "criticos" && critical.length > 0 && (
        <section className="card mb-4 p-5" aria-labelledby="criticos-title">
          <h2 id="criticos-title" className="mb-1 flex items-center gap-2 text-lg font-extrabold">
            <AlertTriangle className="h-5 w-5 text-danger" /> Relatório crítico
          </h2>
          <p className="mb-4 text-sm text-muted">
            Documentos que passaram do vencimento sem entrega. A gestão é avisada automaticamente quando um documento entra nesta lista.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {critical.slice(0, 9).map((c) => (
              <Link key={c.id} href={`/clientes/${c.id}#documentos`} className="card-link flex items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="text-xs text-muted">mais antigo: {c.oldest} {c.oldest === 1 ? "dia" : "dias"} de atraso</span>
                </span>
                <Badge tone="red">{c.count} {c.count === 1 ? "documento" : "documentos"}</Badge>
              </Link>
            ))}
          </div>
        </section>
      )}

      {error ? (
        <p role="alert" className="card p-6 text-sm text-danger">Não foi possível carregar os documentos. Recarregue a página.</p>
      ) : !docs?.length ? (
        <div className="card p-10 text-center">
          <p className="font-semibold">Nenhum documento nesta visão.</p>
          <p className="mt-1 text-sm text-muted">
            {view === "criticos"
              ? "Ótimo: nenhum documento atrasado."
              : "Cadastre as exigências na página de cada cliente (seção Documentos) para gerar as pendências automaticamente."}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Vencimento</th>
                <th>Último lembrete</th>
                <th>Quem cobra</th>
                <th className="text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const st = dueState(d.status, d.due_date, today);
                const last = lastReminder.get(d.id);
                return (
                  <tr key={d.id}>
                    <td className="max-w-xs">
                      <Link href={`/documentos/${d.id}`} className="link">{d.title}</Link>
                      <p className="mt-0.5 text-xs text-muted">
                        {DEPARTMENT_LABEL[d.department]} · {d.requirement_id ? "recorrente" : "avulso"}
                      </p>
                    </td>
                    <td>
                      <Link href={`/clientes/${d.client.id}`} className="hover:underline">{d.client.legal_name}</Link>
                      {d.client.status !== "ativo" && <p className="text-xs text-warn">Cliente {d.client.status}: sem cobrança automática</p>}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="tabular-nums">{formatDate(d.due_date)}</span>
                      <p className="mt-0.5"><Badge tone={st.tone}>{st.label}</Badge></p>
                    </td>
                    <td className="text-xs text-muted">
                      {view === "recebidos" ? `Recebido ${formatDateTime(d.received_at)}` : last ? `${stageLabel(last.days_before)} · ${formatDateTime(last.sent_at)}` : "—"}
                    </td>
                    <td className="text-sm">{d.responsible_id ? nameOf.get(d.responsible_id) ?? "—" : <span className="text-muted">Responsável do cliente</span>}</td>
                    <td className="text-right">
                      {d.status === "pendente" && <QuickReceive action={setDocStatusAction.bind(null, d.id)} label={d.title} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(count ?? 0) > 200 && <p className="p-3 text-xs text-muted">Mostrando 200 de {count}. Use os filtros para refinar.</p>}
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        {profile.role === "colaborador" ? "Você vê os documentos dos clientes que atende. " : ""}
        Os lembretes são verificados a cada hora, dentro do expediente. Envio ao cliente pelo WhatsApp: Etapa 4.
      </p>
      {view === "todos" && <div className="mt-2"><Alert tone="info">“Todos” mostra os 200 vencimentos mais recentes.</Alert></div>}
    </>
  );
}
