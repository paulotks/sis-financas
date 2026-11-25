import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, hoje, mesAtual, nomeMes, type Lancamento } from "../lib/api";
import Alarme from "../components/Alarme";
import LinhaPatrimonio from "../components/LinhaPatrimonio";
import OferecerRegra from "../components/OferecerRegra";
import SelectCategoria from "../components/SelectCategoria";
import SeletorMes from "../components/SeletorMes";

const MAIORES = 8;
const RECENTES = 8;

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
  const pat = useQuery({ queryKey: ["patrimonio", pessoa], queryFn: () => api.patrimonio(pessoa) });
  const d = r.data;
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

      {pessoa === "PF" ? <Alarme mes={mes} /> : <div className="cards">
        <div className="card"><small>Entradas</small><strong>{dinheiro(d?.entradas)}</strong></div>
        <div className="card"><small>Gastos de {nomeMes(mes).toLowerCase()}</small><strong>{dinheiro(d?.saidas)}</strong></div>
        <div className="card">
          <small>{mes === mesAtual() ? "Resultado até agora" : "Resultado do mês"}</small>
          <strong className={d ? (d.entradas - d.saidas < 0 ? "neg" : "pos") : ""}>{dinheiro(d ? d.entradas - d.saidas : null)}</strong>
        </div>
      </div>}

      {!!d?.pendentes && (
        <Link className="faixa" to={filtro("&pendentes=1")}>
          <span><span className="alerta">●</span> {d.pendentes} lançamento(s) sem categoria</span>
          <span className="mudo">categorizar →</span>
        </Link>
      )}

      <div className="duas-colunas">
        <div className="painel">
          <h2>Para onde foi o dinheiro</h2>
          {d && <Categorias key={mes + pessoa} lista={d.porCategoria} total={d.saidas} link={filtro} />}
        </div>
        <div className="painel">
          <div className="painel-topo">
            <h2>Patrimônio hoje</h2>
            <Link className="mudo" to={`/contas${pessoa === "PJ" ? "?pessoa=PJ" : ""}`}>Ver contas →</Link>
          </div>
          {pat.error && <div className="aviso erro">{pat.error.message}</div>}
          <strong className={`grande ${pat.data && pat.data.total < 0 ? "neg" : ""}`}>{dinheiro(pat.data?.total)}</strong>
          <small className="mudo">Posição nos bancos conectados, mais o que você lançou à mão.</small>
          {pat.data && <LinhaPatrimonio key={pessoa} pontos={pat.data.historico} />}
          <dl className="saldos">
            <dt>Contas</dt><dd>{dinheiro(pat.data?.contas)}</dd>
            <dt>Investimentos e bens</dt><dd>{dinheiro(pat.data ? pat.data.investimentos + pat.data.bens : null)}</dd>
            <dt>Cartões e dívidas</dt><dd>{dinheiro(pat.data ? -pat.data.dividas : null)}</dd>
          </dl>
        </div>
      </div>

      <Recentes key={mes + pessoa} mes={mes} pessoa={pessoa} verTodos={filtro("")} />

      <p className="mudo pequeno">
        Transferências entre contas, pagamentos de fatura e investimentos ficam fora do resumo: não são gasto nem renda. Estorno no
        cartão e reembolso em conta abatem a categoria em que estão.
      </p>
    </section>
  );
}

function Categorias({ lista, total, link }: {
  lista: { categoria_id: number | null; categoria: string; cor: string | null; total: number; qtd: number }[];
  total: number;
  link: (extra: string) => string;
}) {
  const [todas, setTodas] = useState(false);
  const maior = Math.max(1, ...lista.map((c) => c.total));
  if (!lista.length) return <p className="mudo">Nenhum gasto neste mês.</p>;
  return (
    <>
      <ul className="barras">
        {(todas ? lista : lista.slice(0, MAIORES)).map((c) => (
          <li key={c.categoria_id ?? "sem"}>
            <Link to={link(c.categoria_id ? `&categoria=${c.categoria_id}` : "&pendentes=1")} title={`${c.qtd} lançamento(s)`}>
              <span className="rotulo"><span className="ponto" style={{ background: c.cor ?? "var(--alerta)" }} />{c.categoria}</span>
              <span className="valor">{dinheiro(c.total)} <em>{total > 0 ? Math.round((c.total / total) * 100) : 0}%</em></span>
              <span className="barra"><span style={{ width: `${Math.max(0, (c.total / maior) * 100)}%` }} /></span>
            </Link>
          </li>
        ))}
      </ul>
      {lista.length > MAIORES && (
        <button className="botao secundario ver-todas" aria-expanded={todas} onClick={() => setTodas(!todas)}>
          {todas ? "Ver só as maiores" : `Ver todas (${lista.length})`}
        </button>
      )}
    </>
  );
}

function Recentes({ mes, pessoa, verTodos }: { mes: string; pessoa: string; verTodos: string }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ["lancamentos", { mes, pessoa }], queryFn: () => api.lancamentos({ mes, pessoa }) });
  const categorias = useQuery({ queryKey: ["categorias"], queryFn: api.categorias });
  const [oferta, setOferta] = useState<Lancamento | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const editar = useMutation({
    mutationFn: ({ id, categoria_id }: { id: string; categoria_id: number | null }) => api.editarLancamento(id, { categoria_id }),
    onSuccess: (l) => {
      setAviso(null);
      setOferta(l.categoria_id && l.descricao_original ? l : null);
      qc.invalidateQueries();
    },
  });
  // parcelas futuras do mês ocupariam o topo da lista
  const limite = hoje();
  const itens = (lista.data?.itens ?? []).filter((l) => l.data <= limite && !l.ignorado && l.status !== "REMOVIDO").slice(0, RECENTES);
  const erro = lista.error ?? editar.error;

  return (
    <div className="painel recentes">
      <div className="painel-topo">
        <h2>Lançamentos recentes</h2>
        <Link className="mudo" to={verTodos}>Ver todos →</Link>
      </div>
      {erro && <div className="aviso erro">{erro.message}</div>}
      {aviso && <div className="aviso">{aviso}</div>}
      {lista.data && itens.length === 0 && <p className="mudo">Nenhum lançamento até hoje neste mês.</p>}
      <ul>
        {itens.map((l) => (
          <li key={l.id}>
            <div className="recente">
              <span className="mudo">{dataCurta(l.data)}</span>
              <span className="nome">
                {l.descricao}
                <small className="mudo">{l.conta}</small>
              </span>
              <SelectCategoria
                categorias={categorias.data ?? []}
                valor={l.categoria_id}
                vazio="Sem categoria"
                cor={l.categoria_cor}
                onChange={(categoria_id) => editar.mutate({ id: l.id, categoria_id })}
              />
              <span className={`num ${l.valor_centavos > 0 ? "pos" : ""}`}>{dinheiro(l.valor_centavos)}</span>
            </div>
            {oferta?.id === l.id && (
              <OferecerRegra
                key={oferta.categoria_id}
                l={oferta}
                onFechar={(texto) => {
                  setOferta(null);
                  setAviso(texto ?? null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
