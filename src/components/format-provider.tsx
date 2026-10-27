"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { makeFormatter, type Formatter } from "@/lib/format";
import { PREFS_COOKIE, serializePreferences, type Preferences } from "@/lib/preferences";

const FormatContext = createContext<Formatter>(makeFormatter());

/** Disponibiliza o formatador (datas, horas, moeda) para componentes do navegador. */
export function FormatProvider({ prefs, children }: { prefs: Preferences; children: React.ReactNode }) {
  const formatter = useMemo(() => makeFormatter(prefs), [prefs]);

  // Primeiro acesso neste navegador: grava o cookie e aplica tema/letra sem precisar recarregar
  useEffect(() => {
    if (document.cookie.split("; ").some((c) => c.startsWith(`${PREFS_COOKIE}=`))) return;
    document.cookie = `${PREFS_COOKIE}=${encodeURIComponent(serializePreferences(prefs))}; path=/; max-age=31536000; samesite=lax`;
    applyVisualPreferences(prefs);
  }, [prefs]);

  return <FormatContext.Provider value={formatter}>{children}</FormatContext.Provider>;
}

export const useFormat = () => useContext(FormatContext);

/** Aplica tema e tamanho da letra imediatamente na página aberta. */
export function applyVisualPreferences(p: Pick<Preferences, "theme" | "font_scale">) {
  const root = document.documentElement;
  if (p.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = p.theme;
  if (p.font_scale === "md") delete root.dataset.font;
  else root.dataset.font = p.font_scale;
}
