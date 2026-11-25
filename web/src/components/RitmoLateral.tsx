import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, dinheiro, dinheiroCurto, limiteTexto, mesAtual, nivelTexto, nomeDoMes } from "../lib/api";

/** Linha fixa do menu, em todas as telas: sempre o mês atual, mesmo olhando outro mês. */
export default function RitmoLateral() {
  const mes = mesAtual();
  const { data: r } = useQuery({ queryKey: ["ritmo", mes], queryFn: () => api.ritmo(mes) });
  const nivel = r && nivelTexto(r);
  if (!r || !nivel) return null;
  return (
    <Link className={`ritmo-lateral ${r.nivel}`} to="/resumo">
      <small>{nomeDoMes(mes)}</small>
      <span className={`nivel ${r.nivel}`}><span aria-hidden="true">{nivel.icone}</span> {nivel.texto}</span>
      {r.por_dia && <small>{r.por_dia.livre < 0 ? `Passou ${dinheiro(-r.por_dia.livre)}` : `${dinheiro(r.por_dia.valor)} por dia`}</small>}
      {r.projecao && r.teto !== null && <small>Contra {limiteTexto(r)}: <span className="num">{dinheiroCurto(r.teto - r.projecao.media)}</span></small>}
    </Link>
  );
}
