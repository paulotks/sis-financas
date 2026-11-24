import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, LineChart, Rectangle, ReferenceLine, Tooltip, XAxis, YAxis, type BarShapeProps } from "recharts";
import { api, dinheiro, dinheiroCurto, mesAtual, mesCurto, nomeDoMes, nomeMes, type Analises as Dados } from "../lib/api";
import { COR, Dica, eixo, eixoDinheiro, Grafico } from "../components/Grafico";
import SeletorMes from "../components/SeletorMes";

const ALTURA = { width: "100%", height: 260 };
const MAIORES = 10;
const margem = { top: 18, right: 8, bottom: 0, left: 0 };
const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);
const cor = (v: number) => (v < 0 ? "neg" : "pos");

export default function Analises() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesAtual();
  const q = useQuery({ queryKey: ["analises", mes], queryFn: () => api.analises(mes), placeholderData: keepPreviousData });
  const d = q.data;

  return (
    <section className={q.isPlaceholderData ? "recarregando" : ""}>
      <header className="topo">
        <h1>Análises</h1>
        {d && <Inicio d={d} />}
      </header>
      {q.error && <div className="aviso erro">{q.error.message}</div>}
      {d && d.inicio === null && (
        <p className="mudo">
          Os gráficos aparecem quando houver renda categorizada. Categorize as entradas em <Link to="/lancamentos?pendentes=1">Lançamentos</Link>.
        </p>
      )}
      {d && d.inicio !== null && (
        <>
          <RendaOrcadoGasto d={d} />
          <Guardado d={d} />
          <header className="topo secao">
            <h2>Dentro do mês</h2>
            <SeletorMes mes={mes} onChange={(m) => setParams({ mes: m }, { replace: true })} />
          </header>
          {d.dia_a_dia.dias.length === 0 ? (
            <p className="mudo">{nomeMes(d.mes)} {d.mes > d.mes_atual ? "ainda não começou." : "fica antes do mês inicial da análise."}</p>
          ) : (
            <>
              <DiaADia d={d} />
              <QuemEstourou d={d} />
            </>
          )}
          <header className="topo secao"><h2>Daqui para frente</h2></header>
          <Comprometido d={d} />
          <p className="mudo pequeno">
            Só pessoa física, com os mesmos totais do Resumo: sem transferências entre contas, pagamento de fatura e investimentos.
          </p>
        </>
      )}
    </section>
  );
}

/** Primeiro mês que entra nos gráficos e no alarme. */
function Inicio({ d }: { d: Dados }) {
  const qc = useQueryClient();
  const meses = useQuery({ queryKey: ["meses"], queryFn: api.meses });
  const salvar = useMutation({ mutationFn: api.definirInicio, onSuccess: () => qc.invalidateQueries() });
  return (
    <label className="inicio mudo">
      {salvar.error ? <span className="neg">{salvar.error.message}</span> : "Analisar desde"}
      <select
        className="campo"
        name="inicio"
        disabled={salvar.isPending}
        value={d.inicio_definido ? d.inicio! : ""}
        onChange={(e) => salvar.mutate(e.target.value || null)}
      >
        <option value="">Automático{d.inicio_automatico ? ` (${mesCurto(d.inicio_automatico)})` : ""}</option>
        {meses.data?.filter((m) => m <= d.mes_atual).map((m) => <option key={m} value={m}>{mesCurto(m)}</option>)}
      </select>
    </label>
  );
}

