import { GRUPOS, type Categoria } from "../lib/api";

export default function SelectCategoria({ categorias, valor, vazio, rotulo = "Categoria", cor, className = "", onChange }: {
  categorias: Categoria[];
  valor: number | null;
  vazio: string;
  rotulo?: string;
  cor?: string | null;
  className?: string;
  onChange: (id: number | null) => void;
}) {
  const grupos = (Object.keys(GRUPOS) as Categoria["grupo"][]).filter((g) => categorias.some((c) => c.grupo === g));
  return (
    <select
      className={`campo categoria ${className}`}
      name="categoria"
      aria-label={rotulo}
      style={cor ? { borderLeftColor: cor } : undefined}
      value={valor ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{vazio}</option>
      {grupos.map((g) => (
        <optgroup key={g} label={GRUPOS[g]}>
          {categorias.filter((c) => c.grupo === g).map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
