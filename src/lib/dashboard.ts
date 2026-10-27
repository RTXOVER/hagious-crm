import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { OPERATIONAL_DEPARTMENTS } from "@/lib/labels";

type DB = SupabaseClient<Database>;
type Dep = Database["public"]["Enums"]["department"];
type Regime = Database["public"]["Enums"]["tax_regime"];

const PAGE = 1000; // limite padrão de linhas por consulta no Supabase

/** Busca todas as linhas em páginas de 1000 (o Supabase corta respostas maiores). */
async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * Indicadores de tickets (respeitam as permissões de quem vê).
 * - Abertos: situação aberto, em andamento ou aguardando cliente.
 * - Em risco / atrasados: mesmos critérios dos alertas automáticos; tickets pausados não contam.
 * - Cumprimento do prazo (30 dias): concluídos nos últimos 30 dias resolvidos até o prazo / total concluído.
 * Retorna null se a estrutura de tickets ainda não existir no banco.
 */
export async function loadTicketStats(supabase: DB) {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const open = ["aberto", "em_andamento", "aguardando_cliente"] as const;
  const count = (q: PromiseLike<{ count: number | null; error: unknown }>) => q;
  const base = () => supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", [...open]);

  const [all, late, risk, unassigned, closed] = await Promise.all([
    count(base()),
    count(base().neq("status", "aguardando_cliente").lt("resolution_due_at", now)),
    count(base().neq("status", "aguardando_cliente").lte("risk_at", now).gte("resolution_due_at", now)),
    count(base().is("assignee_id", null)),
    supabase.from("tickets").select("resolved_at, resolution_due_at").eq("status", "concluido").gte("resolved_at", since).limit(5000),
  ]);
  if (all.error) return null;
  const done = closed.data ?? [];
  // Mesma regra da tela do ticket (slaState): sem prazo calculado conta como cumprido
  const onTime = done.filter((t) => !t.resolution_due_at || (!!t.resolved_at && Date.parse(t.resolved_at) <= Date.parse(t.resolution_due_at))).length;
  return {
    open: all.count ?? 0,
    late: late.count ?? 0,
    risk: risk.count ?? 0,
    unassigned: unassigned.count ?? 0,
    closed30: done.length,
    onTime30: onTime,
  };
}

/**
 * Indicadores de documentos (respeitam as permissões de quem vê).
 * - Pendentes: situação "pendente".
 * - Vencem em 7 dias: pendentes com vencimento de hoje até 7 dias.
 * - Atrasados: pendentes com vencimento antes de hoje (relatório crítico).
 * - Clientes críticos: clientes com ao menos um documento atrasado.
 * "Hoje" é a data no fuso de Brasília. Retorna null se a estrutura ainda não existir no banco.
 */
