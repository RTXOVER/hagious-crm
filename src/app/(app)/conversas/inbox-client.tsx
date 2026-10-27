"use client";

import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive, ArchiveRestore, BookmarkPlus, Clipboard, ClipboardCheck, FileCheck2, Inbox, LoaderCircle, MailX, MoreHorizontal,
  Reply, SendHorizontal, ShieldCheck, Ticket, X,
} from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { Alert, FormMessage } from "@/components/page-header";
import { Select, type SelectOption } from "@/components/ui/select";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type ClientsLoader = () => Promise<SelectOption[]>;

/** Atualiza a tela a cada 15 s (quando visível) e busca e-mails novos a cada minuto. */
export function AutoRefresh({ syncEmail }: { syncEmail: (() => Promise<ActionState>) | null }) {
  const router = useRouter();
  // A referência da ação muda a cada atualização da tela: guardada num ref para não reiniciar o ciclo
  const sync = useRef(syncEmail);
  useEffect(() => {
    sync.current = syncEmail;
  });
  useEffect(() => {
    let lastSync = 0;
    let busy = false;
    const tick = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        if (sync.current && Date.now() - lastSync > 60_000) {
          lastSync = Date.now();
          await sync.current().catch(() => undefined);
        }
        router.refresh();
      } finally {
        busy = false;
      }
    };
    const t = setInterval(tick, 15_000);
    const first = setTimeout(tick, 1_500);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [router]);
  return null;
}

/** Ao abrir a conversa, zera as não lidas (uma vez por conversa). */
export function MarkRead({ id, unread, action }: { id: string; unread: number; action: (id: string) => Promise<void> }) {
  const router = useRouter();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (unread > 0 && done.current !== id) {
      done.current = id;
      action(id).then(() => router.refresh());
    }
  }, [id, unread, action, router]);
  return null;
}

/** Mantém a conversa rolada até a última mensagem (ao abrir outra conversa ou chegar mensagem nova). */
export function ScrollToEnd({ watch, className, children }: { watch: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [watch]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Carrega a lista de clientes uma vez, só quando alguém precisa dela. */
function useClients(load: ClientsLoader) {
  const [clients, setClients] = useState<SelectOption[] | null>(null);
  const loading = useRef(false);
  const ensure = useCallback(() => {
    if (clients || loading.current) return;
    loading.current = true;
    load().then((c) => setClients(c)).finally(() => (loading.current = false));
  }, [clients, load]);
  return { clients, ensure };
}

export function LinkClient({
  current,
  currentLabel,
  loadClients,
  action,
}: {
  current: string;
  currentLabel: string | null;
  loadClients: ClientsLoader;
  action: (clientId: string) => Promise<ActionState>;
}) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  const { clients, ensure } = useClients(loadClients);
  const router = useRouter();
  const options: SelectOption[] = [
    { value: "", label: "Sem cliente", hint: "Conversa ainda não ligada", badge: "—" },
    ...(clients ?? (current && currentLabel ? [{ value: current, label: currentLabel }] : [])),
  ];
  return (
    <div className="min-w-0 flex-1 sm:w-72 sm:flex-none" onPointerDownCapture={ensure} onFocusCapture={ensure}>
      <Select
        size="sm"
        aria-label="Cliente desta conversa"
        searchable
        value={value}
        disabled={pending}
        placeholder="Ligar a um cliente…"
        options={clients ? options : [...options, { value: "__loading", label: "Carregando clientes…", disabled: true }]}
        onChange={(v) => {
          setValue(v);
          start(async () => {
            const r = await action(v);
            setResult(r);
            if (r.ok) router.refresh();
            else setValue(current);
          });
        }}
      />
      {result?.errors?._form && <p className="mt-1 text-xs text-danger">{result.errors._form}</p>}
    </div>
  );
}

export function ArchiveButton({ archived, action }: { archived: boolean; action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn-secondary px-2.5 py-2 text-xs" disabled={pending} onClick={() => start(() => action())}
      title={archived ? "Desarquivar" : "Arquivar conversa"} aria-label={archived ? "Desarquivar" : "Arquivar conversa"}>
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
    </button>
  );
}

function useSendAction(action: Action, onSent: () => void) {
  return useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) onSent(); // limpa só depois que o servidor confirmar
    return r;
  }, {});
}

