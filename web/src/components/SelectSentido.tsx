import { SENTIDOS, type Sentido } from "../lib/api";

/** Em que sentido a regra vale. `opcoes` tira o lado que não faria sentido oferecer. */
export default function SelectSentido({ valor, opcoes = ["saida", "entrada"], onChange }: {
  valor: Sentido | null;
  opcoes?: Sentido[];
  onChange: (s: Sentido | null) => void;
}) {
  return (
    <select className="campo sentido" name="sentido" aria-label="Vale para" value={valor ?? ""} onChange={(e) => onChange((e.target.value || null) as Sentido | null)}>
      <option value="">entrada e saída</option>
      {opcoes.map((s) => <option key={s} value={s}>{SENTIDOS[s]}</option>)}
    </select>
  );
}