/** A: renda × orçado × gasto. Onde não havia orçamento, a linha tracejada mostra o de hoje. */
function RendaOrcadoGasto({ d }: { d: Dados }) {
  const fechados = d.meses.filter((m) => !m.aberto);
  const estourados = fechados.filter((m) => m.gasto > m.entradas);
  const temReferencia = d.orcado_hoje !== null && d.meses.some((m) => m.orcado === null);
  const dados = d.meses.map((m, i) => ({
    ...m,
    // a referência encosta no primeiro mês com orçamento, para a linha não quebrar
    referencia: m.orcado === null ? d.orcado_hoje : d.meses[i - 1]?.orcado === null ? m.orcado : null,
    estouro: !m.aberto && m.gasto > m.entradas ? dinheiroCurto(m.entradas - m.gasto) : "",
  }));
  // o mês em andamento fica apagado: ainda não dá para comparar
  const barra = (p: BarShapeProps) => <Rectangle {...p} fillOpacity={(p.payload as { aberto?: boolean })?.aberto ? 0.45 : 1} />;
  return (
    <Grafico
      titulo="Renda × orçado × gasto"
      frase={
        <>
          {fechados.length > 0 && (estourados.length
            ? <>Em <b className="neg">{estourados.length} de {fechados.length}</b> meses fechados você gastou mais do que ganhou.</>
            : <>Nenhum dos {fechados.length} meses fechados estourou a renda.</>)}
          {d.meses.some((m) => m.aberto) && <> {nomeDoMes(d.mes_atual)} (apagado) está em andamento.</>}
        </>
      }
      chaves={[
        { nome: "Renda", cor: COR.renda }, { nome: "Gasto", cor: COR.gasto }, { nome: "Orçado", cor: COR.tinta, forma: "linha" },
        ...(temReferencia ? [{ nome: "Orçado de hoje (referência: o mês não tinha orçamento)", cor: COR.tinta, forma: "tracejada" as const }] : []),
      ]}
      tabela={{
        colunas: ["Mês", "Renda", "Orçado", "Gasto", "Sobra"],
        linhas: d.meses.map((m) => [
          mesCurto(m.mes) + (m.aberto ? " (em andamento)" : ""), dinheiro(m.entradas), dinheiro(m.orcado), dinheiro(m.gasto), <span className={cor(m.sobra)}>{dinheiro(m.sobra)}</span>,
        ]),
      }}
    >
      <ComposedChart data={dados} responsive style={ALTURA} margin={margem} barGap={2}>
        <CartesianGrid vertical={false} stroke={COR.grade} />
        <XAxis dataKey="mes" tickFormatter={mesCurto} {...eixo} />
        <YAxis {...eixoDinheiro} />
        <Tooltip
          cursor={{ fill: "#ffffff0a" }}
          content={(p) => <Dica p={p} titulo={nomeMes} extra={(m) => <span><b className={cor(m.sobra)}>{dinheiro(m.sobra)}</b> {m.aberto ? "até agora" : "sobra"}</span>} />}
        />
        <Bar dataKey="entradas" name="renda" fill={COR.renda} maxBarSize={24} radius={[4, 4, 0, 0]} shape={barra} />
        <Bar dataKey="gasto" name="gasto" fill={COR.gasto} maxBarSize={24} radius={[4, 4, 0, 0]} shape={barra}>
          <LabelList dataKey="estouro" position="top" fill="var(--neg)" fontSize={12} />
        </Bar>
        <Line dataKey="orcado" name="orçado" stroke={COR.tinta} strokeWidth={2} dot={{ r: 4, fill: COR.tinta, stroke: "var(--painel)", strokeWidth: 2 }} />
        {temReferencia && <Line dataKey="referencia" name="orçado de hoje" stroke={COR.tinta} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={false} />}
      </ComposedChart>
    </Grafico>
  );
}

/** C: o que sobrou em cada mês fechado e a soma, em gráficos separados. */
function Guardado({ d }: { d: Dados }) {
  const fechados = d.meses.filter((m) => !m.aberto);
  if (!fechados.length) return null;
  const total = fechados.at(-1)!.acumulado!;
  const ganho = soma(fechados.map((m) => m.entradas));
  const tabela = { colunas: ["Mês", "Guardado", "Acumulado"], linhas: fechados.map((m) => [mesCurto(m.mes), dinheiro(m.sobra), dinheiro(m.acumulado)]) };
  return (
    <div className="dois-graficos">
      <Grafico
        titulo="Guardado por mês"
        frase={<>Renda menos gasto. No período, {total < 0 ? "faltou" : "sobrou"} <b className={cor(total)}>{dinheiro(Math.abs(total))}</b>{ganho > 0 && `: ${Math.round((Math.abs(total) / ganho) * 100)}% do que entrou`}.</>}
        tabela={tabela}
      >
        <BarChart data={fechados} responsive style={ALTURA} margin={margem}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="mes" tickFormatter={mesCurto} {...eixo} />
          <YAxis {...eixoDinheiro} />
          <Tooltip cursor={{ fill: "#ffffff0a" }} content={(p) => <Dica p={p} titulo={nomeMes} />} />
          <ReferenceLine y={0} stroke={COR.apoio} />
          <Bar
            dataKey="sobra" name="guardado" maxBarSize={24} radius={[4, 4, 0, 0]} fill={COR.apoio}
            shape={(p: BarShapeProps) => <Rectangle {...p} fill={Number((p.payload as { sobra?: number })?.sobra) < 0 ? "var(--neg)" : "var(--pos)"} />}
          />
        </BarChart>
      </Grafico>
      <Grafico titulo="Guardado acumulado" frase={<>O que você teria juntado desde {mesCurto(fechados[0].mes)}, mês a mês.</>}>
        <LineChart data={fechados} responsive style={ALTURA} margin={margem}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="mes" tickFormatter={mesCurto} padding={{ left: 20, right: 20 }} {...eixo} />
          <YAxis {...eixoDinheiro} />
          <Tooltip cursor={{ stroke: COR.apoio }} content={(p) => <Dica p={p} titulo={nomeMes} />} />
          <ReferenceLine y={0} stroke={COR.apoio} />
          <Line dataKey="acumulado" name="acumulado" stroke={COR.tinta} strokeWidth={2} dot={{ r: 4, fill: COR.tinta, stroke: "var(--painel)", strokeWidth: 2 }} />
        </LineChart>
      </Grafico>
    </div>
  );
}

