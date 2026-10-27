"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MessageCircle, PlugZap, RefreshCw, Send, ShieldCheck, Trash2, Unplug } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { FormMessage } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { EMAIL_PRESETS } from "@/lib/channels/email-presets";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function useManual(action: Action) {
  const [state, dispatch, pending] = useActionState(action, {});
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, submit, pending, err: state.errors ?? {} };
}

// ---------------- E-mail ----------------

const PRESET_BADGE: Record<string, string> = { gmail: "G", hostinger: "H", locaweb: "LW", zoho: "Z", yahoo: "Y!", microsoft: "MS", outro: "…" };

export function EmailConnectForm({ action }: { action: Action }) {
  const { state, submit, pending, err } = useManual(action);
  const v = state.values ?? {};
  const [provider, setProvider] = useState(v.provider ?? "gmail");
  const preset = EMAIL_PRESETS.find((p) => p.value === provider)!;
  const [imapHost, setImapHost] = useState(v.imap_host ?? preset.imap?.host ?? "");
  const [imapPort, setImapPort] = useState(v.imap_port ?? String(preset.imap?.port ?? 993));
  const [smtpHost, setSmtpHost] = useState(v.smtp_host ?? preset.smtp?.host ?? "");
  const [smtpPort, setSmtpPort] = useState(v.smtp_port ?? String(preset.smtp?.port ?? 465));

  function choose(p: string) {
    setProvider(p);
    const pr = EMAIL_PRESETS.find((x) => x.value === p)!;
    setImapHost(pr.imap?.host ?? "");
    setImapPort(String(pr.imap?.port ?? 993));
    setSmtpHost(pr.smtp?.host ?? "");
    setSmtpPort(String(pr.smtp?.port ?? 465));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate autoComplete="off">
      <FormMessage state={state} />
      <div>
        <p className="label">Provedor do e-mail</p>
        <Select name="provider" aria-label="Provedor" value={provider} onChange={choose}
          options={EMAIL_PRESETS.map((p) => ({ value: p.value, label: p.label, badge: PRESET_BADGE[p.value], hint: p.available ? undefined : "Requer login Microsoft", disabled: !p.available, tag: p.available ? undefined : "Em breve" }))} />
        <p className="mt-1 text-xs text-muted">{preset.hint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="em-label">Nome da caixa</label>
          <input id="em-label" name="label" className="input" defaultValue={v.label ?? "E-mail da empresa"} />
          {err.label && <p className="field-error">{err.label}</p>}
        </div>
        <div>
          <label className="label" htmlFor="em-address">Endereço de e-mail</label>
          <input id="em-address" name="address" type="email" className="input" defaultValue={v.address ?? ""} placeholder="contato@empresa.com.br" />
          {err.address && <p className="field-error">{err.address}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="em-password">Senha {provider === "gmail" || provider === "yahoo" ? "de app" : "da caixa"}</label>
          <input id="em-password" name="password" type="password" className="input" autoComplete="new-password" />
          {err.password && <p className="field-error">{err.password}</p>}
          <p className="mt-1 flex items-center gap-1 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-ok" /> Guardada criptografada no servidor. Nunca aparece de novo na tela.
          </p>
        </div>
      </div>
      <details className="rounded-xl border border-line p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-muted">Configuração avançada (servidores e portas)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="em-user">Usuário (se diferente do e-mail)</label>
            <input id="em-user" name="username" className="input" defaultValue={v.username ?? ""} placeholder="Normalmente o próprio e-mail" />
          </div>
          <div />
          <div>
            <label className="label" htmlFor="em-imap">Servidor IMAP (receber)</label>
            <input id="em-imap" name="imap_host" className="input" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
            {err.imap_host && <p className="field-error">{err.imap_host}</p>}
          </div>
          <div>
            <label className="label" htmlFor="em-imap-port">Porta IMAP</label>
            <input id="em-imap-port" name="imap_port" className="input" inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="em-smtp">Servidor SMTP (enviar)</label>
            <input id="em-smtp" name="smtp_host" className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
            {err.smtp_host && <p className="field-error">{err.smtp_host}</p>}
          </div>
          <div>
            <label className="label" htmlFor="em-smtp-port">Porta SMTP</label>
            <input id="em-smtp-port" name="smtp_port" className="input" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
          </div>
        </div>
      </details>
      <button className="btn-primary" disabled={pending || !preset.available}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} {pending ? "Testando e importando…" : "Testar e conectar"}
      </button>
    </form>
  );
}

export function SyncNowButton({ action }: { action: () => Promise<ActionState> }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={pending}
        onClick={() => start(async () => { const r = await action(); setMsg(r.message ?? r.errors?._form ?? null); router.refresh(); })}>
        {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Buscar agora
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}

export function ConfirmAction({ action, label, question, danger = true, icon = "unplug" }: { action: () => Promise<void>; label: string; question: string; danger?: boolean; icon?: "unplug" | "trash" }) {
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();
  const Icon = icon === "trash" ? Trash2 : Unplug;
  if (!ask) {
    return (
      <button type="button" className={`${danger ? "btn-danger" : "btn-secondary"} px-3 py-1.5 text-xs`} onClick={() => setAsk(true)}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold">{question}</span>
      <button type="button" className="btn-danger px-3 py-1.5 text-xs" disabled={pending} onClick={() => start(() => action())}>
        {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Confirmar"}
      </button>
      <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setAsk(false)}>Cancelar</button>
    </span>
  );
}

// ---------------- WhatsApp: janela oficial da Meta (Embedded Signup) ----------------

type FBLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FBSdk = { init: (o: Record<string, unknown>) => void; login: (cb: (r: FBLoginResponse) => void, o: Record<string, unknown>) => void };
declare global {
  interface Window {
    FB?: FBSdk;
    fbAsyncInit?: () => void;
  }
}

export function WhatsAppConnectButton({
  appId,
  configId,
  version,
  action,
}: {
  appId: string;
  configId: string;
  version: string;
  action: (input: { code: string; wabaId: string; phoneNumberId?: string | null }) => Promise<ActionState>;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionState | null>(null);
  const session = useRef<{ wabaId?: string; phoneNumberId?: string | null; event?: string }>({});
  const router = useRouter();

  useEffect(() => {
    // Dados da conta escolhida chegam por mensagem da janela da Meta (session logging)
    const onMessage = (e: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP") {
          session.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id ?? null, event: data.event };
        }
      } catch {
        /* mensagens de outros formatos são ignoradas */
      }
    };
    window.addEventListener("message", onMessage);
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version });
      setReady(true);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.async = true;
      s.crossOrigin = "anonymous";
      s.src = "https://connect.facebook.net/pt_BR/sdk.js";
      document.body.appendChild(s);
    } else if (window.FB) {
      window.fbAsyncInit();
    }
    return () => window.removeEventListener("message", onMessage);
  }, [appId, version]);

  function connect() {
    if (!window.FB) return;
    setBusy(true);
    setResult(null);
    session.current = {};
    window.FB.login(
      (resp) => {
        const code = resp.authResponse?.code;
        // A mensagem da sessão pode chegar logo depois do retorno do login
        setTimeout(async () => {
          const { wabaId, phoneNumberId } = session.current;
          if (!code || !wabaId) {
            setResult({ errors: { _form: "A conexão foi cancelada ou não terminou. Tente de novo." } });
            setBusy(false);
            return;
          }
          const r = await action({ code, wabaId, phoneNumberId });
          setResult(r);
          setBusy(false);
          if (r.ok) router.refresh();
        }, 800);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <div className="space-y-3">
      {result && <FormMessage state={result} />}
      <button type="button" onClick={connect} disabled={!ready || busy} className="btn btn-primary bg-[#1f8a5f] px-5 py-2.5">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        {busy ? "Conectando…" : ready ? "Conectar WhatsApp" : "Carregando…"}
      </button>
      <p className="text-xs text-muted">
        Abre a janela oficial da Meta. Entre com o Facebook da empresa, escolha o número do WhatsApp Business e confirme lendo o QR Code no celular.
        Mantenha o app aberto no celular durante a cópia das conversas.
      </p>
    </div>
  );
}

// ---------------- Modo de demonstração ----------------

export function SimulateForm({ action }: { action: Action }) {
  const { state, submit, pending, err } = useManual(action);
  const v = state.ok ? {} : state.values ?? {};
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="sim-name">Nome de quem envia</label>
          <input id="sim-name" name="name" className="input" defaultValue={v.name ?? "Cliente Fictício"} />
          {err.name && <p className="field-error">{err.name}</p>}
        </div>
        <div>
          <label className="label" htmlFor="sim-phone">Número (com DDD)</label>
          <input id="sim-phone" name="phone" className="input" defaultValue={v.phone ?? "(11) 90000-0000"} inputMode="tel" />
          {err.phone && <p className="field-error">{err.phone}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="sim-text">Mensagem</label>
          <input id="sim-text" name="text" className="input" defaultValue={v.text ?? "Bom dia! Segue o extrato do mês."} />
          {err.text && <p className="field-error">{err.text}</p>}
        </div>
      </div>
      <p className="text-xs text-muted">Use o número de um contato cadastrado para ver a conversa ser ligada ao cliente automaticamente.</p>
      <button className="btn-secondary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Simular mensagem recebida
      </button>
    </form>
  );
}
