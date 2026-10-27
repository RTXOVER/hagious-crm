/*
 * Gráficos simples em HTML/CSS (sem biblioteca externa).
 * Seguem as regras de visualização do projeto: uma única cor de série validada
 * (--color-chart), barras finas com ponta arredondada, rótulos em cor de texto,
 * dica ao passar o mouse/teclado e uma tabela equivalente para acessibilidade.
 */
import Link from "next/link";

type Datum = { key: string; label: string; value: number; href?: string };

/** "1 cliente" / "2 clientes" */
const withUnit = (value: number, unit: string) => `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;

function Tooltip({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-(--shadow-lift) group-focus-within:block group-hover:block"
    >
      <span className="block text-sm font-extrabold text-ink">{withUnit(value, unit)}</span>
      <span className="block text-muted">{label}</span>
    </span>
  );
}

function TableView({ data, labelHeader, valueHeader }: { data: Datum[]; labelHeader: string; valueHeader: string }) {
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">Ver como tabela</summary>
      <table className="table-base mt-2">
        <thead>
          <tr>
            <th>{labelHeader}</th>
            <th className="text-right">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <td>{d.label}</td>
              <td className="text-right tabular-nums">{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Barras horizontais: comparar quantidades entre categorias. */
export function BarList({
  data,
  unit,
  labelHeader,
  valueHeader = "Quantidade",
}: {
  data: Datum[];
  unit: string;
  labelHeader: string;
  valueHeader?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <ul className="space-y-3">
        {data.map((d) => {
          const pct = (d.value / max) * 100;
          const bar = (
            <span className="group relative flex items-center gap-3 outline-none" tabIndex={d.href ? -1 : 0} aria-label={`${d.label}: ${withUnit(d.value, unit)}`}>
              <span className="w-36 shrink-0 truncate text-sm text-muted sm:w-44" title={d.label}>{d.label}</span>
              <span className="relative flex h-6 flex-1 items-center">
                {/* Barra: 20px de altura, ponta arredondada só no fim, base reta */}
                <span
                  className="h-5 rounded-r-[4px] bg-chart transition-[filter,width] duration-300 group-hover:brightness-110 group-focus-within:brightness-110"
                  style={{ width: d.value ? `max(${pct}%, 4px)` : "0" }}
                />
                <span className="ml-2 text-sm font-bold tabular-nums">{d.value}</span>
                <Tooltip label={d.label} value={d.value} unit={unit} />
              </span>
            </span>
          );
          return (
            <li key={d.key}>
              {d.href ? (
                <Link href={d.href} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  {bar}
                </Link>
              ) : (
                bar
              )}
            </li>
          );
        })}
      </ul>
      <TableView data={data} labelHeader={labelHeader} valueHeader={valueHeader} />
    </div>
  );
}

/** Colunas: evolução mês a mês. Rotula só o último mês e o maior valor; os demais ficam na dica e na tabela. */
export function ColumnChart({ data, unit, labelHeader }: { data: Datum[]; unit: string; labelHeader: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const maxIdx = data.findIndex((d) => d.value === max);
  const plotH = 140;
  return (
    <div>
      <div className="flex items-end justify-around gap-2 border-b border-line" style={{ height: plotH + 24 }}>
        {data.map((d, i) => {
          const h = (d.value / max) * plotH;
          const labeled = i === data.length - 1 || (i === maxIdx && d.value > 0);
          return (
            <div
              key={d.key}
              className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none"
              tabIndex={0}
              aria-label={`${d.label}: ${withUnit(d.value, unit)}`}
            >
              {labeled && <span className="mb-1 text-xs font-bold tabular-nums">{d.value}</span>}
              {/* A dica nasce logo acima da coluna, não no topo do gráfico */}
              <span className="relative flex w-full justify-center">
                <span
                  className="w-6 rounded-t-[4px] bg-chart transition-[filter,height] duration-300 group-hover:brightness-110 group-focus:brightness-110"
                  style={{ height: d.value ? Math.max(h, 3) : 0 }}
                />
                <Tooltip label={d.label} value={d.value} unit={unit} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-around gap-2">
        {data.map((d) => (
          <span key={d.key} className="flex-1 text-center text-xs text-muted capitalize">{d.label}</span>
        ))}
      </div>
      <TableView data={data} labelHeader={labelHeader} valueHeader={unit} />
    </div>
  );
}

/** Medidor de proporção (ex.: contatos com autorização). Trilho e preenchimento da mesma cor. */
export function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-chart-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-chart transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">
        {value} de {total} ({pct}%)
      </p>
    </div>
  );
}

type RateDatum = { key: string; label: string; part: number; total: number; href?: string };

/**
 * Percentual por categoria (ex.: prazo cumprido por departamento). Trilho + preenchimento da cor única do gráfico;
 * o número fica em cor de texto ao lado, com a base ("8 de 10") para não esconder amostras pequenas.
 */
export function RateList({ data, labelHeader, partHeader, totalHeader }: { data: RateDatum[]; labelHeader: string; partHeader: string; totalHeader: string }) {
  return (
    <div>
      <ul className="space-y-3">
        {data.map((d) => {
          const pct = d.total ? Math.round((d.part / d.total) * 100) : null;
          const row = (
            <span className="group relative flex items-center gap-3" aria-label={`${d.label}: ${pct === null ? "sem base" : `${pct}% (${d.part} de ${d.total})`}`}>
              <span className="w-36 shrink-0 truncate text-sm text-muted sm:w-44" title={d.label}>{d.label}</span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-chart-track">
                <span className="absolute inset-y-0 left-0 rounded-full bg-chart transition-[width] duration-500 group-hover:brightness-110" style={{ width: `${pct ?? 0}%` }} />
              </span>
              <span className="w-28 shrink-0 text-right text-sm tabular-nums">
                {pct === null ? <span className="text-muted">sem base</span> : <><strong>{pct}%</strong> <span className="text-xs text-muted">{d.part}/{d.total}</span></>}
              </span>
            </span>
          );
          return (
            <li key={d.key}>
              {d.href ? <Link href={d.href} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{row}</Link> : row}
            </li>
          );
        })}
      </ul>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">Ver como tabela</summary>
        <table className="table-base mt-2">
          <thead>
            <tr><th>{labelHeader}</th><th className="text-right">{partHeader}</th><th className="text-right">{totalHeader}</th><th className="text-right">%</th></tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="text-right tabular-nums">{d.part}</td>
                <td className="text-right tabular-nums">{d.total}</td>
                <td className="text-right tabular-nums">{d.total ? `${Math.round((d.part / d.total) * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
