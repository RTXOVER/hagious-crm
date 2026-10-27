/**
 * Preferências pessoais (visual e região). Ficam salvas no banco (valem em qualquer computador)
 * e copiadas num cookie, para a página já abrir no tema e no tamanho de letra certos.
 */

export type Theme = "system" | "light" | "dark";
export type FontScale = "sm" | "md" | "lg" | "xl";
export type DateFormat = "dmy" | "ymd" | "mdy";
export type TimeFormat = "24h" | "12h";
export type Currency = "BRL" | "USD" | "EUR";
export type Language = "pt-BR" | "en-US";

export type Preferences = {
  theme: Theme;
  font_scale: FontScale;
  language: Language;
  date_format: DateFormat;
  time_format: TimeFormat;
  timezone: string;
  currency: Currency;
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  font_scale: "md",
  language: "pt-BR",
  date_format: "dmy",
  time_format: "24h",
  timezone: "America/Sao_Paulo",
  currency: "BRL",
};

export const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: "system", label: "Automático", hint: "Segue o computador" },
  { value: "light", label: "Claro", hint: "Fundo branco" },
  { value: "dark", label: "Escuro", hint: "Descansa a vista" },
];

export const FONT_SCALES: { value: FontScale; label: string; percent: number }[] = [
  { value: "sm", label: "Pequena", percent: 87.5 },
  { value: "md", label: "Padrão", percent: 100 },
  { value: "lg", label: "Grande", percent: 112.5 },
  { value: "xl", label: "Muito grande", percent: 125 },
];

/** Idiomas do sistema: português e inglês. O inglês fica "em breve" até as telas serem traduzidas. */
export const LANGUAGES: { value: Language; label: string; available: boolean }[] = [
  { value: "pt-BR", label: "Português (Brasil)", available: true },
  { value: "en-US", label: "English", available: false },
];

export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "dmy", label: "Dia/mês/ano (31/12/2026)" },
  { value: "ymd", label: "Ano-mês-dia (2026-12-31)" },
  { value: "mdy", label: "Mês/dia/ano (12/31/2026)" },
];

export const TIME_FORMATS: { value: TimeFormat; label: string }[] = [
  { value: "24h", label: "24 horas (14:30)" },
  { value: "12h", label: "12 horas (2:30 PM)" },
];

/** Fusos do Brasil primeiro; depois alguns comuns no exterior. */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (SP, RJ, MG, Sul, GO, DF, BA…) — UTC−3" },
  { value: "America/Fortaleza", label: "Fortaleza (CE, MA, PI, RN, PB) — UTC−3" },
  { value: "America/Recife", label: "Recife (PE) — UTC−3" },
  { value: "America/Bahia", label: "Salvador (BA) — UTC−3" },
  { value: "America/Belem", label: "Belém (PA, AP) — UTC−3" },
  { value: "America/Araguaina", label: "Palmas (TO) — UTC−3" },
  { value: "America/Maceio", label: "Maceió (AL, SE) — UTC−3" },
  { value: "America/Cuiaba", label: "Cuiabá (MT) — UTC−4" },
  { value: "America/Campo_Grande", label: "Campo Grande (MS) — UTC−4" },
  { value: "America/Manaus", label: "Manaus (AM) — UTC−4" },
  { value: "America/Porto_Velho", label: "Porto Velho (RO) — UTC−4" },
  { value: "America/Boa_Vista", label: "Boa Vista (RR) — UTC−4" },
  { value: "America/Rio_Branco", label: "Rio Branco (AC) — UTC−5" },
  { value: "America/Noronha", label: "Fernando de Noronha — UTC−2" },
  { value: "Europe/Lisbon", label: "Lisboa (Portugal)" },
  { value: "America/New_York", label: "Nova York (EUA)" },
  { value: "UTC", label: "UTC (tempo universal)" },
];

export const CURRENCIES: { value: Currency; label: string }[] = [
  { value: "BRL", label: "Real (R$)" },
  { value: "USD", label: "Dólar americano (US$)" },
  { value: "EUR", label: "Euro (€)" },
];

export const PREFS_COOKIE = "hagious_prefs";

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Aceita qualquer objeto (cookie, banco) e devolve preferências válidas; o que vier errado vira o padrão. */
export function normalizePreferences(raw: unknown): Preferences {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;
  return {
    theme: pick(r.theme, ["system", "light", "dark"], d.theme),
    font_scale: pick(r.font_scale, ["sm", "md", "lg", "xl"], d.font_scale),
    // Idiomas ainda não traduzidos voltam para português
    language: pick(r.language, LANGUAGES.filter((l) => l.available).map((l) => l.value), d.language),
    date_format: pick(r.date_format, ["dmy", "ymd", "mdy"], d.date_format),
    time_format: pick(r.time_format, ["24h", "12h"], d.time_format),
    timezone: pick(r.timezone, TIMEZONES.map((t) => t.value), d.timezone),
    currency: pick(r.currency, ["BRL", "USD", "EUR"], d.currency),
  };
}

export function parsePreferencesCookie(value: string | undefined): Preferences | null {
  if (!value) return null;
  try {
    return normalizePreferences(JSON.parse(value));
  } catch {
    return null;
  }
}

export const serializePreferences = (p: Preferences) => JSON.stringify(normalizePreferences(p));
