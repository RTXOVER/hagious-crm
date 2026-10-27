import type { Metadata } from "next";
import { getFormatter } from "@/lib/preferences-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FileClock, Mail, MessageCircle, MessagesSquare, Plus, Ticket } from "lucide-react";
import { DOC_STATUS_LABEL, describeRule, dueState, todaySP } from "@/lib/documents";
import { deleteRequirementAction, saveRequirementAction, setDocStatusAction, toggleRequirementAction } from "../../documentos/actions";
import { QuickReceive, RequirementForm } from "../../documentos/doc-forms";
import { OPEN_STATUSES, STATUS_LABEL as TICKET_STATUS_LABEL, STATUS_TONE as TICKET_STATUS_TONE, slaState, ticketNumber } from "@/lib/tickets";
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


const TABLE_LABEL: Record<string, string> = {
  clients: "Cadastro",
  client_contacts: "Contato",
  client_services: "Serviço",
  client_responsibles: "Responsável",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "criado", UPDATE: "alterado", DELETE: "removido" };

export default async function ClientPage(props: PageProps<"/clientes/[id]">) {
  const f = await getFormatter();
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  // Tudo em paralelo: cada consulta ao banco leva ~0,3 s. O histórico só retorna dados
  // para a gestão (regra do banco), então pode ser pedido sempre.
  const [profile, { data: client }, contacts, services, responsibles, people, history, tickets, requirements, docs, docTypes, saves, convs, doneDocs] = await Promise.all([
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
    // Situação operacional: tickets do cliente (os abertos primeiro)
    supabase
      .from("tickets")
      .select("id, number, title, status, department, resolution_due_at, risk_at, resolved_at, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    // Documentos: exigências e pendências
    supabase
      .from("document_requirements")
      .select("*, type:document_types(name)")
      .eq("client_id", id)
      .order("active", { ascending: false })
      .order("created_at"),
    supabase
      .from("client_documents")
      .select("id, title, status, department, due_date, received_at")
      .eq("client_id", id)
      .eq("status", "pendente") // todas as pendências (antes, clientes com muito histórico perdiam as atuais)
      .order("due_date", { ascending: true })
      .limit(200),
    supabase.from("document_types").select("id, name, department, default_periodicity, default_due_day, description").eq("active", true).order("name"),
    // Conversas: mensagens salvas no cliente e conversas ligadas a ele
    supabase.from("message_saves").select("*").eq("client_id", id).order("sent_at", { ascending: false }).limit(30),
    supabase.from("conversations").select("id, kind, contact_name, contact_address, last_message_at, unread_count").eq("client_id", id).order("last_message_at", { ascending: false }).limit(10),
    // Encerrados mais recentes (recebidos/dispensados), à parte das pendências
    supabase.from("client_documents").select("id, title, status, due_date").eq("client_id", id).neq("status", "pendente").order("due_date", { ascending: false }).limit(5),
  ]);
  // RLS: se a pessoa não tem acesso, o banco não devolve o registro -> 404
  if (!client) notFound();
  const manager = isManager(profile);

  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const currentResp = Object.fromEntries((responsibles.data ?? []).map((r) => [r.department, r.user_id]));
  const activePeople = (people.data ?? []).filter((p) => p.active);
  const today = todaySP();
  // Exigências: gestão ou o próprio departamento (mesma regra do banco)
  const canEditDep = (dep: string) => manager || profile.department === dep;
  const usableTypes = (docTypes.data ?? []).filter(
    (t) => t.department !== "atendimento" && canEditDep(t.department),
  ) as Parameters<typeof RequirementForm>[0]["types"];
  const openDocs = docs.data ?? [];
  const lateCount = openDocs.filter((d) => d.due_date < today).length;
  const recentDone = doneDocs.data ?? [];

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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="card p-6" aria-labelledby="tickets-cliente">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="tickets-cliente" className="flex items-center gap-2 text-lg font-extrabold">
                <Ticket className="h-5 w-5 text-link" /> Tickets
              </h2>
              <Link href={`/tickets/novo?cliente=${id}`} className="btn-secondary"><Plus className="h-4 w-4" /> Novo ticket</Link>
            </div>
            {!tickets.data?.length ? (
              <p className="text-sm text-muted">Nenhuma solicitação registrada para este cliente.</p>
            ) : (
              <ul className="divide-y divide-line">
                {[...tickets.data]
                  .sort((a, b) => Number(OPEN_STATUSES.includes(b.status as never)) - Number(OPEN_STATUSES.includes(a.status as never)))
                  .map((tk) => {
                    const st = slaState(tk);
                    return (
                      <li key={tk.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <Link href={`/tickets/${tk.id}`} className="link">
                          <span className="mr-1 text-muted tabular-nums">{ticketNumber(tk.number)}</span>{tk.title}
                        </Link>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge>{DEPARTMENT_LABEL[tk.department]}</Badge>
                          <Badge tone={TICKET_STATUS_TONE[tk.status]}>{TICKET_STATUS_LABEL[tk.status]}</Badge>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>

          <section className="card scroll-mt-24 p-6" aria-labelledby="documentos-title" id="documentos">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="documentos-title" className="flex items-center gap-2 text-lg font-extrabold">
                <FileClock className="h-5 w-5 text-link" /> Documentos
                {lateCount > 0 && <Badge tone="red">{lateCount} atrasado(s)</Badge>}
                {openDocs.length - lateCount > 0 && <Badge tone="blue">{openDocs.length - lateCount} pendente(s)</Badge>}
              </h2>
              <Link href={`/documentos/novo?cliente=${id}`} className="btn-secondary"><Plus className="h-4 w-4" /> Pendência avulsa</Link>
            </div>

            {openDocs.length > 0 ? (
              <ul className="mb-5 divide-y divide-line rounded-xl border border-line">
                {openDocs.slice(0, 10).map((d) => {
                  const st = dueState(d.status, d.due_date, today);
                  return (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <span>
                        <Link href={`/documentos/${d.id}`} className="link">{d.title}</Link>
                        <span className="ml-2 text-xs text-muted tabular-nums">vence {f.date(d.due_date)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <QuickReceive action={setDocStatusAction.bind(null, d.id)} label={d.title} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mb-5 text-sm text-muted">Nenhum documento pendente.</p>
            )}
            {recentDone.length > 0 && (
              <p className="-mt-3 mb-5 text-xs text-muted">
                Recentes: {recentDone.map((d) => `${d.title} (${f.date(d.due_date)}): ${DOC_STATUS_LABEL[d.status].toLowerCase()}`).join(" · ")}
              </p>
            )}

            <h3 className="mb-2 text-sm font-bold">O que o cliente entrega com frequência</h3>
            {!requirements.data?.length ? (
              <p className="text-sm text-muted">Nenhuma exigência cadastrada. Cadastre abaixo e as pendências serão criadas sozinhas, com lembretes.</p>
            ) : (
              <ul className="divide-y divide-line">
                {requirements.data.map((r) => (
                  <li key={r.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {r.type?.name} <Badge>{DEPARTMENT_LABEL[r.department]}</Badge>{" "}
                          {!r.active && <Badge tone="gray">Pausada</Badge>}
                        </p>
                        <p className="text-muted">
                          {describeRule(r.periodicity, r.due_day, r.first_month)}
                          {r.responsible_id && ` · cobra: ${nameOf.get(r.responsible_id) ?? "—"}`}
                          {r.ends_on && ` · até ${f.date(r.ends_on)}`}
                        </p>
                        {r.notes && <p className="text-xs text-muted">{r.notes}</p>}
                      </div>
                      {canEditDep(r.department) && (
                        <div className="flex items-center gap-3">
                          <details className="relative">
                            <summary className="link cursor-pointer list-none text-xs">Editar</summary>
                            <div className="absolute right-0 z-10 mt-2 w-[min(40rem,calc(100vw-3rem))] rounded-2xl border border-line bg-surface p-5 shadow-(--shadow-lift)">
                              <RequirementForm
                                action={saveRequirementAction.bind(null, id, r.id)}
                                types={[{
                                  id: r.document_type_id,
                                  name: r.type?.name ?? "",
                                  department: r.department as "contabil" | "fiscal" | "dp",
                                  default_periodicity: r.periodicity,
                                  default_due_day: r.due_day,
                                }]}
                                people={activePeople}
                                initial={r}
                                today={today}
                                submitLabel="Salvar exigência"
                              />
                            </div>
                          </details>
                          <ConfirmButton
                            action={toggleRequirementAction.bind(null, id, r.id, !r.active)}
                            label={r.active ? "Pausar" : "Reativar"}
                            question={r.active ? `Pausar "${r.type?.name}"? As próximas pendências deixam de ser exigidas.` : `Reativar "${r.type?.name}"?`}
                          />
                          <ConfirmButton
                            action={deleteRequirementAction.bind(null, id, r.id)}
                            label="Remover"
                            question={`Remover a exigência "${r.type?.name}"? O histórico de recebimentos é mantido.`}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {client.status === "ativo" && usableTypes.length > 0 && (
              <details className="mt-4 rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-bold text-link">+ Adicionar exigência</summary>
                <div className="mt-4">
                  <RequirementForm action={saveRequirementAction.bind(null, id, null)} types={usableTypes} people={activePeople} today={today} submitLabel="Criar exigência" />
                </div>
              </details>
            )}
          </section>

          <section className="card scroll-mt-24 p-6" aria-labelledby="mensagens-title" id="mensagens">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="mensagens-title" className="flex items-center gap-2 text-lg font-extrabold">
                <MessagesSquare className="h-5 w-5 text-link" /> Mensagens e conversas
              </h2>
              <Link href="/conversas" className="btn-secondary"><MessagesSquare className="h-4 w-4" /> Abrir Conversas</Link>
            </div>
            {(convs.data ?? []).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {(convs.data ?? []).map((c) => (
                  <Link key={c.id} href={`/conversas?c=${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-semibold transition hover:border-brand-500">
                    {c.kind === "whatsapp" ? <MessageCircle className="h-3.5 w-3.5 text-[#1f8a5f]" /> : <Mail className="h-3.5 w-3.5 text-info" />}
                    {c.contact_name || c.contact_address}
                    {c.unread_count > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-[10px] text-white">{c.unread_count}</span>}
                  </Link>
                ))}
              </div>
            )}
            {!saves.data?.length ? (
              <p className="text-sm text-muted">
                Nenhuma mensagem salva. Em Conversas, use “Salvar no cliente” numa mensagem do WhatsApp ou e-mail para guardá-la aqui.
              </p>
            ) : (
              <ul className="space-y-3">
                {saves.data.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      {s.channel === "whatsapp" ? <MessageCircle className="h-3.5 w-3.5 text-[#1f8a5f]" /> : <Mail className="h-3.5 w-3.5 text-info" />}
                      <span className="font-semibold text-ink">{s.direction === "entrada" ? s.sender : `Hagious → cliente`}</span>
                      <span>{f.dateTime(s.sent_at)}</span>
                      <span>· salva por {s.saved_by ? nameOf.get(s.saved_by) ?? "—" : "—"}</span>
                    </p>
                    {s.subject && <p className="mt-1 font-semibold">{s.subject}</p>}
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap">{s.body}</p>
                    {s.note && <p className="mt-2 rounded-lg bg-surface-2 px-2 py-1 text-xs"><strong>Obs.:</strong> {s.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-6" aria-labelledby="dados">
            <h2 id="dados" className="mb-4 text-lg font-extrabold">Dados cadastrais</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item term="E-mail" value={client.email} />
              <Item term="Telefone" value={formatPhone(client.phone)} />
              <Item term="Cliente desde" value={f.date(client.client_since)} />
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
                              Autorizou mensagens por WhatsApp em {f.dateTime(c.whatsapp_opt_in_at!)}
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
                        {DEPARTMENT_LABEL[s.department]} · início {f.date(s.started_on)}
                        {s.ended_on && ` · fim ${f.date(s.ended_on)}`}
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
                        {f.dateTime(h.created_at)} · {h.actor_id ? nameOf.get(h.actor_id) ?? "Usuário removido" : "Sistema"}
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
