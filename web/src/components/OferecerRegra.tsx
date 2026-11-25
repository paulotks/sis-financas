import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, sugerirPadrao, type Lancamento, type Sentido } from "../lib/api";
import SelectSentido from "./SelectSentido";

/** Faixa que aparece depois de corrigir uma categoria: transforma a correção em regra com um clique. */
export default function OferecerRegra({ l, onFechar }: { l: Lancamento; onFechar: (aviso?: string) => void }) {
  const qc = useQueryClient();
  const [padrao, setPadrao] = useState(() => sugerirPadrao(l.descricao_original));
  const doLancamento: Sentido = l.valor_centavos < 0 ? "saida" : "entrada";
  const [sentido, setSentido] = useState<Sentido | null>(doLancamento);
  const texto = padrao.trim();
  const contido = l.descricao_original.toLowerCase().includes(texto.toLowerCase());
  const valido = texto.length >= 3 && contido;
  const previa = useQuery({
    queryKey: ["previaRegra", texto, sentido, l.categoria_id],
    queryFn: () => api.previaRegra(texto, sentido, l.categoria_id),
    enabled: valido,
    placeholderData: keepPreviousData,
  });
  const criar = useMutation({
    mutationFn: () => api.criarRegra({ padrao: texto, sentido, categoria_id: l.categoria_id! }),
    onSuccess: ({ recategorizados }) => {
      qc.invalidateQueries();
      onFechar(`Regra criada para ${l.categoria}: ${recategorizados} lançamento(s) mudaram de categoria.`);
    },
  });
  const n = previa.data;

  return (
    <form
      className="oferta"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido && !criar.isPending) criar.mutate();
      }}
      onKeyDown={(e) => e.key === "Escape" && onFechar()}
    >
      <span>Sempre que a descrição contiver</span>
      <input className="campo" name="padrao" aria-label="Texto da regra" maxLength={120} value={padrao} onChange={(e) => setPadrao(e.target.value)} />
      <SelectSentido valor={sentido} opcoes={[doLancamento]} onChange={setSentido} />
      <span>→ <strong>{l.categoria}</strong></span>
      <span className="mudo" aria-live="polite">
        {!contido ? "o texto precisa estar na descrição original"
          : !valido ? "use pelo menos 3 letras"
          : !n ? "…"
          : n.total === 0 ? "nenhum outro muda; vale para os próximos"
          : `${n.total} ${n.total > 1 ? "mudam" : "muda"} de categoria (${n.pendentes} sem categoria hoje)`}
      </span>
      <button className="botao" disabled={!valido || criar.isPending}>Criar regra</button>
      <button type="button" className="botao secundario" onClick={() => onFechar()}>Agora não</button>
      {criar.error && <span className="erro">{criar.error.message}</span>}
    </form>
  );
}
