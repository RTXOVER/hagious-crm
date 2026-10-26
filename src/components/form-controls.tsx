"use client";

import { Check } from "lucide-react";

type IconType = React.ComponentType<{ className?: string }>;

/** Máscara progressiva de CNPJ: 11222333000181 -> 11.222.333/0001-81 */
export function maskCnpj(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/** Máscara progressiva de telefone brasileiro: (34) 99958-3398 ou (34) 3333-4444 */
export function maskPhone(value: string): string {
  let d = value.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Campo de texto com ícone à esquerda e, opcionalmente, um botão/elemento à direita. */
export function IconField({
  label,
  name,
  icon: Icon,
  error,
  hint,
  trailing,
  className = "",
  ...rest
}: {
  label: string;
  name: string;
  icon?: IconType;
  error?: string;
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const id = rest.id ?? name;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-muted" />}
        <input
          id={id}
          name={name}
          className={`input ${Icon ? "pl-11" : ""} ${trailing ? "pr-28" : ""} ${error ? "border-danger focus:border-danger focus:ring-danger/20" : ""}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...rest}
        />
        {trailing && <div className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</div>}
      </div>
      {error ? (
        <p id={`${id}-error`} className="field-error">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

/** Escolha única em "pílulas" grandes (substitui a lista suspensa). */
export function ChoiceChips<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
  columns = 3,
  error,
}: {
  label: string;
  name: string;
  options: { value: T; label: string; hint?: string }[];
  value: T | "";
  onChange: (v: T) => void;
  columns?: 2 | 3 | 4 | 5;
  error?: string;
}) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5" }[columns];
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className={`grid grid-cols-2 gap-2.5 ${cols}`} role="radiogroup">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <label
              key={o.value}
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-xl border px-3 py-3.5 text-center text-sm font-semibold transition duration-150 has-focus-visible:ring-2 has-focus-visible:ring-brand-500/40 ${
                selected
                  ? "border-brand-500 bg-brand-50 text-link shadow-[0_0_0_1px_var(--color-brand-500)]"
                  : "border-line bg-surface text-ink hover:-translate-y-0.5 hover:border-brand-500/60 hover:bg-surface-2"
              }`}
            >
              <input type="radio" name={name} value={o.value} checked={selected} onChange={() => onChange(o.value)} className="sr-only" />
              {selected && <Check className="absolute top-2 right-2 h-3.5 w-3.5" />}
              {o.label}
              {o.hint && <span className="mt-0.5 text-[11px] font-medium text-muted">{o.hint}</span>}
            </label>
          );
        })}
      </div>
      {error && <p className="field-error">{error}</p>}
    </fieldset>
  );
}

/** Cartão selecionável (liga/desliga), com ícone, título e descrição. */
export function ToggleCard({
  name,
  value,
  checked,
  onChange,
  icon: Icon,
  title,
  description,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon: IconType;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition duration-150 ${
        checked ? "border-brand-500 bg-brand-50 shadow-[0_0_0_1px_var(--color-brand-500)]" : "border-line bg-surface hover:border-brand-500/60"
      }`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" name={name} value={value} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 ${
            checked ? "bg-brand-600 text-white" : "bg-surface-2 text-link"
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          {description && <span className="block text-sm text-muted">{description}</span>}
        </span>
        <span
          aria-hidden
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
            checked ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface"
          }`}
        >
          {checked && <Check className="h-3.5 w-3.5" />}
        </span>
      </label>
      {checked && children && <div className="mt-4 border-t border-brand-500/20 pt-4">{children}</div>}
    </div>
  );
}

/** Indicador de etapas: 1 — 2 — 3 — 4, com barra de progresso. */
export function Stepper({
  steps,
  current,
  onGo,
}: {
  steps: string[];
  current: number;
  onGo?: (index: number) => void;
}) {
  return (
    <nav aria-label="Etapas do cadastro" className="mb-8">
      <ol className="flex items-center">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className={`flex items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
              <button
                type="button"
                disabled={!done || !onGo}
                onClick={() => onGo?.(i)}
                className="group flex flex-col items-center gap-1.5 disabled:cursor-default"
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-extrabold transition duration-200 ${
                    active
                      ? "scale-110 bg-brand-600 text-white shadow-[0_0_0_4px_var(--color-brand-100)]"
                      : done
                        ? "bg-brand-500 text-white group-hover:scale-105"
                        : "bg-surface-2 text-muted ring-1 ring-line"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className={`hidden text-xs font-semibold sm:block ${active ? "text-ink" : "text-muted"}`}>{label}</span>
              </button>
              {i < steps.length - 1 && (
                <span className="mx-2 mb-0 h-0.5 flex-1 overflow-hidden rounded-full bg-line sm:mb-5">
                  <span className={`block h-full bg-brand-500 transition-all duration-500 ${done ? "w-full" : "w-0"}`} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
