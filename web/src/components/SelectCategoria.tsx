import { GRUPOS, type Categoria } from "../lib/api";

export default function SelectCategoria({ categorias, valor, vazio, cor, onChange }: {
  categorias: Categoria[];
  valor: number | null;
  vazio: string;
  cor?: string | null;
  onChange: (id: number | null) => void;
}) {
  const grupos = Object.keys(GRUPOS) as Categoria["grupo"][];
  return (
    <select
      className="campo categoria"
      name="categoria"
      aria-label="Categoria"
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
