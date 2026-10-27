import type { Metadata } from "next";
import { getFormatter } from "@/lib/preferences-server";
import Link from "next/link";
import { AlertTriangle, ArrowRightLeft, AtSign, Bell, CheckCheck, Clock, FileClock, MessageSquare, Ticket, UserRound } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { markAllNotificationsReadAction, markNotificationReadAction } from "../tickets/actions";

export const metadata: Metadata = { title: "Avisos" };

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  novo_ticket: Ticket,
  atribuido: UserRound,
  encaminhado: ArrowRightLeft,
  mencao: AtSign,
  comentario: MessageSquare,
  status: Ticket,
  prazo_em_risco: Clock,
  prazo_vencido: AlertTriangle,
  primeira_resposta_atrasada: AlertTriangle,
  escalonamento: AlertTriangle,
  documento_lembrete: FileClock,
  documento_atrasado: AlertTriangle,
};
const URGENT = new Set(["prazo_vencido", "primeira_resposta_atrasada", "escalonamento", "documento_atrasado"]);

export default async function NotificationsPage() {
  const f = await getFormatter();
  const supabase = await createClient();
  const [profile, { data: items }] = await Promise.all([
    requireProfile(),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
  ]);
  const unread = (items ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Avisos"
        description={unread ? `${unread} aviso(s) não lido(s)` : "Tudo lido"}
        actions={
          unread > 0 && (
            <form action={markAllNotificationsReadAction}>
              <button className="btn-secondary"><CheckCheck className="h-4 w-4" /> Marcar todos como lidos</button>
            </form>
          )
        }
      />
      {!items?.length ? (
        <div className="card p-10 text-center">
          <Bell className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-2 font-semibold">Nenhum aviso por enquanto.</p>
          <p className="text-sm text-muted">Você será avisado ao receber tickets, menções e alertas de prazo.</p>
        </div>
      ) : (
        <ul className="card divide-y divide-line" aria-label="Avisos">
          {items.map((n) => {
            const Icon = ICON[n.kind] ?? Bell;
            return (
              <li key={n.id} className={`flex items-start gap-3 p-4 transition ${n.read_at ? "" : "bg-brand-50/60"}`}>
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${URGENT.has(n.kind) ? "bg-danger-soft text-danger" : "bg-surface-2 text-link"}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${n.read_at ? "" : "font-bold"}`}>{n.title}</p>
                  {n.body && <p className="text-sm text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-muted">{f.dateTime(n.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {n.link && <Link href={n.link} className="btn-secondary px-3 py-1.5 text-xs">Abrir</Link>}
                  {!n.read_at && (
                    <form action={markNotificationReadAction.bind(null, n.id)}>
                      <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Marcar como lido" title="Marcar como lido">
                        <CheckCheck className="h-4 w-4" />
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Avisos de {profile.full_name}. Prazos de tickets são verificados a cada 5 minutos; lembretes de documentos, a cada hora no expediente.</p>
    </>
  );
}
