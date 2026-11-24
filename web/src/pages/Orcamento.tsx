import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dinheiro, GRUPOS, mesAtual, type Categoria, type LinhaOrcamento, type Orcamento as DadosOrcamento } from "../lib/api";
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
    onSettled: () => Promise.all([["orcamento"], ["ritmo"]].map((queryKey) => qc.invalidateQueries({ queryKey }))), // muda também os meses seguintes
  });

  const linhas = q.data?.linhas ?? [];
  const planejado = soma(linhas, "planejado");
  const gasto = soma(linhas, "realizado") + (q.data?.sem_categoria ?? 0);
  const resta = planejado - gasto;
  const esperada = q.data?.renda_esperada ?? null;
  const sobra = esperada === null ? null : esperada - planejado;

  return (
    <section>
      <header className="topo">
        <h1>Orçamento</h1>
        <SeletorMes mes={mes} onChange={(m) => setParams({ mes: m }, { replace: true })} />
      </header>

      {(q.error ?? salvar.error) && <div className="aviso erro">{(q.error ?? salvar.error)!.message}</div>}

      <div className="cards quatro">
        <div className="card">
          <small>Renda esperada</small>
          <strong>{dinheiro(esperada)}</strong>
          <span className="mudo pequeno">
            {!q.data ? "" : esperada === null ? "Digite na linha da renda, abaixo." : q.data.renda_origem === "definida" ? "Definida por você." : "Mediana dos 3 últimos meses fechados."}
          </span>
        </div>
        <div className="card">
          <small>Planejado</small>
          <strong>{dinheiro(q.data ? planejado : null)}</strong>
          {!!esperada && <span className="mudo pequeno">{Math.round((planejado / esperada) * 100)}% da renda esperada</span>}
        </div>
        <div className="card">
          <small>Sobra planejada</small>
          <strong className={sobra !== null && sobra < 0 ? "neg" : ""}>{dinheiro(sobra)}</strong>
          {sobra !== null && (
            <span className={`pequeno ${sobra < 0 ? "neg" : "mudo"}`}>
              {sobra < 0 ? "▲ O plano não cabe na renda." : "É o que você guarda se cumprir tudo."}
            </span>
          )}
        </div>
        <div className="card">
          <small>Gasto</small>
          <strong>{dinheiro(q.data ? gasto : null)}</strong>
          {q.data && planejado > 0 && (
            <span className={`pequeno ${resta < 0 ? "neg" : "mudo"}`}>{resta < 0 ? `Passou ${dinheiro(-resta)} do planejado` : `Restam ${dinheiro(resta)} do planejado`}</span>
          )}
        </div>
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
          {q.data && <Renda d={q.data} mes={mes} onSalvar={(categoria_id, valor_centavos) => salvar.mutate({ mes, categoria_id, valor_centavos })} />}
          {(Object.keys(GRUPOS) as Categoria["grupo"][]).map((g) => {
            const doGrupo = linhas.filter((l) => l.grupo === g);
            if (!doGrupo.length) return null;
            return (
              <tbody key={g}>
                <tr className="grupo">
                  <th scope="rowgroup">{g === "renda" ? "Saídas em categoria de renda" : GRUPOS[g]}</th>
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

/** Renda esperada × o que entrou. Sem nada digitado, vale a mediana (que aparece apagada no campo). */
function Renda({ d, mes, onSalvar }: { d: DadosOrcamento; mes: string; onSalvar: (categoria_id: number, centavos: number) => void }) {
  const entrou = d.renda.reduce((s, l) => s + l.recebido, 0) + d.entradas_sem_categoria;
  const diferenca = (esperado: number, recebido: number) =>
    recebido >= esperado ? <span className="pos">+{dinheiro(recebido - esperado)}</span> : <span className="mudo">faltam {dinheiro(esperado - recebido)}</span>;
  return (
    <tbody>
      <tr className="grupo">
        <th scope="rowgroup">Renda: esperada × o que entrou</th>
        <td className="num">{dinheiro(d.renda_esperada)}</td>
        <td className="num">{dinheiro(entrou)}</td>
        <td className="num">{d.renda_esperada !== null && diferenca(d.renda_esperada, entrou)}</td>
        <td />
      </tr>
      {d.renda.map((l) => {
        const esperado = l.planejado || (d.renda_origem === "mediana" ? l.sugerido : 0) || 0;
        return (
          <tr key={l.categoria_id}>
            <td><span className="ponto" style={{ background: l.cor ?? "var(--mudo)" }} />{l.categoria}</td>
            <td>
              <CampoDinheiro valor={l.planejado} sugestao={d.renda_origem === "mediana" ? l.sugerido : null} rotulo={`Renda esperada de ${l.categoria}`} onSalvar={(v) => onSalvar(l.categoria_id, v)} />
            </td>
            <td className="num">
              {l.recebido ? <Link to={`/lancamentos?mes=${mes}&categoria=${l.categoria_id}`}>{dinheiro(l.recebido)}</Link> : <span className="mudo">{dinheiro(0)}</span>}
            </td>
            <td className="num">{esperado > 0 ? diferenca(esperado, l.recebido) : <span className="mudo">—</span>}</td>
            <td />
          </tr>
        );
      })}
      {d.entradas_sem_categoria > 0 && (
        <tr className="pendente">
          <td>Entradas sem categoria</td>
          <td className="num mudo">—</td>
          <td className="num"><Link to={`/lancamentos?mes=${mes}&pendentes=1`}>{dinheiro(d.entradas_sem_categoria)}</Link></td>
          <td />
          <td className="mudo pequeno"><Link to={`/lancamentos?mes=${mes}&pendentes=1`}>categorizar →</Link></td>
        </tr>
      )}
    </tbody>
  );
}

function Linha({ l, mes, onSalvar }: { l: LinhaOrcamento; mes: string; onSalvar: (centavos: number) => void }) {
  const p = l.planejado ?? 0;
  const pct = p ? (l.realizado / p) * 100 : 0;
  const nivel = pct > 100 ? "estourou" : pct > 90 ? "perto" : "";
  return (
    <tr>
      <td><span className="ponto" style={{ background: l.cor ?? "var(--mudo)" }} />{l.categoria}</td>
      {/* em categoria de renda o planejado é a renda esperada, que fica no grupo de cima */}
      <td>{l.grupo === "renda" ? <span className="mudo num">—</span> : <CampoDinheiro valor={l.planejado} rotulo={`Planejado para ${l.categoria}`} onSalvar={onSalvar} />}</td>
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
