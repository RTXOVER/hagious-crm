import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Inbox, Mail, MessageCircle, PlugZap, Search, Smartphone } from "lucide-react";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFormatter } from "@/lib/preferences-server";
import { isUuid } from "@/lib/validation/ids";
import { nowIso } from "@/lib/dates";
import {
  setArchivedAction,
  linkClientAction,
  markReadAction,
  receiveDocumentFromMessageAction,
  saveMessageAction,
  sendMessageAction,
  syncEmailNowAction,
} from "./actions";
import { AutoRefresh, Composer, LinkClient, MarkRead, MessageMenu, ScrollToEnd, ArchiveButton } from "./inbox-client";

export const metadata: Metadata = { title: "Conversas" };

const CHANNELS = [
  { key: "todos", label: "Todas" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "E-mail" },
] as const;
const FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "nao_lidas", label: "Não lidas" },
  { key: "sem_cliente", label: "Sem cliente" },
  { key: "arquivadas", label: "Arquivadas" },
] as const;
type Channel = (typeof CHANNELS)[number]["key"];
type Filter = (typeof FILTERS)[number]["key"];

const WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_TICK: Record<string, { label: string; cls: string }> = {
  enviando: { label: "Enviando…", cls: "text-muted" },
  enviada: { label: "✓ Enviada", cls: "text-muted" },
  entregue: { label: "✓✓ Entregue", cls: "text-muted" },
  lida: { label: "✓✓ Lida", cls: "text-info" },
  falhou: { label: "! Falhou", cls: "text-danger" },
};

const initials = (s: string) =>
  s.replace(/[^\p{L}\s]/gu, " ").split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "#";
const showAddress = (kind: string, a: string) =>
  kind === "whatsapp" && a.length >= 12 ? `+${a.slice(0, 2)} (${a.slice(2, 4)}) ${a.slice(4, -4)}-${a.slice(-4)}` : a;

