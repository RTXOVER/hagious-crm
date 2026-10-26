import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MessageCircle, Plus } from "lucide-react";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import {
  CLIENT_STATUS_LABEL,
  CLIENT_STATUS_TONE,
  DEPARTMENT_LABEL,
  OPERATIONAL_DEPARTMENTS,
  TAX_REGIME_LABEL,
} from "@/lib/labels";
import { formatCnpj, formatPhone } from "@/lib/validation/cnpj";
import { isUuid } from "@/lib/validation/ids";
import {
  addServiceAction,
  deleteClientAction,
  deleteContactAction,
  endServiceAction,
  saveResponsiblesAction,
  setClientStatusAction,
} from "../actions";
import { DeleteClientButton, StatusControl } from "./client-admin-actions";
import { AddServiceForm, ConfirmButton, ResponsiblesForm } from "./detail-forms";

export const metadata: Metadata = { title: "Cliente" };

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});
const fmtDate = (d: string | null) => (d ? dateFmt.format(new Date(`${d}T12:00:00`)) : "—");

const TABLE_LABEL: Record<string, string> = {
  clients: "Cadastro",
  client_contacts: "Contato",
  client_services: "Serviço",
  client_responsibles: "Responsável",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "criado", UPDATE: "alterado", DELETE: "removido" };

