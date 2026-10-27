import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, History, Repeat, Target, UserRound } from "lucide-react";
import { getFormatter } from "@/lib/preferences-server";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { todaySP } from "@/lib/documents";
import { isUuid } from "@/lib/validation/ids";
import {
  RECURRENCE_LABEL,
  SUCCESS_EVENT_LABEL,
  SUCCESS_STATUS_LABEL,
  SUCCESS_STATUS_TONE,
  SUCCESS_TYPE_LABEL,
  planState,
} from "@/lib/success";
import { commentSuccessAction, rescheduleSuccessAction, setSuccessResponsibleAction, setSuccessStatusAction } from "../actions";
import { CommentForm, RescheduleForm, SuccessResponsibleForm, SuccessStatusPanel } from "../success-forms";

export const metadata: Metadata = { title: "Ação de sucesso do cliente" };

export default async function SuccessActionPage(props: PageProps<"/sucesso/[id]">) {
  const f = await getFormatter();
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [profile, { data: a }, events, people, next] = await Promise.all([
    requireProfile(),
    supabase.from("success_actions").select("*, client:clients(id, legal_name, status)").eq("id", id).maybeSingle(),
    supabase.from("success_events").select("*").eq("action_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("id, full_name, department, active").order("full_name"),
    supabase.from("success_actions").select("id, planned_date, status").eq("previous_id", id).maybeSingle(),
  ]);
  if (!a || !a.client) notFound();
  const today = todaySP();
  const st = planState(a.status, a.planned_date, today);
  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const activePeople = (people.data ?? []).filter((p) => p.active);
  const manager = isManager(profile);
  // Mesma regra do banco: altera quem é responsável, quem criou, a gestão e o Atendimento
  const canEdit = manager || a.responsible_id === profile.id || a.created_by === profile.id || profile.department === "atendimento";
  const who = (uid: string | null) => (uid ? nameOf.get(uid) ?? "Usuário removido" : "Sistema");

  return (
    <>
      <PageHeader
        title={a.objective}
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <Link href={`/clientes/${a.client.id}#sucesso`} className="link">{a.client.legal_name}</Link>
            <span>{SUCCESS_TYPE_LABEL[a.type]}</span>
            {a.recurrence !== "nenhuma" && <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> {RECURRENCE_LABEL[a.recurrence]}</span>}
          </span>
        }
        actions={<Link href="/sucesso" className="btn-secondary">Voltar</Link>}
      />

      {sp.criada === "1" && <div className="mb-4"><Alert tone="ok">Ação programada. O responsável será lembrado na data prevista.</Alert></div>}
      {a.client.status !== "ativo" && <div className="mb-4"><Alert tone="warn">Cliente {a.client.status}: os lembretes automáticos estão suspensos.</Alert></div>}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={SUCCESS_STATUS_TONE[a.status]}>{SUCCESS_STATUS_LABEL[a.status]}</Badge>
        {a.status === "planejada" && <Badge tone={st.tone}>{st.label}</Badge>}
        <span className="text-sm text-muted">Data prevista: <strong className="text-ink tabular-nums">{f.date(a.planned_date)}</strong></span>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="card p-6" aria-labelledby="resultado">
            <h2 id="resultado" className="mb-4 flex items-center gap-2 text-lg font-extrabold"><Target className="h-5 w-5 text-muted" /> Resultado</h2>
            {a.status === "realizada" && (
              <div className="mb-4 space-y-2">
                <p className="text-sm">
                  Realizada em <strong>{f.dateTime(a.done_at)}</strong>{a.done_by && <> por <strong>{who(a.done_by)}</strong></>}.
                </p>
                <p className="rounded-lg bg-ok-soft/50 p-3 text-sm whitespace-pre-wrap">{a.result}</p>
              </div>
            )}
            {a.status === "cancelada" && a.cancel_reason && (
              <p className="mb-4 rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap"><strong>Motivo do cancelamento:</strong> {a.cancel_reason}</p>
            )}
            {a.status === "planejada" && !canEdit && (
              <p className="text-sm text-muted">Quem registra o resultado é o responsável, quem programou, o Atendimento ou a gestão.</p>
            )}
            {(canEdit || a.status !== "planejada") && (
              <SuccessStatusPanel status={a.status} action={setSuccessStatusAction.bind(null, id)} canReopen={manager} recurrent={a.recurrence !== "nenhuma"} />
            )}
            {next.data && (
              <p className="mt-4 flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-ok" /> Próxima da série:{" "}
                <Link href={`/sucesso/${next.data.id}`} className="link">{f.date(next.data.planned_date)}</Link>
                <span className="text-muted">({SUCCESS_STATUS_LABEL[next.data.status].toLowerCase()})</span>
              </p>
            )}
            {a.previous_id && (
              <p className="mt-2 text-xs text-muted">
                Programada automaticamente a partir de <Link href={`/sucesso/${a.previous_id}`} className="link">uma ação anterior</Link>.
              </p>
            )}
          </section>

          <section className="card p-6" aria-labelledby="historico">
            <h2 id="historico" className="mb-4 flex items-center gap-2 text-lg font-extrabold"><History className="h-5 w-5 text-muted" /> Histórico e comentários</h2>
            <div className="mb-5"><CommentForm action={commentSuccessAction.bind(null, id)} /></div>
            {!events.data?.length ? (
              <p className="text-sm text-muted">Sem registros.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-line pl-5">
                {events.data.map((e) => {
                  const d = (e.data ?? {}) as Record<string, string | null>;
                  return (
                    <li key={e.id} className="relative">
                      <span className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-surface ${e.kind === "realizada" ? "bg-ok" : e.kind === "cancelada" ? "bg-muted" : e.kind === "comentario" ? "bg-info" : "bg-brand-500"}`} />
                      <p className="text-sm font-semibold">
                        {SUCCESS_EVENT_LABEL[e.kind] ?? e.kind}
                        {e.kind === "reagendada" && d.from && d.to && <span className="font-normal text-muted"> · {f.date(d.from)} → {f.date(d.to)}</span>}
                        {e.kind === "responsavel" && <span className="font-normal text-muted"> · {d.from ? who(d.from) : "ninguém"} → {d.to ? who(d.to) : "ninguém"}</span>}
                      </p>
                      {e.body && e.kind !== "criada" && <p className="mt-0.5 text-sm whitespace-pre-wrap">{e.body}</p>}
                      <p className="text-xs text-muted">{f.dateTime(e.created_at)} · {who(e.actor_id)}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {a.status === "planejada" && canEdit && (
            <section className="card p-6" aria-labelledby="reagendar">
              <h2 id="reagendar" className="mb-3 flex items-center gap-2 font-extrabold"><CalendarClock className="h-5 w-5 text-muted" /> Reagendar</h2>
              <RescheduleForm action={rescheduleSuccessAction.bind(null, id)} current={a.planned_date} />
            </section>
          )}
          <section className="card p-6" aria-labelledby="responsavel">
            <h2 id="responsavel" className="mb-1 flex items-center gap-2 font-extrabold"><UserRound className="h-5 w-5 text-muted" /> Responsável</h2>
            <p className="mb-3 text-sm text-muted">{a.responsible_id ? `Atual: ${who(a.responsible_id)}` : "Sem responsável: a gestão é avisada se atrasar."}</p>
            {a.status === "planejada" && canEdit && (
              <SuccessResponsibleForm action={setSuccessResponsibleAction.bind(null, id)} current={a.responsible_id} people={activePeople} />
            )}
          </section>
          <section className="card space-y-1 p-6 text-sm" aria-label="Detalhes">
            <p><span className="text-muted">Programada por:</span> {who(a.created_by)}</p>
            <p><span className="text-muted">Em:</span> {f.dateTime(a.created_at)}</p>
            <p><span className="text-muted">Repetição:</span> {RECURRENCE_LABEL[a.recurrence]}</p>
          </section>
        </div>
      </div>
    </>
  );
}
