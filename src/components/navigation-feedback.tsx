"use client";

/**
 * Troca de telas mais natural (estilo app):
 * - ao clicar num link interno ou enviar um filtro, a tela atual ganha um leve desfoque e uma barra de progresso
 *   aparece no topo (a pessoa vê que o clique funcionou, sem "tela travada");
 * - quando a nova tela chega, o conteúdo entra com um esmaecer + deslizar curto.
 * Respeita "reduzir movimento" do sistema (sem animações).
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const MAIN = "[data-app-main]";

function isInternalNavigation(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return false;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return false;
  // Mesmo endereço (ou só âncora #): não há troca de tela
  return url.pathname + url.search !== location.pathname + location.search;
}

function Watcher({ onArrive }: { onArrive: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = `${pathname}?${search.toString()}`;
  const first = useRef(true);
  const latest = useRef(onArrive);
  useEffect(() => {
    latest.current = onArrive;
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    latest.current(); // só quando o endereço muda de fato
  }, [key]);
  return null;
}

export function NavigationFeedback() {
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduce = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPending(false);
    document.querySelector(MAIN)?.removeAttribute("data-pending");
  }, []);

  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = () => {
      setPending(true);
      document.querySelector(MAIN)?.setAttribute("data-pending", "");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(stop, 12_000); // segurança: nunca fica preso
    };
    const onClick = (e: MouseEvent) => {
      if (isInternalNavigation(e)) start();
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      // Filtros e buscas (formulários GET) também trocam a tela
      if (!e.defaultPrevented && (f.method || "get").toLowerCase() === "get" && !f.getAttribute("action")?.startsWith("javascript")) start();
    };
    const onPop = () => start();
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("popstate", onPop);
    };
  }, [stop]);

  function arrive() {
    stop();
    const main = document.querySelector<HTMLElement>(MAIN);
    if (main && !reduce.current) {
      main.animate(
        [
          { opacity: 0, transform: "translateY(6px)", filter: "blur(3px)" },
          { opacity: 1, transform: "none", filter: "none" },
        ],
        { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }
  }

  return (
    <>
      <Suspense fallback={null}>
        <Watcher onArrive={arrive} />
      </Suspense>
      <div aria-hidden className={`nav-progress ${pending ? "is-active" : ""}`} />
      <span className="sr-only" role="status" aria-live="polite">{pending ? "Carregando…" : ""}</span>
    </>
  );
}
