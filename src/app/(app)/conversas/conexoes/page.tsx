import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { CheckCircle2, CircleDashed, FlaskConical, Mail, MessageCircle } from "lucide-react";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFormatter } from "@/lib/preferences-server";
import { whatsappEnv, whatsappReady } from "@/lib/channels/whatsapp";
import { PageHeader, Badge, Alert } from "@/components/page-header";
import { syncEmailNowAction } from "../actions";
import {
  completeWhatsAppSignupAction,
  connectEmailAction,
  createDemoWhatsAppAction,
  disconnectChannelAction,
  removeDemoAction,
  simulateIncomingAction,
} from "./actions";
import { ConfirmAction, EmailConnectForm, SimulateForm, SyncNowButton, WhatsAppConnectButton } from "./connect-forms";

export const metadata: Metadata = { title: "Canais de conversa" };

const STATUS = {
  conectado: { label: "Conectado", tone: "green" },
  pendente: { label: "Pendente", tone: "amber" },
  erro: { label: "Com erro", tone: "red" },
  desconectado: { label: "Desconectado", tone: "gray" },
} as const;

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const [profile, f, { data: accounts }, h] = await Promise.all([
    requireProfile(),
    getFormatter(),
    supabase.from("channel_accounts").select("*").order("created_at"),
    headers(),
  ]);
  const admin = isAdmin(profile);
  const env = whatsappEnv();
  const ready = whatsappReady();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "seu-dominio";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const webhookUrl = `${proto}://${host}/api/webhooks/whatsapp`;
  const wa = (accounts ?? []).filter((a) => a.kind === "whatsapp" && !a.is_demo);
  const demo = (accounts ?? []).find((a) => a.kind === "whatsapp" && a.is_demo);
  const mails = (accounts ?? []).filter((a) => a.kind === "email");

  return (
    <>
      <PageHeader
        title="Canais de conversa"
        description="WhatsApp e e-mail da empresa ligados ao CRM: as mensagens chegam em Conversas e podem ser salvas nos clientes."
        actions={<Link href="/conversas" className="btn-secondary">Ir para Conversas</Link>}
      />
      {!admin && <div className="mb-6"><Alert tone="info">Somente administradores conectam ou desconectam canais.</Alert></div>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ---------------- WhatsApp ---------------- */}
        <section className="card p-6" aria-labelledby="wa-title">
          <div className="mb-4 flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#25d366] text-white"><MessageCircle className="h-6 w-6" /></span>
            <div>
              <h2 id="wa-title" className="text-lg font-extrabold">WhatsApp Business</h2>
              <p className="text-sm text-muted">API oficial da Meta. O número continua funcionando no app do celular (coexistência).</p>
            </div>
          </div>

          {wa.map((a) => {
            const cfg = (a.config ?? {}) as { history?: { progress?: number; declined?: boolean }; sync_requests?: Record<string, string> };
            return (
              <div key={a.id} className="mb-4 rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{a.label} <span className="font-normal text-muted">+{a.address}</span></p>
                  <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">Última atividade: {f.dateTime(a.last_sync_at)}</p>
                {cfg.history && (
                  <p className="mt-1 text-xs text-muted">
                    Cópia do histórico: {cfg.history.declined ? "recusada no celular" : `${cfg.history.progress ?? 0}%`}
                  </p>
                )}
                {a.last_error && <p className="mt-1 text-xs text-danger">{a.last_error}</p>}
                {admin && a.status !== "desconectado" && (
                  <div className="mt-3">
                    <ConfirmAction action={disconnectChannelAction.bind(null, a.id)} label="Desconectar" question="Parar de receber? As conversas ficam guardadas." />
                  </div>
                )}
              </div>
            );
          })}

          {ready ? (
            admin && <WhatsAppConnectButton appId={env.appId} configId={env.configId} version={env.version} action={completeWhatsAppSignupAction} />
          ) : (
            <div className="space-y-3">
              <Alert tone="warn">A conexão oficial ainda não está ativa neste servidor.</Alert>
              <p className="text-sm">Para o botão “Conectar WhatsApp” funcionar, falta uma configuração <strong>única</strong> da Hagious com a Meta:</p>
              <ol className="space-y-2 text-sm">
                {[
                  ["Aplicativo da Hagious no painel de desenvolvedores da Meta, com o produto WhatsApp", !!env.appId],
                  ["Hagious registrada como Tech Provider e empresa verificada (exigência da Meta para a coexistência)", false],
                  ["Configuração do “Embedded Signup” criada no aplicativo", !!env.configId],
                  ["App Secret guardado no servidor (para conferir a assinatura dos avisos)", !!env.appSecret],
                  [`Webhook apontando para ${webhookUrl} (precisa ser um endereço público com HTTPS)`, false],
                ].map(([text, done]) => (
                  <li key={String(text)} className="flex items-start gap-2">
                    {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted">
                O texto de verificação do webhook já foi gerado e está guardado no servidor (WHATSAPP_VERIFY_TOKEN). Grupos não são suportados pela Meta nesse modo.
              </p>
            </div>
          )}

          {admin && (
            <div className="mt-6 rounded-2xl border border-dashed border-info/40 bg-info-soft/40 p-4">
              <p className="flex items-center gap-2 font-bold text-info"><FlaskConical className="h-4 w-4" /> Modo de demonstração</p>
              <p className="mt-1 mb-3 text-sm text-muted">
                Simula mensagens chegando pela Meta, usando o mesmo processamento do canal real. Nada é enviado de verdade e tudo fica marcado como demonstração.
              </p>
              {demo ? (
                <div className="space-y-4">
                  <SimulateForm action={simulateIncomingAction} />
                  <ConfirmAction action={removeDemoAction} label="Apagar demonstração" question="Apagar o canal e as conversas de demonstração?" icon="trash" />
                </div>
              ) : (
                <form action={createDemoWhatsAppAction}>
                  <button className="btn-secondary"><FlaskConical className="h-4 w-4" /> Ativar demonstração</button>
                </form>
              )}
            </div>
          )}
        </section>

        {/* ---------------- E-mail ---------------- */}
        <section className="card p-6" aria-labelledby="mail-title">
          <div className="mb-4 flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-info text-white"><Mail className="h-6 w-6" /></span>
            <div>
              <h2 id="mail-title" className="text-lg font-extrabold">E-mail</h2>
              <p className="text-sm text-muted">Caixa de entrada e enviados da empresa, por IMAP/SMTP. Funciona com a maioria dos provedores.</p>
            </div>
          </div>

          {mails.map((a) => {
            const cfg = (a.config ?? {}) as { sync?: { last_count?: number } };
            return (
              <div key={a.id} className="mb-4 rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{a.label} <span className="font-normal text-muted">{a.address}</span></p>
                  <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Última busca: {f.dateTime(a.last_sync_at)}{typeof cfg.sync?.last_count === "number" ? ` · ${cfg.sync.last_count} nova(s)` : ""} · busca automática a cada minuto com Conversas aberta
                </p>
                {a.last_error && <p className="mt-1 text-xs text-danger">{a.last_error}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.status !== "desconectado" && <SyncNowButton action={syncEmailNowAction} />}
                  {admin && a.status !== "desconectado" && (
                    <ConfirmAction action={disconnectChannelAction.bind(null, a.id)} label="Desconectar" question="Parar de buscar e-mails? As conversas ficam guardadas." />
                  )}
                </div>
              </div>
            );
          })}

          {admin ? (
            <div className={mails.length ? "border-t border-line pt-5" : ""}>
              {mails.length > 0 && <h3 className="mb-3 font-bold">Conectar outra caixa</h3>}
              <EmailConnectForm action={connectEmailAction} />
            </div>
          ) : (
            !mails.length && <p className="text-sm text-muted">Nenhuma caixa de e-mail conectada.</p>
          )}
        </section>
      </div>
    </>
  );
}