export async function loadDocumentStats(supabase: DB, today: string, in7: string) {
  const base = () => supabase.from("client_documents").select("id", { count: "exact", head: true }).eq("status", "pendente");
  const [all, week, late] = await Promise.all([
    base(),
    base().gte("due_date", today).lte("due_date", in7),
    supabase.from("client_documents").select("client_id, client:clients(legal_name)").eq("status", "pendente").lt("due_date", today).limit(5000),
  ]);
  if (all.error) return null;
  const byClient = new Map<string, { id: string; name: string; count: number }>();
  for (const d of late.data ?? []) {
    const cur = byClient.get(d.client_id) ?? { id: d.client_id, name: d.client?.legal_name ?? "Cliente", count: 0 };
    cur.count++;
    byClient.set(d.client_id, cur);
  }
  return {
    pending: all.count ?? 0,
    week: week.count ?? 0,
    late: late.data?.length ?? 0,
    critical: [...byClient.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export type AttentionItem = { id: string; name: string; issues: string[] };

/**
 * Indicadores do painel. Como a consulta usa a sessão do usuário,
 * as regras de acesso (RLS) valem: cada pessoa vê apenas os números dos clientes que pode acessar.
 *
 * Como cada número é calculado:
 * - Clientes ativos: clientes com situação "ativo".
 * - Novos (30 dias): clientes cadastrados no sistema nos últimos 30 dias (data de criação do registro).
 * - WhatsApp autorizado: contatos com WhatsApp e autorização registrada / contatos com WhatsApp.
 * - Cadastro completo: clientes ativos sem nenhuma pendência da lista "Precisa de atenção".
 * - Por departamento: clientes ativos com ao menos um serviço ativo daquele departamento.
 * - Por responsável: clientes ativos em que a pessoa é responsável em algum departamento.
 */
export async function loadDashboard(supabase: DB) {
  const [clients, services, responsibles, contacts, people] = await Promise.all([
    fetchAll((a, b) =>
      supabase.from("clients").select("id, legal_name, status, tax_regime, created_at").order("id").range(a, b),
    ),
    fetchAll((a, b) =>
      supabase.from("client_services").select("client_id, department").eq("active", true).order("id").range(a, b),
    ),
    fetchAll((a, b) =>
      supabase.from("client_responsibles").select("client_id, department, user_id").order("client_id").order("department").range(a, b),
    ),
    fetchAll((a, b) =>
      supabase.from("client_contacts").select("client_id, whatsapp, whatsapp_opt_in, is_primary").order("id").range(a, b),
    ),
    supabase.from("profiles").select("id, full_name, active"),
  ]);

  const active = clients.filter((c) => c.status === "ativo");
  const activeIds = new Set(active.map((c) => c.id));

  // --- Departamentos e serviços ---
  const depsByClient = new Map<string, Set<Dep>>();
  for (const s of services) {
    if (!depsByClient.has(s.client_id)) depsByClient.set(s.client_id, new Set());
    depsByClient.get(s.client_id)!.add(s.department);
  }
  const byDepartment = OPERATIONAL_DEPARTMENTS.map((d) => ({
    key: d,
    value: active.filter((c) => depsByClient.get(c.id)?.has(d)).length,
  }));

  // --- Regime tributário ---
  const regimeOrder: Regime[] = ["mei", "simples_nacional", "lucro_presumido", "lucro_real", "outro"];
  const byRegime = regimeOrder.map((r) => ({ key: r, value: active.filter((c) => c.tax_regime === r).length }));

  // --- Novos clientes por mês (últimos 6 meses, fuso de Brasília) ---
  const monthKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  // Mês atual pela data de Brasília (não pelo relógio do servidor, que pode estar em UTC)
  const [spYear, spMonth] = monthKey(new Date()).split("-").map(Number);
  const months: { key: string; label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(spYear, spMonth - 1 - i, 15, 12));
    months.push({
      key: monthKey(d),
      label: d.toLocaleDateString("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).replace(".", ""),
      value: 0,
    });
  }
  for (const c of clients) {
    const m = months.find((x) => x.key === monthKey(new Date(c.created_at)));
    if (m) m.value++;
  }
  const since30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const new30 = clients.filter((c) => new Date(c.created_at).getTime() >= since30).length;

  // --- Contatos e WhatsApp ---
  const withWhats = contacts.filter((c) => c.whatsapp);
  const optIn = withWhats.filter((c) => c.whatsapp_opt_in).length;
  const contactsByClient = new Map<string, typeof contacts>();
  for (const c of contacts) {
    if (!contactsByClient.has(c.client_id)) contactsByClient.set(c.client_id, []);
    contactsByClient.get(c.client_id)!.push(c);
  }

  // --- Responsáveis ---
  const respByClient = new Map<string, Set<Dep>>();
  const loadByUser = new Map<string, Set<string>>();
  for (const r of responsibles) {
    if (!respByClient.has(r.client_id)) respByClient.set(r.client_id, new Set());
    respByClient.get(r.client_id)!.add(r.department);
    if (activeIds.has(r.client_id)) {
      if (!loadByUser.has(r.user_id)) loadByUser.set(r.user_id, new Set());
      loadByUser.get(r.user_id)!.add(r.client_id);
    }
  }
  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const byResponsible = [...loadByUser.entries()]
    .map(([id, set]) => ({ key: id, label: nameOf.get(id) ?? "Usuário", value: set.size }))
    .sort((a, b) => b.value - a.value);

  // --- Pendências de cadastro (somente clientes ativos) ---
  const attention: AttentionItem[] = [];
  for (const c of active) {
    const issues: string[] = [];
    const deps = depsByClient.get(c.id);
    const resp = respByClient.get(c.id);
    const cts = contactsByClient.get(c.id) ?? [];
    if (!deps?.size) issues.push("Sem serviço ativo");
    else if ([...deps].some((d) => !resp?.has(d))) issues.push("Departamento sem responsável");
    if (!cts.some((x) => x.is_primary)) issues.push("Sem contato principal");
    if (!cts.some((x) => x.whatsapp && x.whatsapp_opt_in)) issues.push("Sem WhatsApp autorizado");
    if (issues.length) attention.push({ id: c.id, name: c.legal_name, issues });
  }
  attention.sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));

  return {
    totals: {
      clients: clients.length,
      active: active.length,
      suspended: clients.filter((c) => c.status === "suspenso").length,
      new30,
      contactsWithWhatsapp: withWhats.length,
      whatsappOptIn: optIn,
      complete: active.length - attention.length,
    },
    byDepartment,
    byRegime,
    months,
    byResponsible,
    attention,
    clientNames: new Map(clients.map((c) => [c.id, c.legal_name])),
    peopleNames: nameOf,
  };
}