/** B: gasto acumulado dia a dia. A frase diz em que dia a curva furou cada limite. */
function DiaADia({ d }: { d: Dados }) {
  const { dias, anterior, mes_anterior, ja_lancado, orcado, esperada } = d.dia_a_dia;
  const furou = (limite: number | null) => (limite === null ? 0 : dias.findIndex((v) => v > limite) + 1);
  const noOrcado = furou(orcado), naRenda = furou(esperada);
  const dados = Array.from({ length: Math.max(dias.length, anterior?.length ?? 0) }, (_, i) => ({ dia: i + 1, atual: dias[i] ?? null, anterior: anterior?.[i] ?? null }));
  const ultimo = dias.length, antes = anterior?.[Math.min(ultimo, anterior.length) - 1]; // meses de tamanhos diferentes
  const gasto = dias[ultimo - 1], aberto = d.mes === d.mes_atual;
  const [a, m] = d.mes.split("-").map(Number);
  const faltamDias = new Date(a, m, 0).getDate() - ultimo + 1; // contando hoje
  const limites = [["o orçado", orcado], ["a renda esperada", esperada]] as const;
  // com as parcelas já lançadas até o fim do mês, para bater com o Resumo e o Orçamento
  const resta = limites.filter(([, v]) => v !== null && v >= ja_lancado).map(([nome, v]) => `${dinheiro(v! - ja_lancado)} até ${nome}`);
  const soComParcelas = aberto ? limites.filter(([, v]) => v !== null && v >= gasto && v < ja_lancado).map(([nome]) => nome) : [];
  const rotulo = (value: string) => ({ value, position: "insideBottomLeft" as const, fill: COR.tinta, fontSize: 12 });
  return (
    <Grafico
      titulo="Gasto acumulado, dia a dia"
      frase={
        <>
          {noOrcado > 0 && <>Passou do orçado no <b className="alerta">dia {noOrcado}</b>. </>}
          {naRenda > 0 && <>Passou da renda esperada no <b className="neg">dia {naRenda}</b>. </>}
          {soComParcelas.length > 0 && <>Com as parcelas já lançadas, passa de <b className="neg">{soComParcelas.join(" e de ")}</b>. </>}
          {aberto && resta.length > 0 && <>Restam <b>{resta.join(" e ")}</b>, já contando as parcelas lançadas, com {faltamDias === 1 ? "1 dia" : `${faltamDias} dias`} pela frente. </>}
          {!aberto && !noOrcado && !naRenda && resta.length > 0 && <>Não passou de nenhum limite. </>}
          {antes !== undefined && (
            <>{aberto ? `Até o dia ${ultimo}` : "No mês todo"}, {gasto > antes ? <b className="neg">{dinheiro(gasto - antes)} a mais</b> : <b>{dinheiro(antes - gasto)} a menos</b>} que {nomeDoMes(mes_anterior).toLowerCase()}.</>
          )}
        </>
      }
      chaves={[
        { nome: nomeMes(d.mes), cor: COR.gasto, forma: "linha" },
        ...(anterior ? [{ nome: nomeMes(mes_anterior), cor: COR.apoio, forma: "linha" as const }] : []),
        ...(orcado !== null ? [{ nome: "Orçado", cor: COR.tinta, forma: "tracejada" as const }] : []),
        ...(esperada !== null ? [{ nome: "Renda esperada", cor: COR.renda, forma: "linha" as const }] : []),
      ]}
      tabela={{
        colunas: ["Dia", nomeDoMes(d.mes), ...(anterior ? [nomeDoMes(mes_anterior)] : [])],
        linhas: dados.map((x) => [x.dia, dinheiro(x.atual), ...(anterior ? [dinheiro(x.anterior)] : [])]),
      }}
    >
      <LineChart data={dados} responsive style={{ ...ALTURA, height: 300 }} margin={margem}>
        <CartesianGrid vertical={false} stroke={COR.grade} />
        <XAxis dataKey="dia" ticks={[1, 5, 10, 15, 20, 25, 30]} {...eixo} />
        <YAxis {...eixoDinheiro} />
        <Tooltip cursor={{ stroke: COR.apoio }} content={(p) => <Dica p={p} titulo={(x) => `Dia ${x}`} />} />
        {orcado !== null && <ReferenceLine y={orcado} ifOverflow="extendDomain" stroke={COR.tinta} strokeDasharray="4 4" label={esperada !== null && Math.abs(esperada - orcado) < esperada * 0.08 ? undefined : rotulo("Orçado")} />}
        {esperada !== null && <ReferenceLine y={esperada} ifOverflow="extendDomain" stroke={COR.renda} strokeWidth={2} label={rotulo("Renda esperada")} />}
        {anterior && <Line dataKey="anterior" name={nomeDoMes(mes_anterior).toLowerCase()} stroke={COR.apoio} strokeWidth={2} dot={false} />}
        <Line dataKey="atual" name={nomeDoMes(d.mes).toLowerCase()} stroke={COR.gasto} strokeWidth={2} dot={false} />
      </LineChart>
    </Grafico>
  );
}

