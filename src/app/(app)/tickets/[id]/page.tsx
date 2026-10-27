import type { Metadata } from "next";
import { getFormatter } from "@/lib/preferences-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightLeft, Building2, Clock, History, PauseCircle, Tag, UserRound } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { DEPARTMENT_LABEL } from "@/lib/labels";
import { isUuid } from "@/lib/validation/ids";
import {
  ORIGIN_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  formatSla,
  relativeTime,
  firstResponseLate,
  slaState,
  ticketNumber,
} from "@/lib/tickets";
import { assignAction, commentAction, forwardAction, setStatusAction, takeTicketAction, updatePriorityAction } from "../actions";
import { AssignPanel, CommentBox, ForwardPanel, PriorityControl, StatusPanel, TakeButton } from "./ticket-panels";

export const metadata: Metadata = { title: "Ticket" };

type EventData = { from?: string; to?: string; assignee?: string | null };

export default async function TicketPage(props: PageProps<"/tickets/[id]">) {
  const f = await getFormatter();
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [profile, { data: t }, { data: events }, { data: people }, { data: categories }] = await Promise.all([
    requireProfile(),
    supabase
      .from("tickets")
      .select("*, client:clients(id, legal_name, cnpj), category:ticket_categories(name, resolution_value, resolution_unit)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("ticket_events").select("*").eq("ticket_id", id).order("created_at"),
    supabase.from("profiles").select("id, full_name, department, active").order("full_name"),
    supabase.from("ticket_categories").select("id, name"),
  ]);
  // Regra do banco: sem acesso, o ticket não é devolvido
  if (!t) notFound();

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const active = (people ?? []).filter((p) => p.active);
  const manager = isManager(profile);
  const canEdit =
    manager || profile.department === "atendimento" || profile.department === t.department || t.assignee_id === profile.id;
  const open = t.status !== "concluido" && t.status !== "cancelado";
  const sla = slaState(t);
  const frLate = open && firstResponseLate(t);

  return (
    <>
      <PageHeader
        title={`${ticketNumber(t.number)} ${t.title}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t.client && (
              <Link href={`/clientes/${t.client.id}`} className="inline-flex items-center gap-1 hover:underline">
                <Building2 className="h-3.5 w-3.5" /> {t.client.legal_name}
              </Link>
            )}
            <span className="inline-flex items-center gap-1"><Tag className="h-3.5 w-3.5" /> {t.category?.name}</span>
            <span>Aberto em {f.dateTime(t.created_at)} por {t.created_by ? nameOf.get(t.created_by) ?? "—" : "—"} · via {ORIGIN_LABEL[t.origin]}</span>
          </span>
        }
        actions={<Link href="/tickets" className="btn-secondary">Voltar</Link>}
      />

      {sp.criado === "1" && <div className="mb-4"><Alert tone="ok">Ticket aberto. {t.assignee_id ? "O responsável foi avisado." : "O departamento foi avisado."}</Alert></div>}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
        <Badge tone={sla.tone}>{sla.label}</Badge>
        <Badge>{DEPARTMENT_LABEL[t.department]}</Badge>
        {canEdit && open ? (
          <PriorityControl key={t.priority} current={t.priority} action={updatePriorityAction.bind(null, id)} />
        ) : (
          <Badge tone={PRIORITY_TONE[t.priority]}>Prioridade {PRIORITY_LABEL[t.priority]}</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Coluna principal: descrição, histórico e comentários */}
        <div className="space-y-6 xl:col-span-2">
          {t.description && (
            <section className="card p-6">
              <h2 className="mb-2 font-extrabold">Pedido do cliente</h2>
              <p className="text-sm whitespace-pre-wrap">{t.description}</p>
            </section>
          )}

          {(t.status === "concluido" || t.status === "cancelado") && (
            <Alert tone={t.status === "concluido" ? "ok" : "warn"}>
              <strong>{t.status === "concluido" ? "Concluído" : "Cancelado"}</strong> em {f.dateTime(t.closed_at)} por{" "}
              {t.closed_by ? nameOf.get(t.closed_by) ?? "—" : "—"}: {t.resolution_note ?? t.cancel_reason}
            </Alert>
          )}

          <section className="card p-6" aria-labelledby="historico">
            <h2 id="historico" className="mb-4 flex items-center gap-2 font-extrabold"><History className="h-5 w-5 text-muted" /> Histórico</h2>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {(events ?? []).map((e) => {
                const who = e.actor_id ? nameOf.get(e.actor_id) ?? "Usuário" : "Sistema";
                const d = (e.data ?? {}) as EventData;
                const isComment = e.kind === "comentario" || e.kind === "resposta";
                let text: React.ReactNode = null;
                if (e.kind === "criado") text = "abriu o ticket";
                if (e.kind === "status") text = <>mudou a situação de <b>{STATUS_LABEL[d.from as keyof typeof STATUS_LABEL]}</b> para <b>{STATUS_LABEL[d.to as keyof typeof STATUS_LABEL]}</b></>;
                if (e.kind === "atribuicao") text = d.to ? <>atribuiu a <b>{nameOf.get(d.to) ?? "—"}</b></> : "removeu o responsável";
                if (e.kind === "encaminhamento") text = <>encaminhou de <b>{DEPARTMENT_LABEL[d.from as keyof typeof DEPARTMENT_LABEL]}</b> para <b>{DEPARTMENT_LABEL[d.to as keyof typeof DEPARTMENT_LABEL]}</b>{d.assignee ? <> (responsável: {nameOf.get(d.assignee)})</> : null}</>;
                if (e.kind === "prioridade") text = <>mudou a prioridade de {PRIORITY_LABEL[d.from as keyof typeof PRIORITY_LABEL]} para <b>{PRIORITY_LABEL[d.to as keyof typeof PRIORITY_LABEL]}</b></>;
                if (e.kind === "categoria") text = <>mudou o tipo de {catName.get(d.from ?? "")} para <b>{catName.get(d.to ?? "")}</b></>;
                return (
                  <li key={e.id} className="relative">
                    <span className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-surface ${e.kind === "resposta" ? "bg-brand-500" : isComment ? "bg-info" : "bg-muted"}`} />
                    <p className="text-sm">
                      <span className="font-semibold">{who}</span>{" "}
                      {isComment ? (e.kind === "resposta" ? <Badge tone="green">Resposta ao cliente</Badge> : <span className="text-muted">comentou</span>) : <span className="text-muted">{text}</span>}
                      <span className="ml-2 text-xs text-muted">{f.dateTime(e.created_at)}</span>
                    </p>
                    {e.body && (
                      <p className={`mt-1 rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${isComment ? "bg-surface-2" : "text-muted italic"}`}>
                        {e.kind === "encaminhamento" ? `Motivo: ${e.body}` : e.body}
                      </p>
                    )}
                    {e.mentions?.length > 0 && (
                      <p className="mt-1 text-xs text-muted">Mencionou: {e.mentions.map((m) => nameOf.get(m) ?? "—").join(", ")}</p>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 border-t border-line pt-5">
              <CommentBox action={commentAction.bind(null, id)} people={active.filter((p) => p.id !== profile.id)} />
            </div>
          </section>
        </div>

        {/* Lateral: prazo e ações */}
        <div className="space-y-6">
          <section className="card p-6" aria-labelledby="prazo">
            <h2 id="prazo" className="mb-4 flex items-center gap-2 font-extrabold"><Clock className="h-5 w-5 text-muted" /> Prazo (SLA)</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-bold tracking-wide text-muted uppercase">Primeira resposta</dt>
                <dd>
                  {t.first_responded_at ? (
                    <>Respondido em {f.dateTime(t.first_responded_at)}{" "}
                      {t.first_response_due_at && new Date(t.first_responded_at) <= new Date(t.first_response_due_at)
                        ? <Badge tone="green">no prazo</Badge> : <Badge tone="red">com atraso</Badge>}
                    </>
                  ) : (
                    <>Até {f.dateTime(t.first_response_due_at)} <span className="text-muted">({relativeTime(t.first_response_due_at)})</span> {frLate && <Badge tone="red">atrasada</Badge>}</>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold tracking-wide text-muted uppercase">Resolução</dt>
                <dd>
                  Até {f.dateTime(t.resolution_due_at)} {open && <span className="text-muted">({relativeTime(t.resolution_due_at)})</span>}
                  <span className="block text-xs text-muted">Regra: {t.category ? formatSla(t.category.resolution_value, t.category.resolution_unit) : "—"}</span>
                </dd>
              </div>
              {open && t.risk_at && (
                <div>
                  <dt className="text-xs font-bold tracking-wide text-muted uppercase">Alerta preventivo</dt>
                  <dd>{f.dateTime(t.risk_at)}</dd>
                </div>
              )}
              {(t.sla_paused_at || t.sla_paused_minutes > 0) && (
                <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3">
                  <PauseCircle className="mt-0.5 h-4 w-4 text-muted" />
                  <span>
                    {t.sla_paused_at ? <>Pausado desde {f.dateTime(t.sla_paused_at)} (aguardando cliente). </> : null}
                    {t.sla_paused_minutes > 0 && <>Já pausado por {f.number(t.sla_paused_minutes / 60, 1)} h úteis; o prazo foi estendido.</>}
                  </span>
                </div>
              )}
            </dl>
          </section>

          <section className="card space-y-4 p-6" aria-labelledby="responsavel">
            <h2 id="responsavel" className="flex items-center gap-2 font-extrabold"><UserRound className="h-5 w-5 text-muted" /> Responsável</h2>
            <p className="text-sm">{t.assignee_id ? <b>{nameOf.get(t.assignee_id)}</b> : <span className="text-warn">Ninguém assumiu ainda</span>}</p>
            {canEdit && open && t.assignee_id !== profile.id && <TakeButton action={takeTicketAction.bind(null, id)} />}
            {canEdit && open && <AssignPanel key={t.assignee_id ?? ""} action={assignAction.bind(null, id)} current={t.assignee_id} people={active} />}
          </section>

          {canEdit && (
            <section className="card p-6" aria-labelledby="situacao">
              <h2 id="situacao" className="mb-4 font-extrabold">Situação</h2>
              <StatusPanel key={t.status} current={t.status} action={setStatusAction.bind(null, id)} canReopen={manager} />
            </section>
          )}

          {canEdit && open && (
            <section className="card p-6" aria-labelledby="encaminhar">
              <h2 id="encaminhar" className="mb-1 flex items-center gap-2 font-extrabold"><ArrowRightLeft className="h-5 w-5 text-muted" /> Encaminhar</h2>
              <p className="mb-4 text-sm text-muted">Envia a outro departamento com motivo registrado. O prazo continua o mesmo.</p>
              <ForwardPanel key={t.department} action={forwardAction.bind(null, id)} currentDepartment={t.department} people={active} />
            </section>
          )}
          {!canEdit && (
            <p className="text-sm text-muted">Você pode acompanhar e comentar, mas alterações cabem ao departamento {DEPARTMENT_LABEL[t.department]}.</p>
          )}
        </div>
      </div>
    </>
  );
}