export default async function ConversationsPage(props: PageProps<"/conversas">) {
  const [sp, profile, f] = await Promise.all([props.searchParams, requireProfile(), getFormatter()]);
  const channel: Channel = CHANNELS.some((c) => c.key === sp.canal) ? (sp.canal as Channel) : "todos";
  const filter: Filter = FILTERS.some((x) => x.key === sp.filtro) ? (sp.filtro as Filter) : "todas";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const selectedId = typeof sp.c === "string" && isUuid(sp.c) ? sp.c : null;
  const supabase = await createClient();

  let list = supabase
    .from("conversations")
    .select("id, kind, contact_name, contact_address, last_preview, last_message_at, unread_count, is_demo, client:clients(id, legal_name)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(150);
  list = filter === "arquivadas" ? list.eq("archived", true) : list.eq("archived", false);
  if (channel !== "todos") list = list.eq("kind", channel);
  if (filter === "nao_lidas") list = list.gt("unread_count", 0);
  if (filter === "sem_cliente") list = list.is("client_id", null);
  if (q) {
    const safe = q.replace(/[,()*%\\:"]/g, " ").trim();
    list = list.or(`contact_name.ilike.%${safe}%,contact_address.ilike.%${safe.replace(/\D/g, "") || safe}%,last_preview.ilike.%${safe}%`);
  }

  const [{ data: accounts }, { data: conversations }, convRes] = await Promise.all([
    supabase.from("channel_accounts").select("id, kind, label, address, status, is_demo, last_error").order("created_at"),
    list,
    selectedId
      ? supabase
          .from("conversations")
          .select("*, client:clients(id, legal_name), account:channel_accounts(label, status, is_demo)")
          .eq("id", selectedId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const conv = convRes.data;
  if (selectedId && !conv) notFound();

  const [messagesRes, clientsRes, peopleRes, docsRes] = conv
    ? await Promise.all([
        supabase.from("messages").select("*").eq("conversation_id", conv.id).order("sent_at", { ascending: false }).limit(300),
        supabase.from("clients").select("id, legal_name, trade_name").neq("status", "encerrado").order("legal_name").limit(2000),
        supabase.from("profiles").select("id, full_name"),
        conv.client_id
          ? supabase.from("client_documents").select("id, title, due_date").eq("client_id", conv.client_id).eq("status", "pendente").order("due_date").limit(30)
          : Promise.resolve({ data: [] as { id: string; title: string; due_date: string }[] }),
      ])
    : [null, null, null, null];
  const messages = [...(messagesRes?.data ?? [])].reverse();
  const nameOf = new Map((peopleRes?.data ?? []).map((p) => [p.id, p.full_name]));
  const connected = (accounts ?? []).filter((a) => a.status === "conectado");
  const hasEmail = connected.some((a) => a.kind === "email" && !a.is_demo);
  const now = nowIso();
  const windowOpen = conv?.kind === "whatsapp" && !!conv.last_inbound_at && Date.parse(now) - Date.parse(conv.last_inbound_at) < WINDOW_MS;

  const href = (p: Partial<{ canal: Channel; filtro: Filter; c: string | null }>) => {
    const s = new URLSearchParams();
    const ch = p.canal ?? channel;
    const fl = p.filtro ?? filter;
    if (ch !== "todos") s.set("canal", ch);
    if (fl !== "todas") s.set("filtro", fl);
    if (q) s.set("q", q);
    const c = p.c === undefined ? selectedId : p.c;
    if (c) s.set("c", c);
    const str = s.toString();
    return str ? `/conversas?${str}` : "/conversas";
  };
  const when = (iso: string | null) => {
    if (!iso) return "";
    return f.dateOf(iso) === f.dateOf(now) ? f.time(iso) : f.dateOf(iso).slice(0, 5);
  };

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4.25rem)] min-h-[34rem] md:-mx-8 md:-my-8">
      <AutoRefresh syncEmail={hasEmail ? syncEmailNowAction : null} />

      {/* ---------------- Lista ---------------- */}
      <aside className={`flex w-full shrink-0 flex-col border-r border-line bg-surface md:w-[22rem] ${conv ? "hidden md:flex" : "flex"}`}>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-extrabold tracking-tight">Conversas</h1>
            <Link href="/conversas/conexoes" className="btn-secondary px-2.5 py-1.5 text-xs" title="Canais conectados">
              <PlugZap className="h-3.5 w-3.5" /> Canais
            </Link>
          </div>
          <form role="search" className="relative">
            {channel !== "todos" && <input type="hidden" name="canal" value={channel} />}
            {filter !== "todas" && <input type="hidden" name="filtro" value={filter} />}
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={q} placeholder="Buscar nome, número ou texto" aria-label="Buscar conversas"
              className="w-full rounded-xl border border-line bg-surface-2 py-2 pr-3 pl-9 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
          </form>
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Canal">
            {CHANNELS.map((c) => (
              <Link key={c.key} href={href({ canal: c.key, c: null })} role="tab" aria-selected={channel === c.key}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition ${channel === c.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                {c.key === "whatsapp" && <MessageCircle className="h-3.5 w-3.5" />}
                {c.key === "email" && <Mail className="h-3.5 w-3.5" />}
                {c.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((x) => (
              <Link key={x.key} href={href({ filtro: x.key, c: null })}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${filter === x.key ? "border-brand-500 bg-brand-50 text-link" : "border-line text-muted hover:border-brand-500/60 hover:text-ink"}`}>
                {x.label}
              </Link>
            ))}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto" aria-label="Lista de conversas">
          {!connected.length && (
            <li className="p-6 text-center text-sm">
              <PlugZap className="mx-auto h-8 w-8 text-muted" />
              <p className="mt-2 font-semibold">Nenhum canal conectado</p>
              <p className="mt-1 text-muted">Conecte o WhatsApp da empresa ou uma caixa de e-mail para as mensagens aparecerem aqui.</p>
              <Link href="/conversas/conexoes" className="btn-primary mt-4">Conectar canais</Link>
            </li>
          )}
          {connected.length > 0 && !conversations?.length && (
            <li className="p-6 text-center text-sm text-muted">Nenhuma conversa {filter !== "todas" ? "neste filtro" : "ainda"}.</li>
          )}
          {(conversations ?? []).map((c) => {
            const name = c.contact_name || showAddress(c.kind, c.contact_address);
            const active = c.id === selectedId;
            return (
              <li key={c.id}>
                <Link href={href({ c: c.id })} aria-current={active ? "true" : undefined}
                  className={`flex gap-3 border-b border-line/60 px-4 py-3 transition ${active ? "bg-brand-50" : "hover:bg-surface-2"}`}>
                  <span className="relative h-11 w-11 shrink-0 self-start">
                    <span className={`grid h-11 w-11 place-items-center rounded-full text-sm font-extrabold ${c.kind === "whatsapp" ? "bg-[#d9f5e6] text-[#0f6b3f]" : "bg-info-soft text-info"}`}>
                      {initials(name)}
                    </span>
                    <span className={`absolute -right-0.5 -bottom-0.5 grid h-5 w-5 place-items-center rounded-full ring-2 ring-surface ${c.kind === "whatsapp" ? "bg-[#25d366] text-white" : "bg-info text-white"}`}>
                      {c.kind === "whatsapp" ? <MessageCircle className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread_count ? "font-extrabold" : "font-semibold"}`}>{name}</span>
                      <span className={`shrink-0 text-[11px] tabular-nums ${c.unread_count ? "font-bold text-link" : "text-muted"}`}>{when(c.last_message_at)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={`truncate text-xs ${c.unread_count ? "text-ink" : "text-muted"}`}>{c.last_preview ?? "—"}</span>
                      {c.unread_count > 0 && (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white">{c.unread_count}</span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.client ? (
                        <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                          <Building2 className="h-3 w-3 shrink-0" /> {c.client.legal_name}
                        </span>
                      ) : (
                        <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn">Sem cliente</span>
                      )}
                      {c.is_demo && <span className="rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info">Demonstração</span>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ---------------- Conversa aberta ---------------- */}
      <section className={`min-w-0 flex-1 flex-col bg-canvas ${conv ? "flex" : "hidden md:flex"}`}>
        {!conv ? (
          <div className="m-auto max-w-sm p-8 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-link"><Inbox className="h-8 w-8" /></span>
            <p className="mt-4 text-lg font-extrabold">Escolha uma conversa</p>
            <p className="mt-1 text-sm text-muted">
              WhatsApp e e-mail no mesmo lugar. Salve mensagens no cliente, abra tickets e confirme documentos recebidos sem sair da conversa.
            </p>
          </div>
        ) : (
          <>
            <MarkRead id={conv.id} unread={conv.unread_count} action={markReadAction} />
            <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
              <Link href={href({ c: null })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 md:hidden" aria-label="Voltar para a lista">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-extrabold ${conv.kind === "whatsapp" ? "bg-[#d9f5e6] text-[#0f6b3f]" : "bg-info-soft text-info"}`}>
                {initials(conv.contact_name || conv.contact_address)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{conv.contact_name || showAddress(conv.kind, conv.contact_address)}</p>
                <p className="truncate text-xs text-muted">
                  {conv.kind === "whatsapp" ? "WhatsApp" : "E-mail"} · {showAddress(conv.kind, conv.contact_address)} · {conv.account?.label}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <LinkClient
                  current={conv.client_id ?? ""}
                  clients={(clientsRes?.data ?? []).map((c) => ({ value: c.id, label: c.legal_name, hint: c.trade_name ?? undefined }))}
                  action={linkClientAction.bind(null, conv.id)}
                />
                {conv.client && (
                  <Link href={`/clientes/${conv.client.id}`} className="btn-secondary px-2.5 py-2 text-xs" title="Abrir cliente">
                    <Building2 className="h-4 w-4" />
                  </Link>
                )}
                <ArchiveButton archived={conv.archived} action={setArchivedAction.bind(null, conv.id, !conv.archived)} />
              </div>
            </header>

            <ScrollToEnd watch={messages.length} className="flex-1 space-y-2 overflow-y-auto px-4 py-5 sm:px-8">
              {conv.is_demo && (
                <p className="mx-auto mb-3 w-fit rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
                  Conversa de demonstração: as mensagens não saem do sistema.
                </p>
              )}
              {messages.map((m, i) => {
                const day = f.dateOf(m.sent_at);
                const newDay = i === 0 || f.dateOf(messages[i - 1].sent_at) !== day;
                const out = m.direction === "saida";
                const tick = out ? STATUS_TICK[m.status] : null;
                const attachments = (m.media as { attachments?: { filename: string }[] } | null)?.attachments;
                const ticketHref = `/tickets/novo?${new URLSearchParams({
                  ...(conv.client_id ? { cliente: conv.client_id } : {}),
                  origem: conv.kind === "whatsapp" ? "whatsapp" : "email",
                  titulo: (m.subject || m.body || "").replace(/\s+/g, " ").slice(0, 80),
                  descricao: `${m.subject ? `${m.subject}\n\n` : ""}${m.body ?? ""}`.slice(0, 1500),
                }).toString()}`;
                return (
                  <div key={m.id}>
                    {newDay && (
                      <p className="sticky top-0 z-10 mx-auto my-3 w-fit rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-muted shadow-sm ring-1 ring-line">{day}</p>
                    )}
                    <div className={`group flex items-end gap-1.5 ${out ? "justify-end" : "justify-start"}`}>
                      {out && (
                        <MessageMenu
                          messageId={m.id}
                          ticketHref={ticketHref}
                          body={m.body ?? ""}
                          clients={(clientsRes?.data ?? []).map((c) => ({ value: c.id, label: c.legal_name }))}
                          defaultClient={conv.client_id ?? ""}
                          docs={(docsRes?.data ?? []).map((d) => ({ value: d.id, label: d.title, hint: `vence ${f.date(d.due_date)}` }))}
                          saveAction={saveMessageAction.bind(null, m.id)}
                          docAction={receiveDocumentFromMessageAction.bind(null, m.id)}
                        />
                      )}
                      <div
                        className={`max-w-[min(36rem,85%)] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                          out ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-surface text-ink ring-1 ring-line"
                        }`}
                      >
                        {m.subject && <p className={`mb-1 font-bold ${out ? "text-white" : ""}`}>{m.subject}</p>}
                        {m.body ? (
                          <p className={`break-words whitespace-pre-wrap ${m.kind === "email" ? "max-h-72 overflow-y-auto" : ""}`}>{m.body}</p>
                        ) : (
                          <p className="italic opacity-80">[{m.kind}]</p>
                        )}
                        {attachments?.length ? (
                          <p className={`mt-1 text-xs ${out ? "text-white/80" : "text-muted"}`}>📎 {attachments.map((a) => a.filename).join(", ")}</p>
                        ) : null}
                        <p className={`mt-1 flex items-center justify-end gap-2 text-[10.5px] ${out ? "text-white/75" : "text-muted"}`}>
                          {m.via === "app" && <span className="inline-flex items-center gap-0.5"><Smartphone className="h-3 w-3" /> pelo celular</span>}
                          {m.via === "historico" && <span>histórico</span>}
                          {out && m.sent_by && <span>{nameOf.get(m.sent_by)?.split(" ")[0]}</span>}
                          <span className="tabular-nums">{f.time(m.sent_at)}</span>
                          {tick && <span className={out ? "font-bold text-white" : tick.cls} title={m.error ?? undefined}>{tick.label}</span>}
                        </p>
                        {m.status === "falhou" && m.error && <p className="mt-1 rounded-md bg-black/15 px-2 py-1 text-[11px]">{m.error}</p>}
                      </div>
                      {!out && (
                        <MessageMenu
                          messageId={m.id}
                          ticketHref={ticketHref}
                          body={m.body ?? ""}
                          clients={(clientsRes?.data ?? []).map((c) => ({ value: c.id, label: c.legal_name }))}
                          defaultClient={conv.client_id ?? ""}
                          docs={(docsRes?.data ?? []).map((d) => ({ value: d.id, label: d.title, hint: `vence ${f.date(d.due_date)}` }))}
                          saveAction={saveMessageAction.bind(null, m.id)}
                          docAction={receiveDocumentFromMessageAction.bind(null, m.id)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </ScrollToEnd>

            <footer className="border-t border-line bg-surface px-4 py-3">
              {conv.account?.status !== "conectado" ? (
                <p className="text-sm text-muted">Canal desconectado. {isAdmin(profile) ? <Link href="/conversas/conexoes" className="link">Reconectar</Link> : "Peça a um administrador para reconectar."}</p>
              ) : (
                <Composer
                  action={sendMessageAction.bind(null, conv.id)}
                  kind={conv.kind}
                  windowOpen={conv.kind === "email" || windowOpen}
                  windowEndsAt={conv.kind === "whatsapp" && conv.last_inbound_at ? f.dateTime(new Date(Date.parse(conv.last_inbound_at) + WINDOW_MS).toISOString()) : null}
                />
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
