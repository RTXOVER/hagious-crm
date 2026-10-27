import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, Building2, BriefcaseBusiness, Mail, MailX, MessageCircle, Paperclip, PlugZap, Search, Smartphone, Star, UserRound, Archive,
} from "lucide-react";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFormatter } from "@/lib/preferences-server";
import { isUuid } from "@/lib/validation/ids";
import { nowIso } from "@/lib/dates";
import {
  linkClientAction,
  listClientsForPickerAction,
  markReadAction,
  receiveDocumentFromMessageAction,
  saveMessageAction,
  sendMessageAction,
  setArchivedAction,
  setEmailCategoryAction,
  syncEmailNowAction,
} from "./actions";
import {
  ArchiveButton, AutoRefresh, CategoryControl, Composer, EmailComposer, EmptyReader, LinkClient, MarkRead, MessageActionsProvider, MessageMenu, ScrollToEnd,
} from "./inbox-client";

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
/** Pastas do e-mail (classificação automática; "Separados" = promoções e avisos automáticos) */
const FOLDERS = [
  { key: "importantes", label: "Importantes", hint: "Clientes, empresas e pessoas", icon: Star, cats: ["cliente", "empresa", "pessoa"] },
  { key: "clientes", label: "Clientes", hint: "Remetentes ligados a clientes", icon: Building2, cats: ["cliente"] },
  { key: "empresas", label: "Empresas", hint: "Fornecedores, órgãos, parceiros", icon: BriefcaseBusiness, cats: ["empresa"] },
  { key: "pessoas", label: "Pessoas", hint: "E-mails pessoais", icon: UserRound, cats: ["pessoa"] },
  { key: "separados", label: "Separados", hint: "Promoções e avisos automáticos", icon: MailX, cats: ["separado"] },
  { key: "arquivados", label: "Arquivados", hint: "Tirados da caixa", icon: Archive, cats: [] },
] as const;
type Channel = (typeof CHANNELS)[number]["key"];
type Filter = (typeof FILTERS)[number]["key"];
type Folder = (typeof FOLDERS)[number]["key"];

const CATEGORY_CHIP: Record<string, { label: string; cls: string }> = {
  cliente: { label: "Cliente", cls: "bg-ok-soft text-ok" },
  empresa: { label: "Empresa", cls: "bg-info-soft text-info" },
  pessoa: { label: "Pessoa", cls: "bg-neutral-soft text-muted" },
  separado: { label: "Separado", cls: "bg-warn-soft text-warn" },
};
const WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_TICK: Record<string, string> = { enviando: "Enviando…", enviada: "✓ Enviada", entregue: "✓✓ Entregue", lida: "✓✓ Lida", falhou: "! Falhou" };

const initials = (s: string) =>
  s.replace(/[^\p{L}\s]/gu, " ").split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "#";
const showAddress = (kind: string, a: string) =>
  kind === "whatsapp" && a.length >= 12 ? `+${a.slice(0, 2)} (${a.slice(2, 4)}) ${a.slice(4, -4)}-${a.slice(-4)}` : a;
/** Prévia de e-mail é "Assunto — trecho": separa para mostrar em duas linhas */
const splitPreview = (p: string | null) => {
  const [subject, ...rest] = (p ?? "").split(" — ");
  return { subject: subject || "(sem assunto)", snippet: rest.join(" — ") };
};

