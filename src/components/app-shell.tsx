"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Building2,
  CalendarClock,
  CircleUserRound,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Ticket,
  UsersRound,
  X,
} from "lucide-react";
import { HagiousLogo } from "@/components/logo";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Painel", icon: LayoutDashboard },
  { href: "/clientes", label: "Clientes", icon: Building2 },
];
const ADMIN_NAV: NavItem[] = [{ href: "/equipe", label: "Equipe", icon: UsersRound }];
const ACCOUNT_NAV: NavItem[] = [{ href: "/conta", label: "Minha conta", icon: CircleUserRound }];

// Módulos planejados: aparecem desativados para mostrar o que vem a seguir, sem fingir que existem
const UPCOMING = [
  { label: "Tickets e SLA", icon: Ticket, stage: "Etapa 3" },
  { label: "Documentos", icon: FileClock, stage: "Etapa 3" },
  { label: "WhatsApp", icon: MessageCircle, stage: "Etapa 4" },
  { label: "Sucesso do cliente", icon: CalendarClock, stage: "Etapa 5" },
];

export function AppShell({
  user,
  isAdmin,
  signOut,
  children,
}: {
  user: { name: string; subtitle: string };
  isAdmin: boolean;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const initials = user.name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      {MAIN_NAV.map((i) => <NavLink key={i.href} item={i} pathname={pathname} />)}
      {isAdmin && (
        <>
          <SectionTitle>Administração</SectionTitle>
          {ADMIN_NAV.map((i) => <NavLink key={i.href} item={i} pathname={pathname} />)}
        </>
      )}
      <SectionTitle>Conta</SectionTitle>
      {ACCOUNT_NAV.map((i) => <NavLink key={i.href} item={i} pathname={pathname} />)}
      <SectionTitle>Em breve</SectionTitle>
      {UPCOMING.map(({ label, icon: Icon, stage }) => (
        <span
          key={label}
          className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-white/35"
          title={`Disponível na ${stage}`}
        >
          <Icon className="h-4 w-4" />
          <span className="flex-1">{label}</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/50">{stage}</span>
        </span>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Barra lateral (computador) */}
      <aside className="hidden shrink-0 flex-col bg-brand-900 px-3 py-5 text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:overflow-y-auto">
        <Logo />
        <div className="mt-6">{nav}</div>
      </aside>

      {/* Menu do celular */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/50" aria-label="Fechar menu" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 max-w-[85vw] overflow-y-auto bg-brand-900 px-3 py-5 text-white">
            <div className="flex items-center justify-between">
              <Logo />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Clicar em um link fecha o menu */}
            <div className="mt-6" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
              {nav}
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior: usuário e botão Sair sempre visíveis */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur md:px-8">
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-ink hover:bg-surface-2 md:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="md:hidden"><HagiousLogo markClassName="h-7 w-7" textClassName="text-base" /></div>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/conta" className="group flex items-center gap-3 rounded-xl px-2 py-1 transition hover:bg-surface-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-extrabold text-white ring-2 ring-brand-100 transition group-hover:ring-brand-500">
                {initials}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-bold">{user.name}</span>
                <span className="block text-xs text-muted">{user.subtitle}</span>
              </span>
            </Link>
            <form action={signOut}>
              <button type="submit" className="btn-secondary px-3" title="Sair do sistema">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </form>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <Link href="/" className="block px-2" aria-label="Hagious — ir para o painel">
      <HagiousLogo />
    </Link>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 mb-1 px-3 text-[11px] font-bold tracking-wider text-white/40 uppercase">{children}</p>;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const { href, label, icon: Icon } = item;
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition duration-150 ${
        active
          ? "bg-white/15 text-white shadow-[inset_3px_0_0_0_#6fd3ae]"
          : "text-white/70 hover:translate-x-0.5 hover:bg-white/10 hover:text-white hover:shadow-[0_0_18px_-4px_rgba(111,211,174,0.45)]"
      }`}
    >
      <Icon className={`h-4 w-4 transition ${active ? "text-[#6fd3ae]" : "group-hover:text-[#6fd3ae]"}`} />
      {label}
    </Link>
  );
}
