import { DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";

export type Formatter = ReturnType<typeof makeFormatter>;

/**
 * Formatação de datas, horas e valores conforme as preferências da pessoa.
 * - date(): datas "puras" (AAAA-MM-DD, ex.: vencimentos) — não mudam com o fuso.
 * - dateTime()/time(): momentos (ex.: "aberto em") — mostrados no fuso escolhido.
 */
export function makeFormatter(prefs: Preferences = DEFAULT_PREFERENCES) {
  const tz = prefs.timezone;
  const partsFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const money = new Intl.NumberFormat(prefs.language, { style: "currency", currency: prefs.currency });
  const weekday = new Intl.DateTimeFormat(prefs.language, { weekday: "short", timeZone: "UTC" });

  const ymd = (y: string, m: string, d: string) =>
    prefs.date_format === "ymd" ? `${y}-${m}-${d}` : prefs.date_format === "mdy" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
  const hm = (h: number, m: string) => {
    if (prefs.time_format === "24h") return `${String(h).padStart(2, "0")}:${m}`;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${h < 12 ? "AM" : "PM"}`;
  };
  /** Partes do instante no fuso escolhido; null se a data for inválida (nunca derruba a tela). */
  const parts = (iso: string) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return null;
    const p = Object.fromEntries(partsFmt.formatToParts(t).map((x) => [x.type, x.value]));
    return { y: p.year, m: p.month, d: p.day, h: Number(p.hour), min: p.minute };
  };

  /** Data pura AAAA-MM-DD (vencimentos, feriados). */
  const date = (d: string | null | undefined) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return "—";
    const [y, m, day] = d.slice(0, 10).split("-");
    return ymd(y, m, day);
  };
  /** Só dia e mês, na ordem escolhida: "31/12", "12-31" ou "12/31". */
  const dm = (m: string, d: string) => (prefs.date_format === "ymd" ? `${m}-${d}` : prefs.date_format === "mdy" ? `${m}/${d}` : `${d}/${m}`);

  return {
    prefs,
    date,
    /** Data com dia da semana: "qua. 31/12/2026". */
    weekdayDate(d: string) {
      return `${weekday.format(new Date(`${d.slice(0, 10)}T12:00:00Z`))} ${date(d)}`;
    },
    /** Momento (timestamp) no fuso escolhido: "31/12/2026 14:30". */
    dateTime(iso: string | null | undefined) {
      const p = iso ? parts(iso) : null;
      return p ? `${ymd(p.y, p.m, p.d)} ${hm(p.h, p.min)}` : "—";
    },
    /** Só a data de um momento, no fuso escolhido. */
    dateOf(iso: string | null | undefined) {
      const p = iso ? parts(iso) : null;
      return p ? ymd(p.y, p.m, p.d) : "—";
    },
    /** Dia e mês de um momento (listas compactas), no fuso e formato escolhidos. */
    dayMonth(iso: string | null | undefined) {
      const p = iso ? parts(iso) : null;
      return p ? dm(p.m, p.d) : "—";
    },
    time(iso: string | null | undefined) {
      const p = iso ? parts(iso) : null;
      return p ? hm(p.h, p.min) : "—";
    },
    /** Número decimal no idioma (ex.: 1,5). */
    number(value: number, digits = 2) {
      return value.toLocaleString(prefs.language, { maximumFractionDigits: digits });
    },
    money(value: number | null | undefined) {
      return value === null || value === undefined ? "—" : money.format(value);
    },
  };
}