/** Resposta do WhatsApp. Enter envia; Shift+Enter quebra linha. */
export function Composer({ action, windowOpen, windowEndsAt }: { action: Action; windowOpen: boolean; windowEndsAt: string | null }) {
  const [body, setBody] = useState("");
  const [state, dispatch, pending] = useSendAction(action, () => setBody(""));
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [body]);

  if (!windowOpen) {
    return (
      <Alert tone="warn">
        Fora da janela de 24h do WhatsApp{windowEndsAt ? ` (encerrou em ${windowEndsAt})` : ""}: só é possível enviar um modelo aprovado pela Meta
        ou aguardar o cliente escrever. Modelos aprovados entram numa próxima etapa.
      </Alert>
    );
  }
  return (
    <form
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => dispatch(fd));
      }}
      className="space-y-2"
    >
      {state.errors?._form && <Alert tone="danger">{state.errors._form}</Alert>}
      <div className="flex items-end gap-2">
        <textarea
          ref={area}
          name="body"
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          placeholder="Escreva uma mensagem"
          aria-label="Mensagem"
          className="max-h-44 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-[15px] outline-none focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-500/15"
        />
        <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
          disabled={pending || !body.trim()} aria-label="Enviar">
          {pending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
        </button>
      </div>
      <p className="text-[11px] text-muted">Enter envia · Shift+Enter quebra a linha{windowEndsAt ? ` · janela de 24h até ${windowEndsAt}` : ""}</p>
    </form>
  );
}

/** Resposta de e-mail, com cara de e-mail: Para, Assunto e corpo. */
export function EmailComposer({ action, to, defaultSubject }: { action: Action; to: string; defaultSubject: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [state, dispatch, pending] = useSendAction(action, () => {
    setBody("");
    setOpen(false);
  });
  const uid = useId();
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {state.ok && <span className="text-sm font-semibold text-ok">E-mail enviado.</span>}
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          <Reply className="h-4 w-4" /> Responder
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => dispatch(fd));
      }}
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-lift)"
    >
      {state.errors?._form && <div className="p-3 pb-0"><Alert tone="danger">{state.errors._form}</Alert></div>}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <span className="w-14 text-muted">Para</span>
        <span className="truncate font-semibold">{to}</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Descartar resposta"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <label htmlFor={`${uid}-s`} className="w-14 text-muted">Assunto</label>
        <input id={`${uid}-s`} name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="min-w-0 flex-1 bg-transparent font-semibold outline-none" />
      </div>
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={7}
        autoFocus
        aria-label="Mensagem"
        placeholder="Escreva sua resposta…"
        className="block w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none"
      />
      <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
        <span className="text-xs text-muted">Sai pela caixa conectada, como resposta ao último e-mail.</span>
        <button className="btn-primary" disabled={pending || !body.trim()}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />} Enviar
        </button>
      </div>
    </form>
  );
}

// ---------------- Ações por mensagem (uma única janela para a página toda) ----------------

type MessageCtx = { open: (m: { id: string; body: string; ticketHref: string }) => void; touch: boolean };
const MessageContext = createContext<MessageCtx>({ open: () => undefined, touch: false });

