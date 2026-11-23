import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dinheiro, GRUPOS, mesAtual, type Categoria, type LinhaOrcamento } from "../lib/api";
import CampoDinheiro from "../components/CampoDinheiro";
import SeletorMes from "../components/SeletorMes";

const soma = (ls: LinhaOrcamento[], k: "planejado" | "realizado") => ls.reduce((s, l) => s + (l[k] ?? 0), 0);

export default function Orcamento() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesAtual();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["orcamento", mes], queryFn: () => api.orcamento(mes) });
  const salvar = useMutation({
    mutationFn: api.salvarOrcamento,
    onSettled: () => qc.invalidateQueries({ queryKey: ["orcamento"] }), // muda também os meses seguintes
  });

  const linhas = q.data?.linhas ?? [];
  const planejado = soma(linhas, "planejado");
  const gasto = soma(linhas, "realizado") + (q.data?.sem_categoria ?? 0);
  const resta = planejado - gasto;

  return (
    <section>
      <header className="topo">
        <h1>Orçamento</h1>
        <SeletorMes mes={mes} onChange={(m) => setParams({ mes: m }, { replace: true })} />
      </header>

      {(q.error ?? salvar.error) && <div className="aviso erro">{(q.error ?? salvar.error)!.message}</div>}

      <div className="cards">
        <div className="card"><small>Planejado</small><strong>{dinheiro(q.data ? planejado : null)}</strong></div>
        <div className="card"><small>Gasto</small><strong>{dinheiro(q.data ? gasto : null)}</strong></div>
        <div className="card"><small>Resta</small><strong className={resta < 0 ? "neg" : ""}>{dinheiro(q.data ? resta : null)}</strong></div>
      </div>
      <p className="mudo pequeno">
        Só pessoa física. Digite o planejado na própria linha: ele vale deste mês em diante, até você mudar. Meses anteriores não mudam.
      </p>

      <div className="tabela-wrap">
        <table className="tabela orcamento">
          <thead>
            <tr>
              <th>Categoria</th>
              <th className="num" style={{ width: 150 }}>Planejado</th>
              <th className="num" style={{ width: 130 }}>Gasto</th>
              <th className="num" style={{ width: 130 }}>Resta</th>
              <th style={{ width: "28%" }}><span className="so-leitor">Progresso</span></th>
            </tr>
          </thead>
          {q.isLoading && <tbody><tr><td colSpan={5} className="vazio">Carregando…</td></tr></tbody>}
          {(Object.keys(GRUPOS) as Categoria["grupo"][]).map((g) => {
            const doGrupo = linhas.filter((l) => l.grupo === g);
            if (!doGrupo.length) return null;
            return (
              <tbody key={g}>
                <tr className="grupo">
                  <th scope="rowgroup">{GRUPOS[g]}</th>
                  <td className="num">{dinheiro(soma(doGrupo, "planejado"))}</td>
                  <td className="num">{dinheiro(soma(doGrupo, "realizado"))}</td>
                  <td className="num">{dinheiro(soma(doGrupo, "planejado") - soma(doGrupo, "realizado"))}</td>
                  <td />
                </tr>
                {doGrupo.map((l) => (
                  <Linha
                    key={l.categoria_id}
                    l={l}
                    mes={mes}
                    onSalvar={(valor_centavos) => salvar.mutate({ mes, categoria_id: l.categoria_id, valor_centavos })}
                  />
                ))}
              </tbody>
            );
          })}
          {!!q.data?.sem_categoria && (
            <tbody>
              <tr className="pendente">
                <td>Sem categoria</td>
                <td className="num mudo">—</td>
                <td className="num"><Link to={`/lancamentos?mes=${mes}&pendentes=1`}>{dinheiro(q.data.sem_categoria)}</Link></td>
                <td />
                <td className="mudo pequeno"><Link to={`/lancamentos?mes=${mes}&pendentes=1`}>categorizar →</Link></td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </section>
  );
}

function Linha({ l, mes, onSalvar }: { l: LinhaOrcamento; mes: string; onSalvar: (centavos: number) => void }) {
  const p = l.planejado ?? 0;
  const pct = p ? (l.realizado / p) * 100 : 0;
  const nivel = pct > 100 ? "estourou" : pct > 90 ? "perto" : "";
  return (
    <tr>
      <td><span className="ponto" style={{ background: l.cor ?? "var(--mudo)" }} />{l.categoria}</td>
      <td><CampoDinheiro valor={l.planejado} rotulo={`Planejado para ${l.categoria}`} onSalvar={onSalvar} /></td>
      <td className="num">
        {l.realizado
          ? <Link to={`/lancamentos?mes=${mes}&categoria=${l.categoria_id}`}>{dinheiro(l.realizado)}</Link>
          : <span className="mudo">{dinheiro(0)}</span>}
      </td>
      <td className={`num ${p && p - l.realizado < 0 ? "neg" : "mudo"}`}>{p ? dinheiro(p - l.realizado) : "—"}</td>
      <td>
        {p > 0 && (
          <div className="progresso">
            <span className={`barra ${nivel}`}><span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
            <small className={nivel === "estourou" ? "neg" : nivel === "perto" ? "alerta" : "mudo"}>{Math.round(pct)}%</small>
          </div>
        )}
      </td>
    </tr>
  );
}
