// Mostrado imediatamente ao trocar de tela, enquanto os dados chegam do banco.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="mb-6 space-y-2">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="card mt-6 space-y-3 p-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
