import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, ArrowRight, Globe2, Palette, UserRound } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DEPARTMENT_LABEL, ROLE_LABEL } from "@/lib/labels";
import { getPreferences } from "@/lib/preferences-server";
import { PasswordForm } from "../conta/password-form";
import { saveRegionAction, saveVisualAction } from "./actions";
import { RegionSettings, VisualSettings } from "./settings-forms";

export const metadata: Metadata = { title: "Configurações" };

const TABS = [
  { key: "conta", label: "Conta", icon: UserRound },
  { key: "visual", label: "Visual", icon: Palette },
  { key: "regiao", label: "Idioma e região", icon: Globe2 },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function SettingsPage(props: PageProps<"/configuracoes">) {
  const [sp, profile, prefs] = await Promise.all([props.searchParams, requireProfile(), getPreferences()]);
  const tab: Tab = TABS.some((t) => t.key === sp.aba) ? (sp.aba as Tab) : "conta";

  return (
    <>
      <PageHeader title="Configurações" description="Suas preferências pessoais. Valem só para você, em qualquer computador." />

      <nav className="mb-6 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Seções">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={key === "conta" ? "/configuracoes" : `/configuracoes?aba=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === key ? "bg-brand-600 text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        ))}
      </nav>

      {tab === "conta" && (
        <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
          <section className="card p-6 text-sm" aria-labelledby="dados-conta">
            <h2 id="dados-conta" className="mb-4 text-lg font-extrabold">Seus dados</h2>
            <dl className="space-y-3">
              <div><dt className="text-xs font-bold tracking-wide text-muted uppercase">Nome</dt><dd className="mt-0.5 font-semibold">{profile.full_name}</dd></div>
              <div><dt className="text-xs font-bold tracking-wide text-muted uppercase">E-mail de acesso</dt><dd className="mt-0.5">{profile.email}</dd></div>
              <div>
                <dt className="text-xs font-bold tracking-wide text-muted uppercase">Cargo</dt>
                <dd className="mt-0.5">{ROLE_LABEL[profile.role]}{profile.department ? ` · ${DEPARTMENT_LABEL[profile.department]}` : ""}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted">Para alterar nome, e-mail, cargo ou departamento, fale com um administrador.</p>
            {isManager(profile) && (
              <Link href="/configuracoes/prazos" className="card-link mt-5 flex items-center gap-3 p-4">
                <AlarmClock className="h-5 w-5 text-link" />
                <span className="flex-1">
                  <span className="block font-semibold">Prazos e lembretes</span>
                  <span className="text-xs text-muted">Configurações da empresa (gestão): expediente, feriados, tipos e lembretes.</span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted" />
              </Link>
            )}
          </section>
          <PasswordForm />
        </div>
      )}

      {tab === "visual" && (
        <section className="card max-w-4xl p-6">
          <VisualSettings initial={prefs} action={saveVisualAction} />
        </section>
      )}

      {tab === "regiao" && (
        <section className="card max-w-4xl p-6">
          <h2 className="mb-1 text-lg font-extrabold">Idioma e região</h2>
          <p className="mb-5 text-sm text-muted">Escolha manualmente; o sistema não depende da localização automática do navegador.</p>
          <RegionSettings initial={prefs} action={saveRegionAction} />
        </section>
      )}
    </>
  );
}
