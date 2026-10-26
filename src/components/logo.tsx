/**
 * Marca Hagious: "H" preto com traço amarelo, em quadrado branco com borda amarela.
 * Redesenhada em vetor (SVG) a partir da imagem original, para ficar nítida em qualquer tamanho.
 */
export function HagiousMark({ className = "h-9 w-9", title = "Hagious" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 458 458" className={className} role="img" aria-label={title}>
      <rect x="10.5" y="10.5" width="437" height="437" fill="#FFFFFF" stroke="#FCB913" strokeWidth="21" />
      <rect x="131" y="102" width="52" height="254" fill="#000000" />
      <rect x="269" y="102" width="52" height="254" fill="#000000" />
      <path
        d="M131 245 C 200 232, 268 238, 310 228 C 340 221, 360 205, 392 183"
        fill="none"
        stroke="#FCB913"
        strokeWidth="50"
        strokeLinecap="butt"
      />
    </svg>
  );
}

/** Marca + nome, usada na barra lateral e no login. */
export function HagiousLogo({ markClassName = "h-9 w-9", textClassName = "text-lg" }: { markClassName?: string; textClassName?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <HagiousMark className={`${markClassName} shrink-0 rounded-[4px]`} />
      <span className={`font-extrabold tracking-tight ${textClassName}`}>Hagious</span>
    </span>
  );
}
