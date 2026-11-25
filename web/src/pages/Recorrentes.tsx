import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, type Recorrente } from "../lib/api";

export default function Recorrentes() {
  const [params, setParams] = useSearchParams();
  const pessoa = params.get("pessoa") === "PJ" ? "PJ" : "PF";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["recorrentes", pessoa], queryFn: () => api.recorrentes(pessoa) });
  const decidir = useMutation({
    mutationFn: api.decidirRecorrente,
    onSettled: () => Promise.all([["recorrentes"], ["ritmo"], ["analises"]].map((queryKey) => qc.invalidateQueries({ queryKey }))), // ignorar muda o "pode gastar por dia"
  });
  const lista = q.data ?? [];
  const confirmadas = lista.filter((r) => r.status === "confirmada");
  const sugestoes = lista.filter((r) => r.status === null);
  const canceladas = lista.filter((r) => r.status === "cancelada");
  const ignoradas = lista.filter((r) => r.status === "ignorada");
  const propostas = lista.filter((r) => r.proposta);
  const porMes = (rs: Recorrente[]) => rs.filter((r) => r.situacao !== "parada").reduce((s, r) => s + r.valor, 0);
  const acao = (r: Recorrente, status: Recorrente["status"], rotulo: string) => (
    <button
      className="botao secundario"
      aria-label={`${rotulo}: ${r.descricao}, ${dinheiro(r.valor)}`}
      disabled={decidir.isPending}
      onClick={() => decidir.mutate({ chave: r.chave, valor: r.valor_chave, status })}
    >
      {rotulo}
    </button>
  );
  const erro = q.error ?? decidir.error;

  return (
    <section>
      <header className="topo">
        <h1>Recorrentes</h1>
        <div className="segmentado">
          {(["PF", "PJ"] as const).map((p) => (
            <button key={p} className={pessoa === p ? "ativo" : ""} onClick={() => setParams(p === "PJ" ? { pessoa: p } : {}, { replace: true })}>{p}</button>
          ))}
        </div>
      </header>

      {erro && <div className="aviso erro">{erro.message}</div>}

      <div className="cards">
        <div className="card"><small>Confirmadas por mês</small><strong>{dinheiro(q.data ? porMes(confirmadas) : null)}</strong></div>
        <div className="card"><small>Sugestões por mês</small><strong>{dinheiro(q.data ? porMes(sugestoes) : null)}</strong></div>
        <div className="card"><small>Próximo vencimento</small><strong>{proximo(confirmadas)}</strong></div>
      </div>

      {canceladas.filter((r) => r.cobrou_depois).map((r) => (
        <div className="aviso erro" key={idDe(r)}>
          <b>{r.descricao}</b> cobrou {dinheiro(r.cobrou_depois!.valor)} em {dataCurta(r.cobrou_depois!.data)}, depois de cancelada. Se você voltou a assinar, clique em Reativar.
        </div>
      ))}

      {propostas.length > 0 && (
        <>
          <h2>O Claude sugere</h2>
          <p className="mudo pequeno">Nada muda nos números até você aceitar.</p>
          <Tabela lista={propostas} pessoa={pessoa} vazio=""
            nota={(r) => `${PROPOSTA[r.proposta!]} (hoje: ${r.status ?? "sugestão"})`}
            acoes={(r) => <>{acao(r, r.proposta === "sugerida" ? null : r.proposta, "Aceitar")}{acao(r, r.status, "Recusar")}</>} />
        </>
      )}

      <h2>Confirmadas</h2>
      <Tabela lista={confirmadas} pessoa={pessoa} vazio="Nenhuma ainda. Confirme as que reconhecer na lista de sugestões."
        acoes={(r) => <>{acao(r, "cancelada", "Cancelei")}{acao(r, null, "Desfazer")}</>} />

      <h2>Sugestões</h2>
      <p className="mudo pequeno">
        Cobranças que se repetem todo mês com valor parecido (3 vezes ou mais). <b>Contam no alarme até você ignorar.</b> Parcelas,
        transferências e o que está ignorado ficam fora.
      </p>
      <Tabela lista={sugestoes} pessoa={pessoa} vazio={q.isLoading ? "Carregando…" : "Nenhuma cobrança repetida por enquanto."}
        acoes={(r) => <>{acao(r, "confirmada", "Confirmar")}{acao(r, "ignorada", "Ignorar")}</>} />

      {canceladas.length > 0 && (
        <details className="ignoradas" open={canceladas.some((r) => r.cobrou_depois)}>
          <summary className="mudo">Canceladas ({canceladas.length}): não contam no alarme, e aviso se cobrarem de novo</summary>
          <Tabela lista={canceladas} pessoa={pessoa} vazio="" acoes={(r) => acao(r, "confirmada", "Reativar")} />
        </details>
      )}

      {ignoradas.length > 0 && (
        <details className="ignoradas">
          <summary className="mudo">Ignoradas ({ignoradas.length})</summary>
          <Tabela lista={ignoradas} pessoa={pessoa} vazio="" acoes={(r) => acao(r, null, "Desfazer")} />
        </details>
      )}
    </section>
  );
}

