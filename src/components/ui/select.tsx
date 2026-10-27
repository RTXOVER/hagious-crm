"use client";

/**
 * Seletor Hagious: substitui o <select> nativo com ícone/selo, linha secundária, selo "em breve",
 * busca opcional e navegação por teclado (setas, Home/End, Enter, Esc, digitar para buscar).
 * Para formulários, grava o valor num <input type="hidden" name=...> — FormData continua funcionando.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  /** Linha secundária (ex.: "pt-BR", "31/12/2026") */
  hint?: string;
  /** Texto curto no quadradinho à esquerda (ex.: "PT", "R$") */
  badge?: string;
  /** Bolinha colorida à esquerda (ex.: situação, departamento) */
  dot?: string;
  /** Selo à direita (ex.: "Em breve") */
  tag?: string;
  disabled?: boolean;
  /** Agrupamento visual (cabeçalho antes do primeiro item do grupo) */
  group?: string;
};

type Props = {
  options: SelectOption[];
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Mostra campo de busca no topo da lista (bom para listas longas) */
  searchable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** "sm" para filtros e barras compactas */
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
  /** Envia o formulário ao escolher (ex.: filtros de lista) */
  submitOnChange?: boolean;
};

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function Select({
  options,
  name,
  id,
  value,
  defaultValue,
  onChange,
  placeholder = "Selecione…",
  searchable,
  disabled,
  invalid,
  size = "md",
  className = "",
  submitOnChange,
  ...aria
}: Props) {
  const auto = useId();
  const baseId = id ?? `sel${auto.replace(/:/g, "")}`;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return q ? options.filter((o) => normalize(`${o.label} ${o.hint ?? ""} ${o.badge ?? ""}`).includes(q)) : options;
  }, [options, query]);
  const selected = options.find((o) => o.value === current);
  const enabled = (i: number) => i >= 0 && i < visible.length && !visible[i].disabled;
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < visible.length; i += dir) if (enabled(i)) return i;
    return from;
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    if (disabled) return;
    const r = trigger.current!.getBoundingClientRect();
    setUp(window.innerHeight - r.bottom < 300 && r.top > 300);
    setQuery("");
    const idx = options.findIndex((o) => o.value === current);
    setActive(idx >= 0 && !options[idx].disabled ? idx : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }

  function choose(i: number) {
    if (!enabled(i)) return;
    const v = visible[i].value;
    const changed = v !== current;
    if (value === undefined) setInner(v);
    setOpen(false);
    trigger.current?.focus();
    if (changed) {
      onChange?.(v);
      if (submitOnChange && hidden.current) {
        hidden.current.value = v;
        hidden.current.form?.requestSubmit();
      }
    }
  }

  function onKey(e: React.KeyboardEvent) {
    const k = e.key;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(k)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (k === "ArrowDown") { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (k === "ArrowUp") { e.preventDefault(); setActive((a) => step(a, -1)); }
    else if (k === "Home") { e.preventDefault(); setActive(step(-1, 1)); }
    else if (k === "End") { e.preventDefault(); setActive(step(visible.length, -1)); }
    else if (k === "Enter") { e.preventDefault(); choose(active); }
    else if (k === "Escape") { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
    else if (k === "Tab") setOpen(false);
    else if (!searchable && k.length === 1) {
      const t = typed.current;
      t.text += normalize(k);
      clearTimeout(t.timer);
      t.timer = setTimeout(() => (t.text = ""), 500);
      const hit = visible.findIndex((o, i) => enabled(i) && normalize(o.label).startsWith(t.text));
      if (hit >= 0) setActive(hit);
    }
  }

  const pad = size === "sm" ? "px-3 py-2 text-sm" : "px-3 py-2.5 text-[15px]";
  const listId = `${baseId}-list`;

  return (
    <div ref={wrap} className={`relative ${className}`} onKeyDown={onKey}>
      {name && <input ref={hidden} type="hidden" name={name} value={current} />}
      <button
        ref={trigger}
        id={baseId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={aria["aria-label"]}
        aria-activedescendant={open && active >= 0 ? `${baseId}-opt-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        className={`flex w-full items-center gap-3 rounded-xl border bg-surface text-left text-ink transition duration-150 hover:border-muted/50 hover:bg-surface-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${pad} ${
          open || invalid
            ? invalid
              ? "border-danger ring-4 ring-danger/15"
              : "border-brand-500 ring-4 ring-brand-500/15"
            : "border-line focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15"
        }`}
      >
        {selected ? <OptionBody o={selected} chosen inTrigger /> : <span className="flex-1 truncate text-muted/80">{placeholder}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 transition duration-200 ${open ? "rotate-180 text-link" : "text-muted"}`} aria-hidden />
      </button>

      <div
        className={`absolute right-0 left-0 z-50 min-w-[14rem] rounded-xl border border-line bg-surface p-1.5 shadow-(--shadow-lift) transition duration-150 ${
          up ? "bottom-[calc(100%+6px)] origin-bottom" : "top-[calc(100%+6px)] origin-top"
        } ${open ? "visible scale-100 opacity-100" : "pointer-events-none invisible scale-[0.98] opacity-0"}`}
      >
        {searchable && (
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Buscar…"
              aria-label="Buscar opção"
              className="w-full rounded-lg bg-surface-2 py-2 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-muted/70"
              autoFocus={open}
              tabIndex={open ? 0 : -1}
            />
          </div>
        )}
        <ul ref={listRef} id={listId} role="listbox" aria-labelledby={baseId} className="max-h-72 overflow-auto">
          {!visible.length && <li className="px-3 py-2.5 text-sm text-muted">Nada encontrado.</li>}
          {visible.map((o, i) => {
            const isSel = o.value === current;
            const newGroup = o.group && o.group !== visible[i - 1]?.group;
            return (
              <li key={o.value} role="presentation">
                {newGroup && <p className="px-2.5 pt-2 pb-1 text-[11px] font-bold tracking-wider text-muted uppercase">{o.group}</p>}
                <div
                  id={`${baseId}-opt-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => enabled(i) && setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm select-none ${
                    o.disabled ? "cursor-not-allowed" : "cursor-pointer"
                  } ${i === active && !o.disabled ? "bg-surface-2" : ""}`}
                >
                  <OptionBody o={o} chosen={isSel} />
                  {o.tag ? (
                    <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-warn uppercase">{o.tag}</span>
                  ) : (
                    <Check className={`h-4 w-4 shrink-0 text-link ${isSel ? "opacity-100" : "opacity-0"}`} aria-hidden />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function OptionBody({ o, chosen, inTrigger }: { o: SelectOption; chosen?: boolean; inTrigger?: boolean }) {
  return (
    <>
      {o.badge && (
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[11px] font-bold tracking-wide ${
            chosen ? "border-transparent bg-brand-50 text-link" : "border-line bg-surface-2 text-muted"
          } ${o.disabled ? "opacity-45" : ""}`}
        >
          {o.badge}
        </span>
      )}
      {o.dot && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.dot }} aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${inTrigger ? "font-medium" : chosen ? "font-semibold text-link" : ""} ${o.disabled ? "opacity-45" : ""}`}>{o.label}</span>
        {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
      </span>
    </>
  );
}
