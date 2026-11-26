import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, mesAtual, mesCurto, type Compromisso, type CompromissoFatura, type Recorrente } from "../lib/api";
import SeletorMes from "../components/SeletorMes";

/** O mês pelo dinheiro que sai da conta, no mês em que sai. Só lê: a única ação é a decisão da sugestão, a mesma de Recorrentes. */
export default function ContasDoMes() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesAtual();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["compromissos", mes], queryFn: () => api.compromissos(mes) });
  const decidir = useMutation({
    mutationFn: api.decidirRecorrente,
    onSettled: () => Promise.all([["compromissos"], ["recorrentes"], ["ritmo"], ["analises"]].map((queryKey) => qc.invalidateQueries({ queryKey }))), // sugestão conta no alarme
  });
  const [aberta, setAberta] = useState<string | null>(null);
  const d = q.data, passou = mes < mesAtual();
  const erro = q.error ?? decidir.error;
  const acao = (l: Extract<Compromisso, { tipo: "recorrente" }>, status: Recorrente["status"], rotulo: string) => (
    <button className="botao secundario" aria-label={`${rotulo}: ${l.nome}, ${dinheiro(l.valor)}`} disabled={decidir.isPending}
      onClick={() => decidir.mutate({ chave: l.chave, valor: l.valor_chave, status })}>
      {rotulo}
    </button>
  );

  return (
    <section>
      <header className="topo">
        <h1>Contas do mês</h1>
        <SeletorMes mes={mes} onChange={(m) => setParams({ mes: m }, { replace: true })} />
      </header>

      {erro && <div className="aviso erro">{erro.message}</div>}

      <div className="cards quatro">
        <div className="card">
          <small>Renda esperada</small>
          <strong>{dinheiro(d ? d.renda.esperada : null)}</strong>
          {d && <span className="mudo pequeno">{d.renda.esperada === null ? "Sem renda esperada: defina no Orçamento." : `Já entrou ${dinheiro(d.renda.entrou)}`}</span>}
        </div>
        <div className="card">
          <small>Contas</small>
          <strong>{dinheiro(d?.total)}</strong>
          {d && <span className={`pequeno ${d.falta > 0 && passou ? "alerta" : "mudo"}`}>Pago {dinheiro(d.pago)} · {passou ? "não pago" : "falta"} {dinheiro(d.falta)}</span>}
        </div>
        <div className="card">
          <small>Metas</small>
          <strong>{dinheiro(d?.metas)}</strong>
          <Link className="mudo pequeno" to={`/metas?mes=${mes}`}>O que as metas pedem no mês →</Link>
        </div>
        <div className="card" title="Pelo vencimento: não é o mesmo número do Resumo nem a sobra do Orçamento.">
          <small>Livre depois das contas</small>
          <strong className={d?.livre != null && d.livre < 0 ? "neg" : ""}>{dinheiro(d?.livre)}</strong>
          <span className="mudo pequeno">Renda esperada − contas − metas. Pelo vencimento: não é o número do Resumo nem a sobra do Orçamento.</span>
        </div>
      </div>
      <p className="mudo pequeno">
        Só pessoa física. Cada linha é o que sai da conta no mês: a recorrente que cobra na conta e a fatura de cada cartão, que já tem as compras
        dele. O pago vem dos lançamentos do banco. Estes números não entram em nenhum outro; só confirmar ou ignorar uma sugestão muda o alarme,
        como em Recorrentes.
        {d && <> Atrasada = venceu e os dados do banco já vão até {dataCurta(d.dados_ate)}.</>}
      </p>

      <div className="tabela-wrap">
        <table className="tabela compacta contas-do-mes">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Dia</th>
              <th>Conta</th>
              <th className="num" style={{ width: 130 }}>Valor</th>
              <th style={{ width: 280 }}>Situação</th>
              <th style={{ width: 200 }}><span className="so-leitor">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {d?.linhas.length === 0 && <tr><td colSpan={5} className="vazio">Nenhuma conta neste mês.</td></tr>}
            {!d && <tr><td colSpan={5} className="vazio">{q.isLoading ? "Carregando…" : ""}</td></tr>}
            {d?.linhas.map((l) => {
              const id = l.tipo === "fatura" ? `f|${l.conta_id}|${l.dia}` : `r|${l.chave}|${l.valor_chave}|${l.dia}`;
              const resolvida = l.situacao === "paga" || l.situacao === "nao_paga";
              return (
                <Fragment key={id}>
                  <tr className={resolvida ? "resolvida" : ""}>
                    <td>{dataCurta(l.dia)}</td>
                    <td>
                      {l.tipo === "recorrente" ? (
                        <>
                          <span className="ponto" style={{ background: l.cor ?? "var(--mudo)" }} />{l.nome}
                          {l.sugestao && <span className="selo">sugestão</span>}
                          <div className="sub">{l.categoria ?? "Sem categoria"} · {l.conta}</div>
                          {l.parada && <div className="sub alerta"><span>Parou de cobrar? Se cancelou, marque Cancelei em <Link to="/recorrentes">Recorrentes</Link>.</span></div>}
                        </>
                      ) : (
                        <>
                          <span className="ponto" style={{ background: "var(--texto)" }} />Fatura {l.nome}
                          {l.estimada && <span className="selo">estimada</span>}
                          <div className="sub">Cartão · fecha em {dataCurta(l.fechamento)}</div>
                        </>
                      )}
                    </td>
                    <td className="num">{l.tipo === "fatura" && l.estimada && "≈ "}{dinheiro(l.valor)}</td>
                    <td><Situacao l={l} /></td>
                    <td>
                      <div className="acoes-linha">
                        {l.tipo === "recorrente" && l.sugestao && <>{acao(l, "confirmada", "Confirmar")}{acao(l, "ignorada", "Ignorar")}</>}
                        {l.tipo === "fatura" && (
                          <button className="botao secundario" aria-expanded={aberta === id} aria-label={`O que tem na fatura ${l.nome}`} onClick={() => setAberta(aberta === id ? null : id)}>
                            {aberta === id ? "Fechar" : "O que tem nela"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {l.tipo === "fatura" && aberta === id && <tr className="detalhe"><td /><td colSpan={4}><Detalhe f={l} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {d && d.linhas.some((l) => l.tipo === "recorrente" && l.sugestao) && (
        <p className="mudo pequeno">Sugestão: cobrança que se repete todo mês. Conta no alarme até você ignorar; é a mesma decisão da página Recorrentes.</p>
      )}
    </section>
  );
}

function Situacao({ l }: { l: Compromisso }) {
  const parcial = l.situacao !== "paga" && l.pago > 0 ? `paga ${dinheiro(l.pago)} de ${dinheiro(l.valor)}` : null;
  if (l.situacao === "paga") {
    const semFatura = l.tipo === "fatura" && l.sem_fatura;
    return <span className="ok">✓ {l.pago_em ? `paga em ${dataCurta(l.pago_em)}` : "nada a pagar"}{semFatura && <span className="mudo"> · sem o total do banco: vale o que foi pago</span>}</span>;
  }
  if (l.situacao === "nao_paga") {
    const para = l.tipo === "fatura" && l.foi_para ? ` foi para a fatura de ${mesCurto(l.foi_para)}` : "";
    return <span className="mudo">{parcial ? `${parcial} · o resto${para}` : `não paga ·${para}`}</span>;
  }
  return (
    <span>
      {l.situacao === "atrasada" && <span className="selo alerta">atrasada</span>} {parcial ?? (l.situacao === "a_pagar" ? "a pagar" : "")}
    </span>
  );
}

function Detalhe({ f }: { f: CompromissoFatura }) {
  const prevista = (p: boolean) => p && <span className="selo">prevista</span>;
  return (
    <div className="fatura-aberta">
      <p className="mudo pequeno">
        Já comprometido no ciclo: <b>{dinheiro(f.comprometido)}</b>
        {f.estimada ? " (o valor estimado é o maior entre isto e a média das 3 últimas faturas)." : "."}{" "}
        {/* o ciclo pega dois meses: o link vai para o que tem a maior parte dele */}
        <Link to={`/lancamentos?conta=${f.conta_id}&mes=${new Date(Date.parse(f.fechamento) - 15 * 86_400_000).toISOString().slice(0, 7)}`}>Ver os lançamentos do cartão →</Link>
      </p>
      {f.recorrentes.length > 0 && (
        <>
          <h3>Recorrentes do cartão</h3>
          <ul>{f.recorrentes.map((r, i) => <li key={i}><span>{r.nome} {prevista(r.prevista)}</span><span className="num">{dinheiro(r.valor)}</span></li>)}</ul>
        </>
      )}
      {f.parcelas.length > 0 && (
        <>
          <h3>Parcelas</h3>
          <ul>{f.parcelas.map((p, i) => <li key={i}><span>{p.descricao} <span className="mudo">{p.parcela}/{p.total}</span> {prevista(p.prevista)}</span><span className="num">{dinheiro(p.valor)}</span></li>)}</ul>
        </>
      )}
      <h3>Outras compras</h3>
      <ul><li><span>{f.outras.qtd} {f.outras.qtd === 1 ? "lançamento" : "lançamentos"} <span className="mudo">(com estornos abatidos)</span></span><span className="num">{dinheiro(f.outras.valor)}</span></li></ul>
    </div>
  );
}
