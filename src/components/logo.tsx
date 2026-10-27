/**
 * Marca Hagious (versão 2): "H" formado por duas barras arredondadas desniveladas, ligadas por um traço verde,
 * e o nome "Hagious" com o pingo do "i" em verde. Desenhada em vetor a partir das imagens enviadas
 * (versões para fundo claro e escuro).
 *
 * tone:
 * - "auto": acompanha o tema (claro/escuro) pelas variáveis --color-logo-*
 * - "onDark": sempre a versão clara (barra lateral e painel do login, que têm fundo escuro)
 */
type Tone = "auto" | "onDark";

const COLORS: Record<Tone, { ink: string; accent: string }> = {
  auto: { ink: "var(--color-logo-ink)", accent: "var(--color-logo-accent)" },
  onDark: { ink: "#f2f5f4", accent: "#3cc48e" },
};

export function HagiousMark({ className = "h-9 w-9", title = "Hagious", tone = "auto" }: { className?: string; title?: string; tone?: Tone }) {
  const c = COLORS[tone];
  return (
    <svg viewBox="0 0 115 126" className={className} role="img" aria-label={title}>
      <rect x="0" y="30" width="33" height="96" rx="7" fill={c.ink} />
      <rect x="82" y="0" width="33" height="96" rx="7" fill={c.ink} />
      <path d="M33 73 L82 41 L82 55 L33 87 Z" fill={c.accent} />
    </svg>
  );
}

/** Marca + nome, usada na barra lateral, no topo (celular) e no login. */
export function HagiousLogo({
  markClassName = "h-8 w-8",
  textClassName = "text-xl",
  tone = "auto",
}: {
  markClassName?: string;
  textClassName?: string;
  tone?: Tone;
}) {
  const c = COLORS[tone];
  return (
    <span className="flex items-center gap-2.5" aria-label="Hagious" role="img">
      <HagiousMark className={`${markClassName} shrink-0`} tone={tone} title="" />
      <span aria-hidden className={`font-extrabold tracking-tight whitespace-nowrap ${textClassName}`} style={{ color: c.ink }}>
        Hag
        {/* "i" sem pingo + pingo verde */}
        <span className="relative inline-block">
          ı
          <span
            className="absolute left-1/2 rounded-full"
            style={{ background: c.accent, width: "0.26em", height: "0.26em", top: "0.02em", transform: "translateX(-50%)" }}
          />
        </span>
        ous
      </span>
    </span>
  );
}