/** O mesmo lugar pode ter várias cobranças: a chave sozinha se repete. */
const idDe = (r: Recorrente) => `${r.chave}|${r.valor_chave}|${r.ultima}`;
const PROPOSTA = { confirmada: "Confirmar", ignorada: "Ignorar", cancelada: "Marcar como cancelada", sugerida: "Voltar para sugestão" };

const proximo = (rs: Recorrente[]) => {
  const r = rs.find((x) => x.situacao === "prevista"); // a API já manda em ordem de vencimento
  return r ? `${dataCurta(r.proxima)} · ${dinheiro(r.valor)}` : "—";
};

function Tabela({ lista, pessoa, vazio, nota, acoes }: {
  lista: Recorrente[];
  pessoa: string;
  vazio: string;
  nota?: (r: Recorrente) => string;
  acoes: (r: Recorrente) => React.ReactNode;
}) {
  return (
    <div className="tabela-wrap">
      <table className="tabela compacta">
        <thead>
          <tr>
            <th>Descrição</th>
            <th style={{ width: 150 }}>Próxima</th>
            <th style={{ width: 90 }}>Última</th>
            <th className="num" style={{ width: 120 }}>Valor</th>
            <th style={{ width: 210 }}><span className="so-leitor">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && <tr><td colSpan={5} className="vazio">{vazio}</td></tr>}
          {lista.map((r) => (
            <tr key={idDe(r)} className={r.situacao === "parada" ? "ignorado" : ""}>
              <td>
                <Link className="discreto" to={`/lancamentos?todos=1&busca=${encodeURIComponent(r.descricao)}${pessoa === "PJ" ? "&pessoa=PJ" : ""}`}>
                  <span className="ponto" style={{ background: r.cor ?? "var(--mudo)" }} />{r.descricao}
                </Link>
                <div className="sub">{r.categoria ?? "Sem categoria"} · {r.conta} · {r.vezes} vezes{r.antes && <> · antes: {r.antes}</>}</div>
                {nota && <div className="sub"><b>{nota(r)}</b></div>}
              </td>
              <td>
                {r.status === "cancelada"
                  ? <span className="mudo">cancelada {r.cobrou_depois && <span className="selo alerta">cobrou de novo</span>}</span>
                  : r.situacao === "parada"
                  ? <span className="mudo">sem cobrança desde {dataCurta(r.ultima)}</span>
                  : <>{dataCurta(r.proxima)} {r.situacao === "atrasada" && <span className="selo alerta">atrasada</span>}</>}
              </td>
              <td className="mudo">{dataCurta(r.ultima)}</td>
              <td className="num">{dinheiro(r.valor)}</td>
              <td><div className="acoes-linha">{acoes(r)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