export default async function ClientPage(props: PageProps<"/clientes/[id]">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  // Tudo em paralelo: cada consulta ao banco leva ~0,3 s. O histórico só retorna dados
  // para a gestão (regra do banco), então pode ser pedido sempre.
  const [profile, { data: client }, contacts, services, responsibles, people, history] = await Promise.all([
    requireProfile(),
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase.from("client_contacts").select("*").eq("client_id", id).order("is_primary", { ascending: false }).order("name"),
    supabase.from("client_services").select("*").eq("client_id", id).order("active", { ascending: false }).order("department"),
    supabase.from("client_responsibles").select("department, user_id").eq("client_id", id),
    supabase.from("profiles").select("id, full_name, department, active").order("full_name"),
    supabase
      .from("audit_log")
      .select("id, table_name, action, actor_id, created_at")
      .or(`record_id.eq.${id},new_data->>client_id.eq.${id},old_data->>client_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  // RLS: se a pessoa não tem acesso, o banco não devolve o registro -> 404
  if (!client) notFound();
  const manager = isManager(profile);

  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const currentResp = Object.fromEntries((responsibles.data ?? []).map((r) => [r.department, r.user_id]));
  const activePeople = (people.data ?? []).filter((p) => p.active);

  return (
    <>
      <PageHeader
        title={client.legal_name}
        description={[client.trade_name, formatCnpj(client.cnpj)].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link href="/clientes" className="btn-secondary">Voltar</Link>
            {profile.role === "admin" && (
              <DeleteClientButton
                clientName={client.legal_name}
                counts={{
                  contacts: contacts.data?.length ?? 0,
                  services: services.data?.length ?? 0,
                  responsibles: responsibles.data?.length ?? 0,
                }}
                action={deleteClientAction.bind(null, id)}
              />
            )}
            {manager && <Link href={`/clientes/${id}/editar`} className="btn-primary">Editar</Link>}
          </>
        }
      />

      {sp.criado === "1" && (
        <div className="mb-4"><Alert tone="ok">Cliente cadastrado. Agora adicione os serviços contratados e defina os responsáveis.</Alert></div>
      )}
      {typeof sp.aviso === "string" && (
        <div className="mb-4">
          <Alert tone="warn">
            O cliente foi salvo, mas não foi possível salvar:{" "}
            {sp.aviso
              .split(",")
              .map((a) => ({ contato: "o contato principal", servicos: "os serviços contratados", responsaveis: "os responsáveis" })[a])
              .filter(Boolean)
              .join(", ")}
            . Inclua abaixo.
          </Alert>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        {manager ? (
          <StatusControl current={client.status} action={setClientStatusAction.bind(null, id)} />
        ) : (
          <Badge tone={CLIENT_STATUS_TONE[client.status]}>{CLIENT_STATUS_LABEL[client.status]}</Badge>
        )}
        <Badge>{TAX_REGIME_LABEL[client.tax_regime]}</Badge>
        {client.is_demo && <Badge tone="blue">Registro fictício</Badge>}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="card p-6" aria-labelledby="dados">
            <h2 id="dados" className="mb-4 text-lg font-extrabold">Dados cadastrais</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item term="E-mail" value={client.email} />
              <Item term="Telefone" value={formatPhone(client.phone)} />
              <Item term="Cliente desde" value={fmtDate(client.client_since)} />
              <Item term="Endereço" value={client.address} />
            </dl>
            {client.notes && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">{client.notes}</div>
            )}
          </section>

          <section className="card p-6" aria-labelledby="contatos-title" id="contatos">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="contatos-title" className="flex items-center gap-2 text-lg font-extrabold">
                <MessageCircle className="h-5 w-5 text-link" /> Contatos e WhatsApp
              </h2>
              <Link href={`/clientes/${id}/contatos/novo`} className="btn-secondary">
                <Plus className="h-4 w-4" /> Adicionar contato
              </Link>
            </div>
            {!contacts.data?.length ? (
              <p className="text-sm text-muted">
                Nenhum contato cadastrado. Clique em “Adicionar contato” para informar nome e WhatsApp.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {contacts.data.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-semibold">
                        {c.name} {c.is_primary && <Badge tone="green">Principal</Badge>}
                      </p>
                      {c.job_title && <p className="text-muted">{c.job_title}</p>}
                      <p className="mt-1">
                        {[c.email, formatPhone(c.whatsapp)].filter(Boolean).join(" · ") || "Sem e-mail ou WhatsApp"}
                      </p>
                      {c.whatsapp && (
                        <p className="mt-1 text-xs">
                          {c.whatsapp_opt_in ? (
                            <span className="text-ok">
                              Autorizou mensagens por WhatsApp em {dateTimeFmt.format(new Date(c.whatsapp_opt_in_at!))}
                            </span>
                          ) : (
                            <span className="text-warn">Sem autorização registrada para mensagens automáticas</span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Link href={`/clientes/${id}/contatos/${c.id}`} className="link text-xs">
                        Editar
                      </Link>
                      {manager && (
                        <ConfirmButton
                          action={deleteContactAction.bind(null, id, c.id)}
                          label="Remover"
                          question={`Remover o contato ${c.name}?`}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-6" aria-labelledby="servicos">
            <h2 id="servicos" className="mb-4 text-lg font-extrabold">Serviços contratados</h2>
            {!services.data?.length ? (
              <p className="text-sm text-muted">Nenhum serviço cadastrado.</p>
            ) : (
              <ul className="divide-y divide-line">
                {services.data.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-semibold">
                        {s.description} <Badge tone={s.active ? "green" : "gray"}>{s.active ? "Ativo" : "Encerrado"}</Badge>
                      </p>
                      <p className="text-muted">
                        {DEPARTMENT_LABEL[s.department]} · início {fmtDate(s.started_on)}
                        {s.ended_on && ` · fim ${fmtDate(s.ended_on)}`}
                      </p>
                    </div>
                    {manager && s.active && (
                      <ConfirmButton
                        action={endServiceAction.bind(null, id, s.id)}
                        label="Encerrar"
                        question={`Encerrar o serviço "${s.description}"?`}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manager && <AddServiceForm action={addServiceAction.bind(null, id)} />}
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-6" aria-labelledby="responsaveis">
            <h2 id="responsaveis" className="mb-4 text-lg font-extrabold">Responsáveis internos</h2>
            {manager ? (
              <ResponsiblesForm action={saveResponsiblesAction.bind(null, id)} current={currentResp} people={activePeople} />
            ) : (
              <dl className="space-y-2 text-sm">
                {OPERATIONAL_DEPARTMENTS.map((d) => (
                  <Item key={d} term={DEPARTMENT_LABEL[d]} value={currentResp[d] ? nameOf.get(currentResp[d]) : null} />
                ))}
              </dl>
            )}
          </section>

          {manager && (
            <section className="card p-6" aria-labelledby="historico">
              <h2 id="historico" className="mb-4 text-lg font-extrabold">Histórico de alterações</h2>
              {!history.data?.length ? (
                <p className="text-sm text-muted">Sem registros.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {history.data.map((h) => (
                    <li key={h.id}>
                      <span className="font-semibold">{TABLE_LABEL[h.table_name] ?? h.table_name}</span>{" "}
                      {ACTION_LABEL[h.action] ?? h.action}
                      <span className="block text-xs text-muted">
                        {dateTimeFmt.format(new Date(h.created_at))} · {h.actor_id ? nameOf.get(h.actor_id) ?? "Usuário removido" : "Sistema"}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Item({ term, value }: { term: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted">{term}</dt>
      <dd className="mt-0.5">{value || "—"}</dd>
    </div>
  );
}
