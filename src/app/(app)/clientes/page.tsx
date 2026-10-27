import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pencil, Plus, Search, X } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE, DEPARTMENT_LABEL, OPERATIONAL_DEPARTMENTS, TAX_REGIME_LABEL } from "@/lib/labels";
import { formatCnpj, normalizeCnpj } from "@/lib/validation/cnpj";
import { daysAgoIso } from "@/lib/dates";
import { deleteClientAction } from "./actions";
import { DeleteClientButton } from "./[id]/client-admin-actions";
import { Select } from "@/components/ui/select";
import { departmentOptions } from "@/components/ui/options";

export const metadata: Metadata = { title: "Clientes" };

const PAGE_SIZE = 50;
const STATUSES = ["ativo", "suspenso", "encerrado"] as const;
const STATUS_DOT = { ativo: "#1f8a6a", suspenso: "#c27a12", encerrado: "#9aaaa5" } as const;
const REGIMES = Object.keys(TAX_REGIME_LABEL) as (keyof typeof TAX_REGIME_LABEL)[];

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function ClientsPage(props: PageProps<"/clientes">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = pick(sp.status, STATUSES);
  const regime = pick(sp.regime, REGIMES);
  const departamento = pick(sp.departamento, OPERATIONAL_DEPARTMENTS);
  const novos = sp.novos === "30";
  const page = Math.max(1, Number(sp.pagina) || 1);

  const supabase = await createClient();
  // Filtro por departamento: só clientes com serviço ativo daquele departamento (junção interna)
  const select = departamento
    ? "id, legal_name, trade_name, cnpj, tax_regime, status, is_demo, client_services!inner(department, active)"
    : "id, legal_name, trade_name, cnpj, tax_regime, status, is_demo";
  let query = supabase
    .from("clients")
    .select(select, { count: "exact" })
    .order("legal_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);
  if (regime) query = query.eq("tax_regime", regime);
  if (departamento) query = query.eq("client_services.department", departamento).eq("client_services.active", true);
  if (novos) query = query.gte("created_at", daysAgoIso(30));
  if (q) {
    // Remove caracteres com significado especial no filtro do PostgREST
    const safe = q.replace(/[,()*%\\:"]/g, " ").trim();
    const code = normalizeCnpj(q); // CNPJ numérico ou alfanumérico, sem pontuação
    const filters = [`legal_name.ilike.%${safe}%`, `trade_name.ilike.%${safe}%`];
    if (code.length >= 3 && /\d/.test(code)) filters.push(`cnpj.like.%${code}%`);
    if (safe) query = query.or(filters.join(","));
  }

  // Perfil e lista em paralelo
  const [profile, result] = await Promise.all([requireProfile(), query]);
  const { count, error } = result;
  // Página além da última (ex.: depois de filtrar): volta para a primeira em vez de mostrar erro
  if (error?.code === "PGRST103" && page > 1) {
    const back = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "pagina" && typeof v === "string") as [string, string][]);
    redirect(back.toString() ? `/clientes?${back}` : "/clientes");
  }
  // Editar o cadastro é permitido a gestores e administradores (o banco também impõe essa regra)
  const canEdit = isManager(profile);
  // Excluir: somente administradores
  const isAdminUser = profile.role === "admin";
  const clients = (result.data ?? []) as unknown as {
    id: string; legal_name: string; trade_name: string | null; cnpj: string;
    tax_regime: keyof typeof TAX_REGIME_LABEL; status: (typeof STATUSES)[number]; is_demo: boolean;
  }[];

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const params = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base = { q: q || undefined, status, regime, departamento, novos: novos ? "30" : undefined, ...overrides };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/clientes?${s}` : "/clientes";
  };
  const activeFilters = [
    regime && { label: `Regime: ${TAX_REGIME_LABEL[regime]}`, href: params({ regime: undefined, pagina: undefined }) },
    departamento && { label: `Departamento: ${DEPARTMENT_LABEL[departamento]}`, href: params({ departamento: undefined }) },
    novos && { label: "Cadastrados nos últimos 30 dias", href: params({ novos: undefined }) },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <>
      <PageHeader
        title="Clientes"
        description={`${count ?? 0} cliente(s) encontrados`}
        actions={
          isManager(profile) && (
            <Link href="/clientes/novo" className="btn-primary"><Plus className="h-4 w-4" /> Novo cliente</Link>
          )
        }
      />

      <form key={JSON.stringify(sp)} className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Buscar por razão social, nome fantasia ou CNPJ" className="input pl-9" aria-label="Buscar clientes" />
        </div>
        <Select name="status" size="sm" className="w-52" aria-label="Situação" defaultValue={status ?? ""} submitOnChange
          options={[{ value: "", label: "Todas as situações", dot: "#9aaaa5" }, ...STATUSES.map((s) => ({ value: s, label: CLIENT_STATUS_LABEL[s], dot: STATUS_DOT[s] }))]} />
        <Select name="regime" size="sm" className="w-52" aria-label="Regime" defaultValue={regime ?? ""} submitOnChange
          options={[{ value: "", label: "Todos os regimes" }, ...REGIMES.map((r) => ({ value: r, label: TAX_REGIME_LABEL[r] }))]} />
        <Select name="departamento" size="sm" className="w-56" aria-label="Departamento" defaultValue={departamento ?? ""} submitOnChange
          options={departmentOptions({ all: "Todos os departamentos" })} />
        {novos && <input type="hidden" name="novos" value="30" />}
        <button className="btn-secondary" type="submit">Filtrar</button>
      </form>

      {sp.excluido === "1" && (
        <div className="mb-4"><Alert tone="ok">Cliente excluído. O registro da exclusão ficou no histórico de alterações.</Alert></div>
      )}

      {activeFilters.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {activeFilters.map((f) => (
            <Link key={f.label} href={f.href} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-link transition hover:bg-brand-100">
              {f.label} <X className="h-3 w-3" />
            </Link>
          ))}
        </div>
      )}

      {error ? (
        <p role="alert" className="card p-6 text-sm text-danger">Não foi possível carregar os clientes. Recarregue a página.</p>
      ) : !clients.length ? (
        <div className="card p-10 text-center">
          <p className="font-semibold">Nenhum cliente encontrado.</p>
          <p className="mt-1 text-sm text-muted">
            {q || status || regime || departamento || novos
              ? "Ajuste a busca ou os filtros."
              : isManager(profile) ? "Cadastre o primeiro cliente." : "Você ainda não está vinculado a nenhum cliente."}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Cliente</th><th>CNPJ</th><th>Regime</th><th>Situação</th>
                {canEdit && <th className="text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clientes/${c.id}`} className="link">{c.legal_name}</Link>
                    {c.trade_name && <p className="text-xs text-muted">{c.trade_name}</p>}
                    {c.is_demo && <Badge tone="blue">Fictício</Badge>}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{formatCnpj(c.cnpj)}</td>
                  <td>{TAX_REGIME_LABEL[c.tax_regime]}</td>
                  <td><Badge tone={CLIENT_STATUS_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</Badge></td>
                  {canEdit && (
                    <td>
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/clientes/${c.id}/editar`}
                          className="btn-secondary px-3 py-1.5 text-xs"
                          aria-label={`Editar ${c.legal_name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Link>
                        {isAdminUser && (
                          <DeleteClientButton compact clientName={c.legal_name} action={deleteClientAction.bind(null, c.id)} />
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Paginação">
          {page > 1 && <Link className="btn-secondary" href={params({ pagina: String(page - 1) })}>Anterior</Link>}
          <span className="text-muted">Página {page} de {totalPages}</span>
          {page < totalPages && <Link className="btn-secondary" href={params({ pagina: String(page + 1) })}>Próxima</Link>}
        </nav>
      )}
    </>
  );
}
