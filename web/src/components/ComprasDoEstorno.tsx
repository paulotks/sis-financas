import { useQuery } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, type Lancamento } from "../lib/api";

/** Faixa abaixo de um crédito no cartão: as compras de onde ele pode ter vindo. Quem decide é o Paulo; um clique usa a categoria da compra. */
export default function ComprasDoEstorno({ l, onUsar, onFechar }: { l: Lancamento; onUsar: (compra: Lancamento) => void; onFechar: () => void }) {
  const compras = useQuery({ queryKey: ["compras", l.id], queryFn: () => api.comprasDoEstorno(l.id) });
  return (
    <div className="compras" onKeyDown={(e) => e.key === "Escape" && onFechar()}>
      {compras.isLoading && <p className="mudo">Procurando…</p>}
      {compras.error && <p className="erro">{compras.error.message}</p>}
      {compras.data?.length === 0 && <p className="mudo">Nenhuma compra desse valor ou maior neste cartão nos 120 dias anteriores.</p>}
      <ul>
        {compras.data?.map((c) => (
          <li key={c.id}>
            <span className="mudo">{dataCurta(c.data)}</span>
            <span className="nome">
              {c.descricao}
              {c.total_parcelas && c.total_parcelas > 1 && <span className="selo">{c.parcela}/{c.total_parcelas}</span>}
            </span>
            <span className="num">{dinheiro(c.valor_centavos)}</span>
            {c.categoria_id === null ? <span className="mudo">sem categoria</span>
              : c.categoria_id === l.categoria_id ? <span className="mudo">já está em {c.categoria}</span>
              : <button className="botao secundario" onClick={() => onUsar(c)}>Usar {c.categoria}</button>}
          </li>
        ))}
      </ul>
      <button className="botao secundario" onClick={onFechar}>Fechar</button>
    </div>
  );
}
