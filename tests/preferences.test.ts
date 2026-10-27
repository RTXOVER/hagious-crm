import { describe, expect, it } from "vitest";
import { makeFormatter } from "@/lib/format";
import { DEFAULT_PREFERENCES, normalizePreferences, parsePreferencesCookie, serializePreferences } from "@/lib/preferences";

const at = "2026-03-09T17:30:00Z"; // 14:30 em Brasília

describe("preferências: formatos de data, hora, fuso e moeda", () => {
  it("padrão brasileiro", () => {
    const f = makeFormatter();
    expect(f.date("2026-03-31")).toBe("31/03/2026");
    expect(f.dateTime(at)).toBe("09/03/2026 14:30");
    expect(f.money(1234.56)).toBe("R$ 1.234,56".replace(" ", " "));
  });

  it("formatos alternativos", () => {
    const ymd = makeFormatter({ ...DEFAULT_PREFERENCES, date_format: "ymd", time_format: "12h" });
    expect(ymd.date("2026-03-31")).toBe("2026-03-31");
    expect(ymd.dateTime(at)).toBe("2026-03-09 2:30 PM");
    const mdy = makeFormatter({ ...DEFAULT_PREFERENCES, date_format: "mdy" });
    expect(mdy.date("2026-03-31")).toBe("03/31/2026");
    expect(makeFormatter({ ...DEFAULT_PREFERENCES, time_format: "12h" }).time("2026-03-09T03:05:00Z")).toBe("12:05 AM");
  });

  it("fuso horário muda a hora exibida, mas não muda a data de vencimento", () => {
    const manaus = makeFormatter({ ...DEFAULT_PREFERENCES, timezone: "America/Manaus" });
    expect(manaus.dateTime(at)).toBe("09/03/2026 13:30");
    expect(manaus.date("2026-03-31")).toBe("31/03/2026");
    // 01:30 UTC ainda é o dia anterior em Brasília
    expect(makeFormatter().dateOf("2026-03-10T01:30:00Z")).toBe("09/03/2026");
  });

  it("moeda escolhida", () => {
    expect(makeFormatter({ ...DEFAULT_PREFERENCES, currency: "USD" }).money(10)).toContain("US$");
    expect(makeFormatter({ ...DEFAULT_PREFERENCES, currency: "EUR" }).money(10)).toContain("€");
  });

  it("valores inválidos ou idioma ainda não traduzido voltam ao padrão", () => {
    const p = normalizePreferences({ theme: "neon", font_scale: "xl", language: "en-US", timezone: "Mars/Base", currency: "BTC" });
    expect(p).toEqual({ ...DEFAULT_PREFERENCES, font_scale: "xl" });
    expect(parsePreferencesCookie("{quebrado")).toBeNull();
    expect(parsePreferencesCookie(serializePreferences({ ...DEFAULT_PREFERENCES, theme: "dark" }))?.theme).toBe("dark");
  });
});
