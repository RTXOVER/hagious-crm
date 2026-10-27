import type { Metadata } from "next";
import { getFormatter } from "@/lib/preferences-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BellRing, CalendarClock, FileText, History, UserRound } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { DEPARTMENT_LABEL } from "@/lib/labels";
import {
  CHANNEL_LABEL,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  REMINDER_STATUS_LABEL,
  REMINDER_STATUS_TONE,
  describeRule,
  dueState,
  stageLabel,
  todaySP,
} from "@/lib/documents";
import { isUuid } from "@/lib/validation/ids";
import { changeDueDateAction, setDocResponsibleAction, setDocStatusAction } from "../actions";
import { DocResponsibleForm, DocStatusPanel, DueDateForm } from "../doc-forms";

export const metadata: Metadata = { title: "Documento" };

const FIELD_LABEL: Record<string, string> = { status: "situação", due_date: "vencimento", responsible_id: "responsável", status_note: "observação" };

export default async function DocumentPage(props: PageProps<"/documentos/[id]">) {
  const f = await getFormatter();
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [profile, { data: doc }, reminders, people, history, settings] = await Promise.all([
    requireProfile(),
    supabase
      .from("client_documents")
      .select("*, client:clients(id, legal_name, status), requirement:document_requirements(periodicity, due_day, first_month, active)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("document_reminders").select("*").eq("document_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, department, active").order("full_name"),
    supabase
      .from("audit_log")
      .select("id, action, actor_id, created_at, old_data, new_data")
      .eq("table_name", "client_documents")
      .eq("record_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("document_settings").select("reminder_days").eq("id", 1).maybeSingle(),
  ]);
  if (!doc || !doc.client) notFound();
  const today = todaySP();
  const st = dueState(doc.status, doc.due_date, today);
  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const activePeople = (people.data ?? []).filter((p) => p.active);
  const days = [...(settings.data?.reminder_days ?? [])].sort((a, b) => b - a);

  return (
    <>
      <PageHeader
        title={doc.title}
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <Link href={`/clientes/${doc.client.id}#documentos`} className="link">{doc.client.legal_name}</Link>
            <span>{DEPARTMENT_LABEL[doc.department]}</span>
            <span>{doc.requirement ? describeRule(doc.requirement.periodicity, doc.requirement.due_day, doc.requirement.first_month) : "Pendência avulsa"}</span>
          </span>
        }
        actions={<Link href="/documentos" className="btn-secondary">Voltar</Link>}
      />

      {sp.criado === "1" && <div className="mb-4"><Alert tone="ok">Pendência registrada. Os lembretes saem automaticamente antes do vencimento.</Alert></div>}
      {doc.client.status !== "ativo" && (
        <div className="mb-4"><Alert tone="warn">Cliente {doc.client.status}: lembretes e alertas automáticos estão suspensos para ele.</Alert></div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={DOC_STATUS_TONE[doc.status]}>{DOC_STATUS_LABEL[doc.status]}</Badge>
        {doc.status === "pendente" && <Badge tone={st.tone}>{st.label}</Badge>}
        <span className="text-sm text-muted">Vencimento: <strong className="text-ink tabular-nums">{f.date(doc.due_date)}</strong></span>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="card p-6" aria-labelledby="situacao">
            <h2 id="situacao" className="mb-4 flex items-center gap-2 text-lg font-extrabold"><FileText className="h-5 w-5 text-muted" /> Situação</h2>
            {doc.status === "recebido" && (
              <p className="mb-4 text-sm">
                Recebido em <strong>{f.dateTime(doc.received_at)}</strong>
                {doc.received_by && <> por <strong>{nameOf.get(doc.received_by) ?? "usuário removido"}</strong></>}.
              </p>
            )}
            {doc.status_note && (
              <p className="mb-4 rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">{doc.status_note}</p>
            )}
            <DocStatusPanel status={doc.status} action={setDocStatusAction.bind(null, id)} />
          </section>

          <section className="card p-6" aria-labelledby="lembretes">
            <h2 id="lembretes" className="mb-1 flex items-center gap-2 text-lg font-extrabold"><BellRing className="h-5 w-5 text-muted" /> Lembretes</h2>
            <p className="mb-4 text-sm text-muted">
              Programados para: {days.map(stageLabel).join(", ").toLowerCase() || "—"} do vencimento, dentro do expediente.
              Cada envio fica registrado abaixo.
            </p>
            {!reminders.data?.length ? (
              <p className="text-sm text-muted">Nenhum lembrete disparado ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr><th>Etapa</th><th>Canal</th><th>Situação</th><th>Para</th><th>Quando</th></tr>
                  </thead>
                  <tbody>
                    {reminders.data.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap">
                          {stageLabel(r.days_before)}
                          {r.due_date !== doc.due_date && <p className="text-xs text-muted">venc. anterior {f.date(r.due_date)}</p>}
                        </td>
                        <td>{CHANNEL_LABEL[r.channel]}</td>
                        <td>
                          <Badge tone={REMINDER_STATUS_TONE[r.status]}>{REMINDER_STATUS_LABEL[r.status]}</Badge>
                          {r.channel === "whatsapp" && r.status === "na_fila" && <p className="mt-0.5 text-xs text-muted">Aguardando modelo de mensagem aprovado pela Meta</p>}
                          {r.last_error && <p className="mt-0.5 text-xs text-muted">{r.last_error}</p>}
                          {r.attempts > 1 && <p className="text-xs text-muted">{r.attempts} tentativas</p>}
                        </td>
                        <td className="text-sm">{r.recipient ?? "—"}</td>
                        <td className="text-xs whitespace-nowrap text-muted">{f.dateTime(r.sent_at ?? r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {doc.status === "pendente" && (
            <section className="card p-6" aria-labelledby="vencimento">
              <h2 id="vencimento" className="mb-3 flex items-center gap-2 font-extrabold"><CalendarClock className="h-5 w-5 text-muted" /> Vencimento</h2>
              <DueDateForm action={changeDueDateAction.bind(null, id)} current={doc.due_date} />
            </section>
          )}
          <section className="card p-6" aria-labelledby="quem-cobra">
            <h2 id="quem-cobra" className="mb-1 flex items-center gap-2 font-extrabold"><UserRound className="h-5 w-5 text-muted" /> Quem cobra</h2>
            <p className="mb-3 text-sm text-muted">
              {doc.responsible_id ? `Atual: ${nameOf.get(doc.responsible_id) ?? "—"}` : "Sem pessoa definida: avisa o responsável do cliente no departamento (ou todo o departamento)."}
            </p>
            <DocResponsibleForm action={setDocResponsibleAction.bind(null, id)} current={doc.responsible_id} people={activePeople} department={doc.department} />
          </section>

          {isManager(profile) && (
            <section className="card p-6" aria-labelledby="historico">
              <h2 id="historico" className="mb-4 flex items-center gap-2 font-extrabold"><History className="h-5 w-5 text-muted" /> Histórico</h2>
              {!history.data?.length ? (
                <p className="text-sm text-muted">Sem registros.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {history.data.map((h) => {
                    const oldD = (h.old_data ?? {}) as Record<string, unknown>;
                    const newD = (h.new_data ?? {}) as Record<string, unknown>;
                    const changed = h.action === "UPDATE" ? Object.keys(FIELD_LABEL).filter((k) => JSON.stringify(oldD[k]) !== JSON.stringify(newD[k])) : [];
                    if (h.action === "UPDATE" && !changed.length) return null;
                    return (
                      <li key={h.id}>
                        <span className="font-semibold">
                          {h.action === "INSERT" ? "Pendência criada" : h.action === "DELETE" ? "Removida" : `Alterou ${changed.map((k) => FIELD_LABEL[k]).join(", ")}`}
                        </span>
                        {changed.includes("status") && <span className="text-muted"> → {DOC_STATUS_LABEL[newD.status as keyof typeof DOC_STATUS_LABEL]}</span>}
                        {changed.includes("due_date") && <span className="text-muted"> → {f.date(String(newD.due_date))}</span>}
                        <span className="block text-xs text-muted">
                          {f.dateTime(h.created_at)} · {h.actor_id ? nameOf.get(h.actor_id) ?? "Usuário removido" : "Sistema"}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