const CONTRA = { normal: "Normal (3 meses)", mes_passado: "Mês passado", orcado: "Orçado" } as const;

/** E: cada categoria contra o que se esperava dela, do maior estouro em reais ao menor. A linha abre os lançamentos. */
function QuemEstourou({ d }: { d: Dados }) {
  const [contra, setContra] = useState<keyof typeof CONTRA>("normal");
  const [todas, setTodas] = useState(false);
  const temBase = d.categorias.some((c) => c[contra] !== null);
  const lista = d.categorias
    // dentro do próprio orçado aparece na lista, mas não é culpado (mesma regra do alarme)
    .map((c) => ({ ...c, base: c[contra], diferenca: c.gasto - (c[contra] ?? 0), noOrcado: c.orcado !== null && c.gasto <= c.orcado }))
    .filter((c) => c.diferenca !== 0)
    .sort((a, b) => b.diferenca - a.diferenca);
  const culpados = lista.filter((c) => c.diferenca > 0 && !c.noOrcado).slice(0, 3);
  const maior = Math.max(1, ...lista.map((c) => Math.abs(c.diferenca)));
  const limite = contra === "orcado" ? "do orçado" : contra === "normal" ? "do seu normal" : `de ${nomeDoMes(d.dia_a_dia.mes_anterior).toLowerCase()}`;
  return (
    <Grafico
      titulo="Quem estourou"
      frase={temBase && culpados.length > 0 && (
        <>
          <b>{culpados.map((c) => c.categoria).join(culpados.length === 2 ? " e " : ", ").replace(/, ([^,]*)$/, " e $1")}</b> {culpados.length > 1 ? "passaram" : "passou"}{" "}
          <b className="neg">{dinheiro(soma(culpados.map((c) => c.diferenca)))}</b> {limite}.
          {d.mes === d.mes_atual && " O mês ainda não acabou: quem está abaixo pode subir."}
        </>
      )}
    >
      <div className="segmentado" role="group" aria-label="Comparar com">
        {(Object.keys(CONTRA) as (keyof typeof CONTRA)[]).map((k) => (
          <button key={k} className={contra === k ? "ativo" : ""} aria-pressed={contra === k} onClick={() => setContra(k)}>{CONTRA[k]}</button>
        ))}
      </div>
      {!temBase ? (
        <p className="mudo">{contra === "orcado" ? <>Este mês não tem orçamento. <Link to={`/orcamento?mes=${d.mes}`}>Definir →</Link></> : "Não há mês anterior na análise para comparar."}</p>
      ) : (
        <>
          <ul className="estouros">
            {(todas ? lista : lista.slice(0, MAIORES)).map((c) => (
              <li key={c.categoria_id}>
                <Link to={`/lancamentos?mes=${d.mes}&categoria=${c.categoria_id}`}>
                  <span className="rotulo"><span className="ponto" style={{ background: c.cor ?? "var(--mudo)" }} />{c.categoria}</span>
                  <span className="trilho-duplo" aria-hidden="true">
                    <span className={`${c.diferenca > 0 ? "acima" : "abaixo"} ${c.noOrcado ? "no-orcado" : ""}`} style={{ width: `${(Math.abs(c.diferenca) / maior) * 50}%` }} />
                  </span>
                  <span className={`num ${c.diferenca > 0 && !c.noOrcado ? "neg" : "mudo"}`}>{c.diferenca > 0 ? "+" : "−"}{dinheiro(Math.abs(c.diferenca))}</span>
                  <span className="num mudo pequeno">{dinheiro(c.gasto)}{c.base === null ? ", sem orçado" : ` de ${dinheiro(c.base)}`}{c.diferenca > 0 && c.noOrcado && <small>dentro do orçado</small>}</span>
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
      )}
    </Grafico>
  );
}

/** G: o que os próximos meses já devem. Parcela é certa; recorrente é provável. */
function Comprometido({ d }: { d: Dados }) {
  const prox = d.comprometido[0];
  const total = prox.parcelas + prox.recorrentes;
  const provaveis = prox.recorrentes > 0;
  const parcelas = soma(d.comprometido.map((m) => m.parcelas));
  const temRenda = d.comprometido.some((m) => m.esperada !== null);
  const CLARO = "color-mix(in srgb, #d95926 45%, #131316)";
  return (
    <Grafico
      titulo="Já comprometido nos próximos 12 meses"
      frase={
        <>
          {nomeDoMes(prox.mes)} já tem <b>{dinheiro(prox.parcelas)}</b> certos em parcelas{provaveis && <> e uns <b>{dinheiroCurto(prox.recorrentes)}</b> prováveis em recorrentes</>}
          {prox.esperada ? <>: <b className={total > prox.esperada / 2 ? "neg" : ""}>{Math.round((total / prox.esperada) * 100)}%</b> da renda esperada</> : ""}.
          {" "}Em parcelas, faltam {dinheiro(parcelas)} até {mesCurto(d.comprometido.at(-1)!.mes)}.{" "}
          <Link to="/recorrentes">Revisar recorrentes →</Link>
        </>
      }
      chaves={[
        { nome: "Parcelas (certas)", cor: COR.gasto }, { nome: "Recorrentes (prováveis)", cor: CLARO },
        ...(temRenda ? [{ nome: "Renda esperada", cor: COR.renda, forma: "linha" as const }] : []),
      ]}
      tabela={{
        colunas: ["Mês", "Parcelas", "Recorrentes", "Total", "Renda esperada"],
        linhas: d.comprometido.map((m) => [mesCurto(m.mes), dinheiro(m.parcelas), dinheiro(m.recorrentes), dinheiro(m.parcelas + m.recorrentes), dinheiro(m.esperada)]),
      }}
    >
      <ComposedChart data={d.comprometido} responsive style={ALTURA} margin={margem}>
        <CartesianGrid vertical={false} stroke={COR.grade} />
        <XAxis dataKey="mes" tickFormatter={mesCurto} interval="preserveStartEnd" minTickGap={8} {...eixo} />
        <YAxis {...eixoDinheiro} />
        <Tooltip cursor={{ fill: "#ffffff0a" }} content={(p) => <Dica p={p} titulo={nomeMes} extra={(m) => <span><b>{dinheiro(m.parcelas + m.recorrentes)}</b> no total</span>} />} />
        <Bar dataKey="parcelas" name="parcelas" stackId="c" fill={COR.gasto} maxBarSize={24} stroke="var(--painel)" strokeWidth={1} />
        <Bar dataKey="recorrentes" name="recorrentes" stackId="c" fill={CLARO} maxBarSize={24} radius={[4, 4, 0, 0]} stroke="var(--painel)" strokeWidth={1} />
        {temRenda && <Line dataKey="esperada" name="renda esperada" stroke={COR.renda} strokeWidth={2} dot={false} />}
      </ComposedChart>
    </Grafico>
  );
}