export default async function ConversationsPage(props: PageProps<"/conversas">) {
  const [sp, profile, f] = await Promise.all([props.searchParams, requireProfile(), getFormatter()]);
  const channel: Channel = CHANNELS.some((c) => c.key === sp.canal) ? (sp.canal as Channel) : "todos";
  const filter: Filter = FILTERS.some((x) => x.key === sp.filtro) ? (sp.filtro as Filter) : "todas";
  const folder: Folder = FOLDERS.some((x) => x.key === sp.pasta) ? (sp.pasta as Folder) : "importantes";
  const emailMode = channel === "email";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const selectedId = typeof sp.c === "string" && isUuid(sp.c) ? sp.c : null;
  const supabase = await createClient();
  const now = nowIso();

  let list = supabase
    .from("conversations")
    .select("id, kind, contact_name, contact_address, last_preview, last_message_at, unread_count, is_demo, category, client:clients(id, legal_name)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(150);
  if (emailMode) {
    const fd = FOLDERS.find((x) => x.key === folder)!;
    list = list.eq("kind", "email");
    list = folder === "arquivados" ? list.eq("archived", true) : list.eq("archived", false).in("category", [...fd.cats]);
  } else {
    list = filter === "arquivadas" ? list.eq("archived", true) : list.eq("archived", false);
    if (channel === "whatsapp") list = list.eq("kind", "whatsapp");
    // Na aba "Todas" e no WhatsApp, e-mails "Separados" (promoções e avisos) não aparecem
    else list = list.or("kind.eq.whatsapp,category.is.null,category.neq.separado");
    if (filter === "nao_lidas") list = list.gt("unread_count", 0);
    if (filter === "sem_cliente") list = list.is("client_id", null);
  }
  if (q) {
    const safe = q.replace(/[,()*%\\:"]/g, " ").trim();
    if (safe) list = list.or(`contact_name.ilike.%${safe}%,contact_address.ilike.%${safe.replace(/\D/g, "") || safe}%,last_preview.ilike.%${safe}%`);
  }

  const [{ data: accounts }, { data: conversations }, convRes, folderRes] = await Promise.all([
    supabase.from("channel_accounts").select("id, kind, label, address, status, is_demo").order("created_at"),
    list,
    selectedId
      ? supabase.from("conversations").select("*, client:clients(id, legal_name), account:channel_accounts(label, address, status, is_demo)").eq("id", selectedId).maybeSingle()
      : Promise.resolve({ data: null }),
    emailMode
      ? supabase.from("conversations").select("category, unread_count, archived").eq("kind", "email").limit(5000)
      : Promise.resolve({ data: null as { category: string | null; unread_count: number; archived: boolean }[] | null }),
  ]);
  const conv = convRes.data;
  if (selectedId && !conv) notFound();

  const [messagesRes, peopleRes, docsRes] = conv
    ? await Promise.all([
        supabase.from("messages").select("*").eq("conversation_id", conv.id).order("sent_at", { ascending: false }).limit(300),
        supabase.from("profiles").select("id, full_name"),
        conv.client_id
          ? supabase.from("client_documents").select("id, title, due_date").eq("client_id", conv.client_id).eq("status", "pendente").order("due_date").limit(30)
          : Promise.resolve({ data: [] as { id: string; title: string; due_date: string }[] }),
      ])
    : [null, null, null];
  const messages = [...(messagesRes?.data ?? [])].reverse();
  const nameOf = new Map((peopleRes?.data ?? []).map((p) => [p.id, p.full_name]));
  const connected = (accounts ?? []).filter((a) => a.status !== "desconectado");
  const hasEmail = connected.some((a) => a.kind === "email" && !a.is_demo);
  const windowOpen = conv?.kind === "whatsapp" && !!conv.last_inbound_at && Date.parse(now) - Date.parse(conv.last_inbound_at) < WINDOW_MS;
  const lastMsg = messages[messages.length - 1];

  // Contadores das pastas de e-mail
  const counts = new Map<string, { total: number; unread: number }>();
  for (const r of folderRes.data ?? []) {
    const key = r.archived ? "arquivados" : FOLDERS.find((x) => x.key !== "importantes" && (x.cats as readonly string[]).includes(r.category ?? ""))?.key;
    for (const k of [key, !r.archived && r.category !== "separado" && r.category ? "importantes" : null]) {
      if (!k) continue;
      const c = counts.get(k) ?? { total: 0, unread: 0 };
      c.total++;
      if (r.unread_count > 0) c.unread++;
      counts.set(k, c);
    }
  }

  const href = (p: Partial<{ canal: Channel; filtro: Filter; pasta: Folder; c: string | null }>) => {
    const s = new URLSearchParams();
    const ch = p.canal ?? channel;
    if (ch !== "todos") s.set("canal", ch);
    if (ch === "email") {
      const pa = p.pasta ?? folder;
      if (pa !== "importantes") s.set("pasta", pa);
    } else {
      const fl = p.filtro ?? filter;
      if (fl !== "todas") s.set("filtro", fl);
    }
    if (q) s.set("q", q);
    const c = p.c === undefined ? selectedId : p.c;
    if (c) s.set("c", c);
    const str = s.toString();
    return str ? `/conversas?${str}` : "/conversas";
  };
  const when = (iso: string | null) => (!iso ? "" : f.dateOf(iso) === f.dateOf(now) ? f.time(iso) : f.dayMonth(iso));
  const ticketHref = (m: { subject: string | null; body: string | null }) =>
    `/tickets/novo?${new URLSearchParams({
      ...(conv?.client_id ? { cliente: conv.client_id } : {}),
      origem: conv?.kind === "whatsapp" ? "whatsapp" : "email",
      titulo: (m.subject || m.body || "").replace(/\s+/g, " ").slice(0, 80),
      descricao: `${m.subject ? `${m.subject}\n\n` : ""}${m.body ?? ""}`.slice(0, 1500),
    }).toString()}`;
  const lastInboundSubject = [...messages].reverse().find((m) => m.direction === "entrada" && m.subject)?.subject ?? lastMsg?.subject ?? "";
  const replySubject = lastInboundSubject ? (/^re:/i.test(lastInboundSubject) ? lastInboundSubject : `Re: ${lastInboundSubject}`) : "Mensagem da Hagious";

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4.25rem)] min-h-[34rem] md:-mx-8 md:-my-8">
      <AutoRefresh syncEmail={hasEmail ? syncEmailNowAction : null} />

      {/* ---------------- Pastas do e-mail (só no modo e-mail, computador) ---------------- */}
      {emailMode && (
        <nav aria-label="Pastas do e-mail" className="hidden w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface-2 p-3 lg:flex">
          <p className="px-2 pt-1 pb-2 text-[11px] font-bold tracking-wider text-muted uppercase">Caixa de e-mail</p>
          {FOLDERS.map(({ key, label, hint, icon: Icon }) => {
            const c = counts.get(key);
            const on = folder === key;
            return (
              <Link key={key} href={href({ pasta: key, c: null })} aria-current={on ? "page" : undefined} title={hint}
                className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${on ? "bg-info text-white shadow-sm" : "text-ink hover:bg-surface"}`}>
                <Icon className={`h-4 w-4 shrink-0 ${on ? "text-white" : key === "separados" ? "text-warn" : "text-info"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${c?.unread ? "font-extrabold" : "font-semibold"}`}>{label}</span>
                  <span className={`block truncate text-[11px] ${on ? "text-white/80" : "text-muted"}`}>{hint}</span>
                </span>
                {c?.unread ? (
                  <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${on ? "bg-white/25" : "bg-info text-white"}`}>{c.unread}</span>
                ) : c?.total ? (
                  <span className={`text-[11px] tabular-nums ${on ? "text-white/80" : "text-muted"}`}>{c.total}</span>
                ) : null}
              </Link>
            );
          })}
          <p className="mt-auto px-2 text-[11px] leading-snug text-muted">
            A separação é automática (remetente, domínio e sinais de envio em massa). Corrija num e-mail e o sistema lembra.
          </p>
        </nav>
      )}

      {/* ---------------- Lista ---------------- */}
      <aside className={`flex w-full shrink-0 flex-col border-r border-line bg-surface md:w-[22rem] ${conv ? "hidden md:flex" : "flex"}`}>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-extrabold tracking-tight">{emailMode ? "E-mail" : "Conversas"}</h1>
            <Link href="/conversas/conexoes" className="btn-secondary px-2.5 py-1.5 text-xs" title="Canais conectados">
              <PlugZap className="h-3.5 w-3.5" /> Canais
            </Link>
          </div>
          <form role="search" className="relative">
            {channel !== "todos" && <input type="hidden" name="canal" value={channel} />}
            {emailMode ? folder !== "importantes" && <input type="hidden" name="pasta" value={folder} /> : filter !== "todas" && <input type="hidden" name="filtro" value={filter} />}
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={q} key={q} placeholder={emailMode ? "Buscar remetente, assunto ou texto" : "Buscar nome, número ou texto"} aria-label="Buscar conversas"
              className="w-full rounded-xl border border-line bg-surface-2 py-2 pr-3 pl-9 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
          </form>
          <nav className="flex gap-1 rounded-xl bg-surface-2 p-1" aria-label="Canal">
            {CHANNELS.map((c) => (
              <Link key={c.key} href={href({ canal: c.key, c: null })} aria-current={channel === c.key ? "page" : undefined}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition ${
                  channel === c.key ? (c.key === "email" ? "bg-info text-white shadow-sm" : c.key === "whatsapp" ? "bg-brand-600 text-white shadow-sm" : "bg-surface text-ink shadow-sm") : "text-muted hover:text-ink"
                }`}>
                {c.key === "whatsapp" && <MessageCircle className="h-3.5 w-3.5" />}
                {c.key === "email" && <Mail className="h-3.5 w-3.5" />}
                {c.label}
              </Link>
            ))}
          </nav>
          {emailMode ? (
            // Pastas em formato compacto (celular/tablet)
            <div className="flex flex-wrap gap-1.5 lg:hidden">
              {FOLDERS.map((x) => (
                <Link key={x.key} href={href({ pasta: x.key, c: null })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${folder === x.key ? "border-info bg-info-soft text-info" : "border-line text-muted hover:text-ink"}`}>
                  {x.label}{counts.get(x.key)?.unread ? ` · ${counts.get(x.key)!.unread}` : ""}
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((x) => (
                <Link key={x.key} href={href({ filtro: x.key, c: null })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${filter === x.key ? "border-brand-500 bg-brand-50 text-link" : "border-line text-muted hover:border-brand-500/60 hover:text-ink"}`}>
                  {x.label}
                </Link>
              ))}
            </div>
          )}
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
            <li className="p-6 text-center text-sm text-muted">
              {emailMode && folder === "separados" ? "Nenhum e-mail separado." : `Nada ${q ? "encontrado" : "por aqui"}${!emailMode && filter !== "todas" ? " neste filtro" : ""}.`}
            </li>
          )}
          {(conversations ?? []).map((c) => {
            const name = c.contact_name || showAddress(c.kind, c.contact_address);
            const active = c.id === selectedId;
            const isMail = c.kind === "email";
            if (emailMode) {
              const { subject, snippet } = splitPreview(c.last_preview);
              const chip = c.category ? CATEGORY_CHIP[c.category] : null;
              return (
                <li key={c.id}>
                  <Link href={href({ c: c.id })} aria-current={active ? "true" : undefined}
                    className={`relative block border-b border-line/60 px-4 py-3 transition ${active ? "bg-info-soft" : "hover:bg-surface-2"}`}>
                    {c.unread_count > 0 && <span className="absolute top-4 left-1.5 h-2 w-2 rounded-full bg-info" aria-label="Não lido" />}
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread_count ? "font-extrabold" : "font-semibold"}`}>{name}</span>
                      <span className={`shrink-0 text-[11px] tabular-nums ${c.unread_count ? "font-bold text-info" : "text-muted"}`}>{when(c.last_message_at)}</span>
                    </span>
                    <span className={`mt-0.5 block truncate text-[13px] ${c.unread_count ? "font-bold text-ink" : "text-ink"}`}>{subject}</span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-muted">{snippet || "—"}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {chip && <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${chip.cls}`}>{chip.label}</span>}
                      {c.client && <span className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-muted"><Building2 className="h-3 w-3 shrink-0" /> {c.client.legal_name}</span>}
                    </span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={c.id}>
                {/* Cor e faixa por canal: verde = WhatsApp, azul = e-mail */}
                <Link href={href({ c: c.id })} aria-current={active ? "true" : undefined}
                  className={`flex gap-3 border-b border-l-4 border-b-line/60 px-4 py-3 transition ${
                    isMail
                      ? `border-l-info ${active ? "bg-info-soft" : "bg-info-soft/35 hover:bg-info-soft/70"}`
                      : `border-l-[#25d366] ${active ? "bg-ok-soft" : "bg-ok-soft/35 hover:bg-ok-soft/70"}`
                  }`}>
                  <span className="relative h-11 w-11 shrink-0 self-start">
                    <span className={`grid h-11 w-11 place-items-center rounded-full text-sm font-extrabold ${isMail ? "bg-info text-white" : "bg-brand-600 text-white"}`}>
                      {initials(name)}
                    </span>
                    <span className={`absolute -right-0.5 -bottom-0.5 grid h-5 w-5 place-items-center rounded-full ring-2 ring-surface ${isMail ? "bg-info text-white" : "bg-[#25d366] text-white"}`}>
                      {isMail ? <Mail className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
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
                        <span className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold text-white ${isMail ? "bg-info" : "bg-brand-600"}`}>{c.unread_count}</span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.client ? (
                        <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-surface/80 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
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

      {/* ---------------- Leitura / conversa aberta ---------------- */}
      <section className={`min-w-0 flex-1 flex-col ${conv?.kind === "email" ? "bg-surface-2" : "bg-canvas"} ${conv ? "flex" : "hidden md:flex"}`}>
        {!conv ? (
          <EmptyReader email={emailMode} />
        ) : (
          <MessageActionsProvider
            loadClients={listClientsForPickerAction}
            defaultClient={conv.client_id ?? ""}
            docs={(docsRes?.data ?? []).map((d) => ({ value: d.id, label: d.title, hint: `vence ${f.date(d.due_date)}` }))}
            saveAction={saveMessageAction}
            docAction={receiveDocumentFromMessageAction}
          >
            <MarkRead id={conv.id} unread={conv.unread_count} action={markReadAction} />
            <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
              <Link href={href({ c: null })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 md:hidden" aria-label="Voltar para a lista">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-extrabold text-white ${conv.kind === "email" ? "bg-info" : "bg-brand-600"}`}>
                {initials(conv.contact_name || conv.contact_address)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{conv.kind === "email" ? lastInboundSubject || "(sem assunto)" : conv.contact_name || showAddress(conv.kind, conv.contact_address)}</p>
                <p className="truncate text-xs text-muted">
                  {conv.kind === "email"
                    ? `${conv.contact_name ? `${conv.contact_name} · ` : ""}${conv.contact_address}`
                    : `WhatsApp · ${showAddress(conv.kind, conv.contact_address)} · ${conv.account?.label ?? ""}`}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <LinkClient
                  key={`${conv.id}:${conv.client_id ?? ""}`}
                  current={conv.client_id ?? ""}
                  currentLabel={conv.client?.legal_name ?? null}
                  loadClients={listClientsForPickerAction}
                  action={linkClientAction.bind(null, conv.id)}
                />
                {conv.client && (
                  <Link href={`/clientes/${conv.client.id}`} className="btn-secondary px-2.5 py-2 text-xs" title="Abrir cliente" aria-label="Abrir cliente">
                    <Building2 className="h-4 w-4" />
                  </Link>
                )}
                <ArchiveButton archived={conv.archived} action={setArchivedAction.bind(null, conv.id, !conv.archived)} />
              </div>
              {conv.kind === "email" && (
                <div className="w-full border-t border-line pt-3">
                  <CategoryControl
                    key={`${conv.id}:${conv.category ?? ""}`}
                    current={conv.category}
                    domain={conv.contact_address.split("@")[1] ?? ""}
                    action={setEmailCategoryAction.bind(null, conv.id)}
                  />
                </div>
              )}
            </header>

            {conv.kind === "email" ? (
              /* ----- Leitura de e-mail: cartões, mais novo embaixo ----- */
              <ScrollToEnd watch={`${conv.id}:${lastMsg?.id ?? ""}`} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-8">
                {messages.map((m) => {
                  const out = m.direction === "saida";
                  const media = (m.media ?? {}) as { attachments?: { filename: string; size?: number }[]; to?: string[]; cc?: string[]; signals?: { reasons?: string[] } };
                  const fromName = out ? (m.sent_by ? `${nameOf.get(m.sent_by) ?? "Equipe"} (Hagious)` : conv.account?.label ?? "Hagious") : conv.contact_name || conv.contact_address;
                  const fromAddr = out ? conv.account?.address ?? "" : conv.contact_address;
                  return (
                    <article key={m.id} className={`group mx-auto max-w-3xl overflow-hidden rounded-2xl border bg-surface shadow-sm ${out ? "border-info/30" : "border-line"}`}>
                      <header className="flex items-start gap-3 border-b border-line px-5 py-3">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-extrabold text-white ${out ? "bg-brand-600" : "bg-info"}`}>{initials(fromName)}</span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="truncate"><strong>{fromName}</strong> <span className="text-muted">&lt;{fromAddr}&gt;</span></p>
                          <p className="truncate text-xs text-muted">
                            para {out ? conv.contact_address : (media.to?.join(", ") || conv.account?.address)}
                            {media.cc?.length ? ` · cc ${media.cc.join(", ")}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-start gap-1">
                          <span className="pt-0.5 text-xs whitespace-nowrap text-muted">{f.dateTime(m.sent_at)}</span>
                          <MessageMenu id={m.id} body={m.body ?? ""} ticketHref={ticketHref(m)} />
                        </div>
                      </header>
                      <div className="px-5 py-4">
                        {m.subject && <h3 className="mb-2 text-base font-extrabold">{m.subject}</h3>}
                        <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{m.body ?? "(sem texto)"}</p>
                        {media.attachments?.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {media.attachments.map((a, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold">
                                <Paperclip className="h-3.5 w-3.5 text-muted" /> {a.filename}
                                {a.size ? <span className="font-normal text-muted">{Math.max(1, Math.round(a.size / 1024))} KB</span> : null}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {out && m.status !== "enviada" && (
                          <p className={`mt-3 text-xs ${m.status === "falhou" ? "text-danger" : "text-muted"}`}>{STATUS_TICK[m.status] ?? m.status}{m.error ? ` — ${m.error}` : ""}</p>
                        )}
                        {!out && conv.category === "separado" && media.signals?.reasons?.length ? (
                          <p className="mt-3 text-xs text-muted">Separado automaticamente: {media.signals.reasons.join(", ")}.</p>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </ScrollToEnd>
            ) : (
              /* ----- Conversa de WhatsApp: balões ----- */
              <ScrollToEnd watch={`${conv.id}:${lastMsg?.id ?? ""}`} className="flex-1 space-y-2 overflow-y-auto px-4 py-5 sm:px-8">
                {conv.is_demo && (
                  <p className="mx-auto mb-3 w-fit rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
                    Conversa de demonstração: as mensagens não saem do sistema.
                  </p>
                )}
                {messages.map((m, i) => {
                  const day = f.dateOf(m.sent_at);
                  const newDay = i === 0 || f.dateOf(messages[i - 1].sent_at) !== day;
                  const out = m.direction === "saida";
                  const menu = <MessageMenu id={m.id} body={m.body ?? ""} ticketHref={ticketHref(m)} />;
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <p className="sticky top-0 z-10 mx-auto my-3 w-fit rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-muted shadow-sm ring-1 ring-line">{day}</p>
                      )}
                      <div className={`group flex items-end gap-1.5 ${out ? "justify-end" : "justify-start"}`}>
                        {out && menu}
                        <div className={`max-w-[min(36rem,85%)] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${out ? "rounded-br-md bg-brand-700 text-white" : "rounded-bl-md bg-surface text-ink ring-1 ring-line"}`}>
                          {m.body ? <p className="break-words whitespace-pre-wrap">{m.body}</p> : <p className="italic opacity-80">[{m.kind}]</p>}
                          <p className={`mt-1 flex items-center justify-end gap-2 text-[11px] ${out ? "text-white/90" : "text-muted"}`}>
                            {m.via === "app" && <span className="inline-flex items-center gap-0.5"><Smartphone className="h-3 w-3" /> pelo celular</span>}
                            {m.via === "historico" && <span>histórico</span>}
                            {out && m.sent_by && <span>{nameOf.get(m.sent_by)?.split(" ")[0]}</span>}
                            <span className="tabular-nums">{f.time(m.sent_at)}</span>
                            {out && <span className="font-bold" title={m.error ?? undefined}>{STATUS_TICK[m.status] ?? m.status}</span>}
                          </p>
                          {m.status === "falhou" && m.error && <p className="mt-1 rounded-md bg-black/20 px-2 py-1 text-[11px]">{m.error}</p>}
                        </div>
                        {!out && menu}
                      </div>
                    </div>
                  );
                })}
              </ScrollToEnd>
            )}

            <footer className="border-t border-line bg-surface px-4 py-3">
              {!conv.account || conv.account.status === "desconectado" ? (
                <p className="text-sm text-muted">Canal desconectado. {isAdmin(profile) ? <Link href="/conversas/conexoes" className="link">Reconectar</Link> : "Peça a um administrador para reconectar."}</p>
              ) : conv.kind === "email" ? (
                <div className="mx-auto max-w-3xl">
                  <EmailComposer key={conv.id} action={sendMessageAction.bind(null, conv.id)} to={conv.contact_address} defaultSubject={replySubject} />
                </div>
              ) : (
                <Composer
                  key={conv.id}
                  action={sendMessageAction.bind(null, conv.id)}
                  windowOpen={windowOpen}
                  windowEndsAt={conv.last_inbound_at ? f.dateTime(new Date(Date.parse(conv.last_inbound_at) + WINDOW_MS).toISOString()) : null}
                />
              )}
            </footer>
          </MessageActionsProvider>
        )}
      </section>
    </div>
  );
}
