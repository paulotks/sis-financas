import { lerDinheiro } from "../lib/api";

const formatar = (centavos: number | null) =>
  centavos ? (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

/** Valor editável direto na tabela: Enter ou sair do campo salva, Esc desfaz. */
export default function CampoDinheiro({ valor, rotulo, sugestao = null, negativo = false, obrigatorio = false, onSalvar }: {
  valor: number | null;
  rotulo: string;
  sugestao?: number | null; // aparece apagada enquanto nada foi digitado
  negativo?: boolean; // aceita valor abaixo de zero (dívida)
  obrigatorio?: boolean; // vazio ou zero não salva
  onSalvar: (centavos: number) => void;
}) {
  const inicial = formatar(valor);
  return (
    <input
      key={inicial} // valor novo do servidor recomeça o campo
      className="editavel num"
      name="valor"
      inputMode="decimal"
      aria-label={rotulo}
      placeholder={formatar(sugestao) || "—"}
      defaultValue={inicial}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        const lido = lerDinheiro(e.target.value);
        const invalido = lido === null || (!negativo && lido < 0) || (obrigatorio && lido === 0);
        e.target.setAttribute("aria-invalid", String(invalido));
        if (!invalido && lido !== (valor ?? 0)) onSalvar(lido);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.value = inicial;
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}