export function MessageActionsProvider({
  children,
  loadClients,
  defaultClient,
  docs,
  saveAction,
  docAction,
}: {
  children: React.ReactNode;
  loadClients: ClientsLoader;
  defaultClient: string;
  docs: SelectOption[];
  saveAction: (messageId: string, prev: ActionState, fd: FormData) => Promise<ActionState>;
  docAction: (messageId: string, prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [msg, setMsg] = useState<{ id: string; body: string; ticketHref: string } | null>(null);
  const [mode, setMode] = useState<"menu" | "save" | "doc">("menu");
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const { clients, ensure } = useClients(loadClients);

  const open = useCallback((m: { id: string; body: string; ticketHref: string }) => {
    setMsg(m);
    setMode("menu");
    setCopied(false);
  }, []);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (msg && !d.open) d.showModal();
    if (!msg && d.open) d.close();
  }, [msg]);
  const closeAll = useCallback(() => setMsg(null), []);

  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <MessageContext.Provider value={{ open, touch: false }}>
      {children}
      <dialog
        ref={dialog}
        onClose={closeAll}
        aria-labelledby={`${uid}-t`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] overflow-visible rounded-2xl border border-line bg-surface p-0 text-ink shadow-(--shadow-lift) backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      >
        {msg && (
          <div className="p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 id={`${uid}-t`} className="text-lg font-extrabold">
                {mode === "save" ? "Salvar no cliente" : mode === "doc" ? "Documento recebido" : "Ações da mensagem"}
              </h2>
              <button type="button" onClick={closeAll} className="rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Fechar"><X className="h-5 w-5" /></button>
            </div>
            {msg.body && <blockquote className="mb-4 line-clamp-4 rounded-xl border-l-4 border-brand-500 bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap">{msg.body}</blockquote>}
            {mode === "menu" && (
              <div className="space-y-1">
                <button type="button" className={item} onClick={() => { ensure(); setMode("save"); }}>
                  <BookmarkPlus className="h-4 w-4 text-link" /> Salvar no cliente
                  <span className="ml-auto text-xs font-normal text-muted">fica no histórico</span>
                </button>
                <Link href={msg.ticketHref} className={item} onClick={closeAll}>
                  <Ticket className="h-4 w-4 text-link" /> Abrir ticket com esta mensagem
                </Link>
                <button type="button" className={item} onClick={() => setMode("doc")} disabled={!docs.length}>
                  <FileCheck2 className="h-4 w-4 text-link" /> Marcar documento como recebido
                  <span className="ml-auto text-xs font-normal text-muted">{docs.length ? `${docs.length} pendente(s)` : "nenhum pendente"}</span>
                </button>
                <button type="button" className={item} disabled={!msg.body}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(msg.body);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}>
                  {copied ? <ClipboardCheck className="h-4 w-4 text-ok" /> : <Clipboard className="h-4 w-4 text-link" />} {copied ? "Copiado" : "Copiar texto"}
                </button>
              </div>
            )}
            {mode === "save" && (
              <SaveForm key={msg.id} action={saveAction.bind(null, msg.id)} clients={clients} defaultClient={defaultClient} onDone={closeAll} />
            )}
            {mode === "doc" && <DocForm key={msg.id} action={docAction.bind(null, msg.id)} docs={docs} onDone={closeAll} />}
          </div>
        )}
      </dialog>
    </MessageContext.Provider>
  );
}

/** Botão "⋯" de uma mensagem (sempre visível no celular; no computador aparece ao passar o mouse). */
export function MessageMenu({ id, body, ticketHref, label = "Ações da mensagem" }: { id: string; body: string; ticketHref: string; label?: string }) {
  const { open } = useContext(MessageContext);
  return (
    <button
      type="button"
      onClick={() => open({ id, body, ticketHref })}
      className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-ink focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
      aria-label={label}
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}

function useFinishOnce(ok: boolean | undefined, onDone: () => void, delay: number) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (!ok || done.current) return;
    done.current = true; // atualiza uma única vez (antes recarregava sem parar)
    router.refresh();
    const t = setTimeout(onDone, delay);
    return () => clearTimeout(t);
  }, [ok, onDone, delay, router]);
}

