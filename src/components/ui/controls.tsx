"use client";

/**
 * Controles de seleção do CRM Hagious (referência: caixas de marcar, botões de opção, chave liga/desliga,
 * etiquetas de escolha e de múltipla escolha, controle segmentado). Todos usam <input> de verdade por baixo,
 * então funcionam em formulários e com teclado/leitores de tela.
 */
import { useState } from "react";
import { Check } from "lucide-react";

/** Caixa de marcar. */
export function Checkbox({
  name,
  value = "on",
  label,
  description,
  checked,
  defaultChecked,
  onChange,
  disabled,
}: {
  name?: string;
  value?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  return (
    <label className={`group flex items-start gap-3 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={on}
        disabled={disabled}
        onChange={(e) => {
          if (checked === undefined) setInner(e.target.checked);
          onChange?.(e.target.checked);
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition duration-150 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20 ${
          on ? "border-brand-600 bg-brand-600 text-white" : "border-muted/50 bg-surface group-hover:border-brand-500"
        }`}
      >
        <Check className={`h-3.5 w-3.5 transition ${on ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Chave liga/desliga. Envia "on" quando ligada (como um checkbox). */
export function Switch({
  name,
  label,
  description,
  checked,
  defaultChecked,
  onChange,
  disabled,
}: {
  name?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  return (
    <label className={`group flex items-center justify-between gap-4 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        name={name}
        checked={on}
        disabled={disabled}
        onChange={(e) => {
          if (checked === undefined) setInner(e.target.checked);
          onChange?.(e.target.checked);
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`relative h-7 w-12 shrink-0 rounded-full transition duration-200 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20 ${
          on ? "bg-brand-500" : "bg-line group-hover:bg-muted/40"
        }`}
      >
        <span
          className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${on ? "translate-x-5" : ""}`}
        />
      </span>
    </label>
  );
}

/** Controle segmentado (ex.: "Mensal | Anual"). */
export function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  size = "md",
}: {
  name?: string;
  options: { value: T; label: React.ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  "aria-label": string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg font-semibold transition duration-150 has-focus-visible:ring-2 has-focus-visible:ring-brand-500/40 ${
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
            } ${on ? "bg-brand-600 text-white shadow-sm" : "text-muted hover:bg-surface hover:text-ink"}`}
          >
            <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
            {typeof o.count === "number" && (
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-white/25" : "bg-surface"}`}>{o.count}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Etiquetas de múltipla escolha (ex.: "✓ Fiscal  ✓ DP  Contábil"). */
export function MultiChips<T extends string>({
  name,
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  name?: string;
  options: { value: T; label: string; dot?: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  "aria-label": string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition duration-150 has-focus-visible:ring-2 has-focus-visible:ring-brand-500/40 ${
              on ? "border-brand-500 bg-brand-50 text-link" : "border-line bg-surface text-ink hover:border-brand-500/60"
            }`}
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              checked={on}
              onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))}
              className="sr-only"
            />
            {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : o.dot && <span className="h-2 w-2 rounded-full" style={{ background: o.dot }} />}
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/** Cartões de escolha única com descrição (ex.: planos, tipos). */
export function RadioCards<T extends string>({
  name,
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  columns = 2,
}: {
  name?: string;
  options: { value: T; label: string; description?: string; aside?: React.ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  "aria-label": string;
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`grid gap-2.5 ${cols}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition duration-150 has-focus-visible:ring-2 has-focus-visible:ring-brand-500/40 ${
              o.disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"
            } ${on ? "border-brand-500 bg-brand-600 text-white shadow-(--shadow-lift)" : "border-line bg-surface hover:border-brand-500/60"}`}
          >
            <input type="radio" name={name} value={o.value} checked={on} disabled={o.disabled} onChange={() => onChange(o.value)} className="sr-only" />
            <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-white bg-white text-brand-600" : "border-muted/50"}`}>
              {on && <Check className="h-3 w-3" strokeWidth={3.5} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{o.label}</span>
              {o.description && <span className={`block text-xs ${on ? "text-white/80" : "text-muted"}`}>{o.description}</span>}
            </span>
            {o.aside && <span className={`shrink-0 text-sm font-bold ${on ? "text-white" : ""}`}>{o.aside}</span>}
          </label>
        );
      })}
    </div>
  );
}
