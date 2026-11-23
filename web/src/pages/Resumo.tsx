import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, dinheiro, mesAtual } from "../lib/api";
import SeletorMes from "../components/SeletorMes";

export default function Resumo() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesAtual();
  const pessoa = params.get("pessoa") ?? "PF";
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };
  const r = useQuery({ queryKey: ["resumo", mes, pessoa], queryFn: () => api.resumo(mes, pessoa) });
  const d = r.data;
  const maior = Math.max(1, ...(d?.porCategoria.map((c) => c.total) ?? [1]));
  const filtro = (extra: string) => `/lancamentos?mes=${mes}${pessoa === "PJ" ? "&pessoa=PJ" : ""}${extra}`;

  return (
    <section>
      <header className="topo">
        <h1>Resumo</h1>
        <div className="segmentado">
          {["PF", "PJ"].map((p) => (
            <button key={p} className={pessoa === p ? "ativo" : ""} onClick={() => set("pessoa", p)}>{p}</button>
          ))}
        </div>
        <SeletorMes mes={mes} onChange={(m) => set("mes", m)} />
      </header>

      {r.error && <div className="aviso erro">{r.error.message}</div>}

      <div className="cards">
        <div className="card"><small>Entradas</small><strong className="pos">{dinheiro(d?.entradas)}</strong></div>
        <div className="card"><small>Saídas</small><strong className="neg">{dinheiro(d ? -d.saidas : null)}</strong></div>
        <div className="card">
          <small>Resultado do mês</small>
          <strong className={d && d.entradas - d.saidas < 0 ? "neg" : "pos"}>{dinheiro(d ? d.entradas - d.saidas : null)}</strong>
        </div>
        <Link className="card link" to={filtro("&pendentes=1")}>
          <small>Sem categoria</small>
          <strong className={d?.pendentes ? "alerta" : ""}>{d?.pendentes ?? "—"}</strong>
          {!!d?.pendentes && <em>categorizar →</em>}
        </Link>
      </div>

      <div className="duas-colunas">
        <div className="painel">
          <h2>Para onde foi o dinheiro</h2>
          {d?.porCategoria.length === 0 && <p className="mudo">Nenhum gasto neste mês.</p>}
          <ul className="barras">
            {d?.porCategoria.map((c) => (
              <li key={c.categoria_id ?? "sem"}>
                <Link to={filtro(c.categoria_id ? `&categoria=${c.categoria_id}` : "&pendentes=1")}>
                  <span className="rotulo">{c.categoria} <em>({c.qtd})</em></span>
                  <span className="valor">{dinheiro(c.total)}</span>
                  <span className="barra"><span style={{ width: `${(c.total / maior) * 100}%`, background: c.cor ?? "#666" }} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="painel">
          <h2>Agora</h2>
          <dl className="saldos">
            <dt>Saldo nas contas</dt>
            <dd>{dinheiro(d?.saldos.contas)}</dd>
            <dt>Usado nos cartões</dt>
            <dd className="neg">{dinheiro(d?.saldos.cartoes)}</dd>
          </dl>
          <p className="mudo pequeno">
            Transferências entre contas e pagamentos de fatura ficam fora do resumo, para não contar o mesmo gasto duas vezes.
          </p>
        </div>
      </div>
    </section>
  );
}
