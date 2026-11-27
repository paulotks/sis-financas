import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, lerDinheiro, type Bem } from "../lib/api";
import CampoDinheiro from "./CampoDinheiro";
import LinhaPatrimonio from "./LinhaPatrimonio";

/** Patrimônio líquido no topo de Contas: total, evolução, composição e as linhas manuais (bens e dívidas). */
export default function Patrimonio() {
  const [params, setParams] = useSearchParams();
  const pessoa = params.get("pessoa") === "PJ" ? "PJ" : "PF";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["patrimonio", pessoa], queryFn: () => api.patrimonio(pessoa) });
  const aoSalvar = { onSettled: () => Promise.all([["patrimonio"], ["metas"]].map((queryKey) => qc.invalidateQueries({ queryKey }))) }; // bem ou dívida pode medir uma meta
  const criar = useMutation({ mutationFn: api.criarBem, ...aoSalvar });
  const editar = useMutation({ mutationFn: ({ id, ...d }: { id: number; nome?: string; valor_centavos?: number }) => api.editarBem(id, d), ...aoSalvar });
  const apagar = useMutation({ mutationFn: api.apagarBem, ...aoSalvar });
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const lido = lerDinheiro(valor);
  const erro = q.error ?? criar.error ?? editar.error ?? apagar.error;
  const d = q.data;
  const bens = d?.lista_bens ?? [];
  const quitados = bens.filter((b) => b.valor_centavos === 0);

  // valor 0 = quitado ou vendido: sai da lista e o passado fica. Apagar (que muda dias passados) só de lá, e é para engano
  const linha = (b: Bem) => (
    <li key={b.id}>
      <input
        key={b.nome}
        className="editavel"
        name="nome"
        aria-label={`Nome de ${b.nome}`}
        maxLength={60}
        defaultValue={b.nome}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== b.nome) editar.mutate({ id: b.id, nome: v });
          else e.target.value = b.nome;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.value = b.nome;
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <CampoDinheiro valor={b.valor_centavos} negativo rotulo={`Valor de ${b.nome}`} onSalvar={(valor_centavos) => editar.mutate({ id: b.id, valor_centavos })} />
      {b.valor_centavos !== 0 ? (
        <button
          className="icone-botao"
          title="Quitado, vendido ou já vem do banco: zera o valor e guarda a evolução"
          aria-label={`${b.nome}: quitado, vendido ou já vem do banco`}
          onClick={() =>
            confirm(`"${b.nome}" foi quitado, vendido ou já vem do banco? O valor vai a 0 de hoje em diante e os dias anteriores não mudam.`) &&
            editar.mutate({ id: b.id, valor_centavos: 0 })
          }
        >
          ✓
        </button>
      ) : (
        <button
          className="icone-botao"
          title="Apagar de vez (muda os dias anteriores da evolução)"
          aria-label={`Apagar ${b.nome}`}
          onClick={() => confirm(`Apagar "${b.nome}" de vez? A linha some também da evolução e muda os dias anteriores. Só faça isso se ela foi criada por engano.`) && apagar.mutate(b.id)}
        >
          ✕
        </button>
      )}
    </li>
  );

  return (
    <div className="patrimonio">
      {erro && <div className="aviso erro flutuante" role="alert">{erro.message}</div>}
      <div className="duas-colunas">
        <div className="painel">
          <div className="painel-topo">
            <small className="mudo">Patrimônio líquido</small>
            <div className="segmentado pequeno">
              {(["PF", "PJ"] as const).map((p) => (
                <button key={p} className={pessoa === p ? "ativo" : ""} aria-pressed={pessoa === p} onClick={() => setParams(p === "PJ" ? { pessoa: p } : {}, { replace: true })}>{p}</button>
              ))}
            </div>
          </div>
          <strong className={`grande ${d && d.total < 0 ? "neg" : ""}`}>{dinheiro(d?.total)}</strong>
          <small className="mudo">Posição nos bancos conectados, mais o que você lançou à mão. O que está fora daqui não entra.</small>
          {d && <LinhaPatrimonio key={pessoa} pontos={d.historico} />}
          <dl className="saldos">
            <dt>Contas</dt><dd>{dinheiro(d?.contas)}</dd>
            <dt>Investimentos e cofrinhos</dt><dd>{dinheiro(d?.investimentos)}</dd>
            <dt>Bens</dt><dd>{dinheiro(d?.bens)}</dd>
            <dt>Cartões e dívidas</dt><dd>{dinheiro(d ? -d.dividas : null)}</dd>
          </dl>
          {d && d.historico.length > 1 && (
            <details className="pequeno mudo">
              <summary>Ver a evolução em valores</summary>
              <table className="tabela compacta">
                <tbody>
                  {d.historico.toReversed().map((p) => (
                    <tr key={p.data}><td>{dataCurta(p.data)}</td><td className="num">{dinheiro(p.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>

        <div className="painel">
          <small className="mudo">Bens e dívidas (à mão)</small>
          <ul className="bens">{bens.filter((b) => b.valor_centavos !== 0).map(linha)}</ul>
          {quitados.length > 0 && (
            <details className="pequeno mudo">
              <summary>Quitados e vendidos ({quitados.length})</summary>
              <ul className="bens">{quitados.map(linha)}</ul>
            </details>
          )}
          <form
            className="linha-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!nome.trim() || lido === null) return;
              criar.mutate({ nome: nome.trim(), valor_centavos: lido, pessoa }, { onSuccess: () => (setNome(""), setValor("")) });
            }}
          >
            <input className="campo" name="novo-nome" aria-label="Nome do bem ou dívida" placeholder="Carro, imóvel…" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
            <input className="campo num" name="novo-valor" aria-label="Valor" inputMode="decimal" placeholder="0,00" value={valor} aria-invalid={lido === null} onChange={(e) => setValor(e.target.value)} />
            <button className="botao secundario" disabled={!nome.trim() || !valor.trim() || lido === null || criar.isPending}>Adicionar</button>
          </form>
          <p className="mudo pequeno">
            Para o que o banco não manda: carro, imóvel, cofrinho que não aparece na conta. Dívida vai com sinal de menos (−20.000). Cartões já
            entram sozinhos pelo limite usado, com as parcelas futuras, e o cofrinho que o banco informa, pela conta: não lance de novo.
          </p>
        </div>
      </div>
    </div>
  );
}
