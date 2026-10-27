"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import { Check, LoaderCircle, Monitor, Moon, Save, Sun } from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { makeFormatter } from "@/lib/format";
import {
  CURRENCIES,
  DATE_FORMATS,
  FONT_SCALES,
  LANGUAGES,
  THEMES,
  TIMEZONES,
  TIME_FORMATS,
  type FontScale,
  type Preferences,
  type Theme,
} from "@/lib/preferences";
import { FormMessage } from "@/components/page-header";
import { Select } from "@/components/ui/select";
import { applyVisualPreferences } from "@/components/format-provider";

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

/** Tema e tamanho da letra: mudam na hora e ficam salvos. */
export function VisualSettings({
  initial,
  action,
}: {
  initial: Pick<Preferences, "theme" | "font_scale">;
  action: (p: Partial<Pick<Preferences, "theme" | "font_scale">>) => Promise<ActionState>;
}) {
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [font, setFont] = useState<FontScale>(initial.font_scale);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);

  function change(next: { theme?: Theme; font_scale?: FontScale }) {
    const t = next.theme ?? theme;
    const f = next.font_scale ?? font;
    setTheme(t);
    setFont(f);
    applyVisualPreferences({ theme: t, font_scale: f });
    setResult(null);
    start(async () => setResult(await action(next)));
  }

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="mb-1 font-bold">Tema</legend>
        <p className="mb-3 text-sm text-muted">Claro ou escuro. “Automático” acompanha a configuração do seu computador ou celular.</p>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tema">
          {THEMES.map((t) => {
            const Icon = THEME_ICON[t.value];
            const on = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => change({ theme: t.value })}
                className={`group rounded-2xl border p-3 text-left transition duration-150 ${on ? "border-brand-500 bg-brand-50 shadow-[0_0_0_1px_var(--color-brand-500)]" : "border-line hover:-translate-y-0.5 hover:border-brand-500/60"}`}
              >
                <ThemePreview kind={t.value} />
                <span className="mt-3 flex items-center gap-2 font-semibold">
                  <Icon className="h-4 w-4 text-link" /> {t.label}
                  {on && <Check className="ml-auto h-4 w-4 text-link" />}
                </span>
                <span className="text-xs text-muted">{t.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 font-bold">Tamanho da letra</legend>
        <p className="mb-3 text-sm text-muted">Aumenta ou diminui textos, botões e espaçamentos de todas as telas.</p>
        <div className="flex flex-wrap items-end gap-2" role="radiogroup" aria-label="Tamanho da letra">
          {FONT_SCALES.map((f, i) => {
            const on = font === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`Letra ${f.label.toLowerCase()}`}
                onClick={() => change({ font_scale: f.value })}
                className={`flex min-w-24 flex-col items-center rounded-2xl border px-4 py-3 transition ${on ? "border-brand-500 bg-brand-50 text-link" : "border-line hover:border-brand-500/60"}`}
              >
                <span className="font-extrabold leading-none" style={{ fontSize: `${14 + i * 4}px` }}>Aa</span>
                <span className="mt-1.5 text-xs font-semibold">{f.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm">
          Exemplo: <strong>Notas fiscais de entrada e saída</strong> — vence em 5 dias.
        </p>
      </fieldset>

      <p className="flex min-h-5 items-center gap-2 text-sm" aria-live="polite">
        {pending ? (
          <><LoaderCircle className="h-4 w-4 animate-spin text-muted" /> Salvando…</>
        ) : result?.ok ? (
          <span className="text-ok">Salvo. Vale também quando você entrar por outro computador.</span>
        ) : result?.errors?._form ? (
          <span className="text-danger">{result.errors._form}</span>
        ) : null}
      </p>
    </div>
  );
}

const PREVIEW_LIGHT = { bg: "#f3f6f5", card: "#ffffff", line: "#e2e8e6", side: "#0b3328", text: "#10231f" };
const PREVIEW_DARK = { bg: "#0d1211", card: "#151c1a", line: "#26312e", side: "#0a1e19", text: "#e4ecea" };

function PreviewPane({ c }: { c: typeof PREVIEW_LIGHT }) {
  return (
    <div className="flex h-full" style={{ background: c.bg }}>
      <div className="w-1/4" style={{ background: c.side }} />
      <div className="flex-1 space-y-1.5 p-2">
        <div className="h-1.5 w-2/3 rounded" style={{ background: c.text, opacity: 0.8 }} />
        <div className="h-6 rounded" style={{ background: c.card, border: `1px solid ${c.line}` }} />
        <div className="h-6 rounded" style={{ background: c.card, border: `1px solid ${c.line}` }} />
      </div>
    </div>
  );
}

/** Miniatura do tema (desenho simples de uma tela). */
function ThemePreview({ kind }: { kind: Theme }) {
  return (
    <div className="h-20 overflow-hidden rounded-xl border border-line" aria-hidden>
      {kind === "system" ? (
        <div className="relative h-full">
          <div className="absolute inset-0"><PreviewPane c={PREVIEW_LIGHT} /></div>
          <div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}><PreviewPane c={PREVIEW_DARK} /></div>
        </div>
      ) : (
        <PreviewPane c={kind === "dark" ? PREVIEW_DARK : PREVIEW_LIGHT} />
      )}
    </div>
  );
}

const SAMPLE_MOMENT = "2026-03-09T17:30:00Z";
const SAMPLE_DATE = "2026-03-31";

export function RegionSettings({ initial, action }: { initial: Preferences; action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const f = useMemo(() => makeFormatter(draft), [draft]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => dispatch(fd));
      }}
      className="space-y-5"
      noValidate
    >
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="language" className="label">Idioma</label>
          <Select id="language" name="language" value={draft.language} onChange={(v) => set("language", v as Preferences["language"])}
            options={LANGUAGES.map((l) => ({ value: l.value, label: l.label, hint: l.value, badge: l.value.slice(0, 2).toUpperCase(), disabled: !l.available, tag: l.available ? undefined : "Em breve" }))} />
          <p className="mt-1 text-xs text-muted">Por enquanto o sistema está todo em português.</p>
        </div>
        <div>
          <label htmlFor="timezone" className="label">Fuso horário</label>
          <Select id="timezone" name="timezone" searchable value={draft.timezone} onChange={(v) => set("timezone", v)}
            options={TIMEZONES.map((t) => {
              const [city, offset] = t.label.split(" — ");
              return { value: t.value, label: city, hint: offset ?? t.value, badge: (offset ?? "").replace("UTC", "").trim() || "TZ", group: t.value.startsWith("America/") && t.value !== "America/New_York" ? "Brasil" : "Exterior" };
            })} />
          <p className="mt-1 text-xs text-muted">Para exibir horários. Os prazos (SLA) seguem o expediente da empresa.</p>
        </div>
        <div>
          <label htmlFor="date_format" className="label">Formato de data</label>
          <Select id="date_format" name="date_format" value={draft.date_format} onChange={(v) => set("date_format", v as Preferences["date_format"])}
            options={DATE_FORMATS.map((d) => ({ value: d.value, label: d.label.split(" (")[0], hint: d.label.match(/\((.*)\)/)?.[1], badge: { dmy: "DMA", mdy: "MDA", ymd: "ISO" }[d.value] }))} />
        </div>
        <div>
          <label htmlFor="time_format" className="label">Formato de hora</label>
          <Select id="time_format" name="time_format" value={draft.time_format} onChange={(v) => set("time_format", v as Preferences["time_format"])}
            options={TIME_FORMATS.map((t) => ({ value: t.value, label: t.label.split(" (")[0], hint: t.label.match(/\((.*)\)/)?.[1], badge: t.value === "24h" ? "24" : "12" }))} />
        </div>
        <div>
          <label htmlFor="currency" className="label">Moeda</label>
          <Select id="currency" name="currency" value={draft.currency} onChange={(v) => set("currency", v as Preferences["currency"])}
            options={CURRENCIES.map((c) => ({ value: c.value, label: c.label.split(" (")[0], hint: c.value, badge: c.label.match(/\((.*)\)/)?.[1] }))} />
          <p className="mt-1 text-xs text-muted">Usada quando o sistema exibir valores (ex.: honorários, na Etapa 5).</p>
        </div>
      </div>

      <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm" aria-live="polite">
        <p className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">Como vai aparecer</p>
        <p>Vencimento: <strong>{f.date(SAMPLE_DATE)}</strong></p>
        <p>Ticket aberto em: <strong>{f.dateTime(SAMPLE_MOMENT)}</strong></p>
        <p>Valor: <strong>{f.money(1234.56)}</strong></p>
      </div>

      <button className="btn-primary" disabled={pending}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar idioma e região
      </button>
    </form>
  );
}