function SaveForm({ action, clients, defaultClient, onDone }: { action: Action; clients: SelectOption[] | null; defaultClient: string; onDone: () => void }) {
  const [state, dispatch, pending] = useActionState(action, {});
  useFinishOnce(state.ok, onDone, 900);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)); }} className="space-y-3">
      <FormMessage state={state} />
      <div>
        <p className="label">Cliente</p>
        <Select name="client_id" aria-label="Cliente" searchable defaultValue={defaultClient} placeholder={clients ? "Escolha o cliente…" : "Carregando clientes…"}
          options={clients ?? []} disabled={!clients} />
        {state.errors?.client_id && <p className="field-error">{state.errors.client_id}</p>}
      </div>
      <div>
        <label className="label" htmlFor="save-note">Observação (opcional)</label>
        <input id="save-note" name="note" className="input" placeholder="Ex.: confirmação do pagamento das guias" />
      </div>
      <button className="btn-primary w-full" disabled={pending || !clients}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />} Salvar no cliente
      </button>
    </form>
  );
}

function DocForm({ action, docs, onDone }: { action: Action; docs: SelectOption[]; onDone: () => void }) {
  const [state, dispatch, pending] = useActionState(action, {});
  useFinishOnce(state.ok, onDone, 1200);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)); }} className="space-y-3">
      <FormMessage state={state} />
      <div>
        <p className="label">Qual documento chegou?</p>
        <Select name="document_id" aria-label="Documento" defaultValue={docs[0]?.value} options={docs} />
        {state.errors?.document_id && <p className="field-error">{state.errors.document_id}</p>}
      </div>
      <p className="text-xs text-muted">O documento sai das pendências, os lembretes param e esta mensagem fica salva no cliente como comprovante.</p>
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />} Confirmar recebimento
      </button>
    </form>
  );
}

// ---------------- Classificação do e-mail ----------------

const CATEGORY_LABEL = { cliente: "Clientes", empresa: "Empresas", pessoa: "Pessoas", separado: "Separados" } as const;
type Category = keyof typeof CATEGORY_LABEL;

/** "Não é promoção" / "Mover para Separados" / mover para outra pasta — vale para os próximos e-mails. */
export function CategoryControl({
  current,
  domain,
  action,
}: {
  current: Category | null;
  domain: string;
  action: (category: string, scope: "endereco" | "dominio") => Promise<ActionState>;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  const [scope, setScope] = useState<"endereco" | "dominio">("endereco");
  const router = useRouter();
  const run = (category: Category) =>
    start(async () => {
      const r = await action(category, scope);
      setResult(r);
      if (r.ok) router.refresh();
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {current === "separado" ? (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={pending} onClick={() => run("empresa")}>
            {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-ok" />} Não é promoção
          </button>
        ) : (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={pending} onClick={() => run("separado")}>
            {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <MailX className="h-3.5 w-3.5" />} Mover para Separados
          </button>
        )}
        <span className="text-xs text-muted">ou mover para</span>
        {(["cliente", "empresa", "pessoa"] as Category[]).filter((c) => c !== current).map((c) => (
          <button key={c} type="button" disabled={pending} onClick={() => run(c)}
            className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold transition hover:border-brand-500 hover:text-link">
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={scope === "dominio"} onChange={(e) => setScope(e.target.checked ? "dominio" : "endereco")} className="h-3.5 w-3.5 accent-brand-600" />
        Aplicar a todo o domínio <strong className="text-ink">@{domain}</strong> (não só a este remetente)
      </label>
      {result?.message && <p className="text-xs font-semibold text-ok">{result.message}</p>}
      {result?.errors?._form && <p className="text-xs text-danger">{result.errors._form}</p>}
    </div>
  );
}

export function EmptyReader({ email }: { email: boolean }) {
  return (
    <div className="m-auto max-w-sm p-8 text-center">
      <span className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl ${email ? "bg-info-soft text-info" : "bg-brand-50 text-link"}`}><Inbox className="h-8 w-8" /></span>
      <p className="mt-4 text-lg font-extrabold">{email ? "Escolha um e-mail" : "Escolha uma conversa"}</p>
      <p className="mt-1 text-sm text-muted">
        {email
          ? "Só os e-mails importantes aparecem aqui. Promoções e avisos automáticos ficam em “Separados”."
          : "WhatsApp e e-mail no mesmo lugar. Salve mensagens no cliente, abra tickets e confirme documentos recebidos sem sair da conversa."}
      </p>
    </div>
  );
}
