export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  green: "bg-ok-soft text-ok ring-ok/25",
  amber: "bg-warn-soft text-warn ring-warn/25",
  red: "bg-danger-soft text-danger ring-danger/25",
  gray: "bg-neutral-soft text-muted ring-line",
  blue: "bg-info-soft text-info ring-info/25",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Alert({ tone, children }: { tone: "ok" | "warn" | "danger" | "info"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
  }[tone];
  return (
    <p role={tone === "danger" || tone === "warn" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm font-medium ${cls}`}>
      {children}
    </p>
  );
}

export function FormMessage({ state }: { state: { ok?: boolean; message?: string; errors?: Record<string, string> } }) {
  if (state.errors?._form) return <Alert tone="danger">{state.errors._form}</Alert>;
  if (state.ok && state.message) return <Alert tone="ok">{state.message}</Alert>;
  return null;
}
