"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, BookmarkPlus, Clipboard, ClipboardCheck, FileCheck2, LoaderCircle, MoreHorizontal, SendHorizontal, Ticket, X } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { Alert, FormMessage } from "@/components/page-header";
import { Select, type SelectOption } from "@/components/ui/select";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Atualiza a tela a cada 10 s (quando visível) e busca e-mails novos a cada minuto. */
export function AutoRefresh({ syncEmail }: { syncEmail: (() => Promise<ActionState>) | null }) {
  const router = useRouter();
  useEffect(() => {
    let lastSync = 0;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (syncEmail && Date.now() - lastSync > 60_000) {
        lastSync = Date.now();
        await syncEmail().catch(() => undefined);
      }
      router.refresh();
    };
    const t = setInterval(tick, 10_000);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    void tick();
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, syncEmail]);
  return null;
}

/** Ao abrir a conversa, zera as não lidas. */
export function MarkRead({ id, unread, action }: { id: string; unread: number; action: (id: string) => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    if (unread > 0) action(id).then(() => router.refresh());
  }, [id, unread, action, router]);
  return null;
}

/** Mantém a conversa rolada até a última mensagem. */
export function ScrollToEnd({ watch, className, children }: { watch: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [watch]);
  return (
    <div ref={ref} className={className} aria-live="polite">
      {children}
    </div>
  );
}

export function LinkClient({ current, clients, action }: { current: string; clients: SelectOption[]; action: (clientId: string) => Promise<ActionState> }) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
      <Select
        size="sm"
        aria-label="Cliente desta conversa"
        searchable
        value={value}
        disabled={pending}
        placeholder="Ligar a um cliente…"
        options={[{ value: "", label: "Sem cliente", hint: "Conversa ainda não ligada", badge: "—" }, ...clients]}
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

/** Campo de resposta. Enter envia; Shift+Enter quebra linha. */
export function Composer({ action, kind, windowOpen, windowEndsAt }: { action: Action; kind: "whatsapp" | "email"; windowOpen: boolean; windowEndsAt: string | null }) {
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  // Limpa o campo só depois que o servidor confirmar o envio
  const [state, dispatch, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) {
      setBody("");
      setSubject("");
    }
    return r;
  }, {});
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
      {kind === "email" && (
        <input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto (padrão: Re: assunto do último e-mail)"
          className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" aria-label="Assunto" />
      )}
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
          placeholder={kind === "whatsapp" ? "Escreva uma mensagem" : "Escreva a resposta do e-mail"}
          aria-label="Mensagem"
          className="max-h-44 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-[15px] outline-none focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-500/15"
        />
        <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-sm transition hover:bg-brand-500 disabled:opacity-50"
          disabled={pending || !body.trim()} aria-label="Enviar">
          {pending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
        </button>
      </div>
      <p className="text-[11px] text-muted">Enter envia · Shift+Enter quebra a linha{kind === "whatsapp" && windowEndsAt ? ` · janela de 24h até ${windowEndsAt}` : ""}</p>
    </form>
  );
}

/** Ações de uma mensagem: salvar no cliente, abrir ticket, documento recebido, copiar. */
export function MessageMenu({
  messageId,
  ticketHref,
  body,
  clients,
  defaultClient,
  docs,
  saveAction,
  docAction,
}: {
  messageId: string;
  ticketHref: string;
  body: string;
  clients: SelectOption[];
  defaultClient: string;
  docs: SelectOption[];
  saveAction: Action;
  docAction: Action;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "save" | "doc">("menu");
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        onClick={() => { setMode("menu"); setOpen(true); }}
        className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted opacity-0 transition group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
        aria-label="Ações da mensagem"
        data-message={messageId}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby={`${uid}-t`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] overflow-visible rounded-2xl border border-line bg-surface p-0 text-ink shadow-(--shadow-lift) backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      >
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 id={`${uid}-t`} className="text-lg font-extrabold">
              {mode === "save" ? "Salvar no cliente" : mode === "doc" ? "Documento recebido" : "Mensagem"}
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Fechar"><X className="h-5 w-5" /></button>
          </div>
          {body && <blockquote className="mb-4 line-clamp-4 rounded-xl border-l-4 border-brand-500 bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap">{body}</blockquote>}

          {mode === "menu" && (
            <div className="space-y-1">
              <button type="button" className={item} onClick={() => setMode("save")}>
                <BookmarkPlus className="h-4 w-4 text-link" /> Salvar no cliente
                <span className="ml-auto text-xs font-normal text-muted">fica no histórico</span>
              </button>
              <Link href={ticketHref} className={item}>
                <Ticket className="h-4 w-4 text-link" /> Abrir ticket com esta mensagem
              </Link>
              <button type="button" className={item} onClick={() => setMode("doc")} disabled={!docs.length}>
                <FileCheck2 className="h-4 w-4 text-link" /> Marcar documento como recebido
                <span className="ml-auto text-xs font-normal text-muted">{docs.length ? `${docs.length} pendente(s)` : "nenhum pendente"}</span>
              </button>
              <button type="button" className={item} disabled={!body}
                onClick={async () => { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <ClipboardCheck className="h-4 w-4 text-ok" /> : <Clipboard className="h-4 w-4 text-link" />} {copied ? "Copiado" : "Copiar texto"}
              </button>
            </div>
          )}
          {mode === "save" && <SaveForm action={saveAction} clients={clients} defaultClient={defaultClient} onDone={() => setOpen(false)} />}
          {mode === "doc" && <DocForm action={docAction} docs={docs} onDone={() => setOpen(false)} />}
        </div>
      </dialog>
    </>
  );
}

function SaveForm({ action, clients, defaultClient, onDone }: { action: Action; clients: SelectOption[]; defaultClient: string; onDone: () => void }) {
  const [state, dispatch, pending] = useActionState(action, {});
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      const t = setTimeout(onDone, 900);
      return () => clearTimeout(t);
    }
  }, [state, router, onDone]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)); }} className="space-y-3">
      <FormMessage state={state} />
      <div>
        <p className="label">Cliente</p>
        <Select name="client_id" aria-label="Cliente" searchable defaultValue={defaultClient} placeholder="Escolha o cliente…" options={clients} />
        {state.errors?.client_id && <p className="field-error">{state.errors.client_id}</p>}
      </div>
      <div>
        <label className="label" htmlFor="save-note">Observação (opcional)</label>
        <input id="save-note" name="note" className="input" placeholder="Ex.: confirmação do pagamento das guias" />
      </div>
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />} Salvar no cliente
      </button>
    </form>
  );
}

function DocForm({ action, docs, onDone }: { action: Action; docs: SelectOption[]; onDone: () => void }) {
  const [state, dispatch, pending] = useActionState(action, {});
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
  }, [state, router, onDone]);
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
