import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, dinheiroCurto, limiteTexto, mesCurto, nivelTexto, nomeDoMes, type Ritmo } from "../lib/api";

/** Topo do Resumo (PF): a renda aguenta este mês? Mês aberto mostra a projeção; fechado, o que sobrou de verdade. */
export default function Alarme({ mes }: { mes: string }) {
  const q = useQuery({ queryKey: ["ritmo", mes], queryFn: () => api.ritmo(mes) });
  if (q.error) return <div className="aviso erro">{q.error.message}</div>;
  const r = q.data;
  if (!r) return <div className="alarme" aria-busy="true" />;
  const nivel = nivelTexto(r);
  return (
    <>
      {r.canceladas_cobradas.map((c) => (
        <div className="aviso erro" key={`${c.descricao}|${c.data}`}>
          <b>{c.descricao}</b> cobrou {dinheiro(c.valor)} em {dataCurta(c.data)}, depois de cancelada. <Link to="/recorrentes">Ver em Recorrentes →</Link>
        </div>
      ))}
      <div className="alarme">
        <div className={`card destaque ${r.nivel ?? ""}`}>
          {nivel && <span className={`nivel ${r.nivel}`}><span aria-hidden="true">{nivel.icone}</span> {nivel.texto}</span>}
          <Manchete r={r} />
          <Medidor r={r} />
          <Frases r={r} />
        </div>
        <div className="card"><PorDia r={r} /></div>
        <div className="card"><Acumulado r={r} /></div>
      </div>
    </>
  );
}

/** Dia sem dado do banco não entra na projeção: diz até onde ela vai. */
const ate = (r: Ritmo) => (r.dados_ate < r.hoje ? ` (os dados vão até ${dataCurta(r.dados_ate)})` : "");
const pct = (parte: number, todo: number) => `${Math.round((parte / todo) * 100)}%`;
const cor = (valor: number) => (valor < 0 ? "neg" : "pos");

function Manchete({ r }: { r: Ritmo }) {
  const nome = nomeDoMes(r.mes).toLowerCase();
  const esperada = r.renda.esperada;
  if (r.situacao === "futuro")
    return (
      <>
        <small>Já comprometido em {nome}</small>
        <strong>{dinheiro(r.gasto)}</strong>
        <p className="mudo">
          Só em parcelas já lançadas{esperada ? `: ${pct(r.gasto, esperada)} da renda esperada (${dinheiro(esperada)}), antes de o mês começar` : ""}.
          {r.parcelas_previstas > 0 && ` O cartão ainda não mandou outras, previstas em ${dinheiro(r.parcelas_previstas)}.`}
        </p>
      </>
    );
  if (r.situacao === "fechado")
    return (
      <>
        <small>{nomeDoMes(r.mes)} fechou em</small>
        <strong className={r.analisado ? cor(r.sobra) : ""}>{dinheiro(r.sobra)}</strong>
        <p className="mudo">
          Entraram {dinheiro(r.renda.recebida)} e saíram {dinheiro(r.gasto)}.{" "}
          {!r.analisado && "A renda deste mês está incompleta: ele fica fora da análise."}
          {r.analisado && esperada && r.gasto > r.renda.recebida && `O mês custou ${(r.gasto / esperada).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mês de renda.`}
          {temExtra(r) && ` Sem a renda extra de ${dinheiro(r.renda.extra)}, seriam ${dinheiro(r.sobra - r.renda.extra)}.`}
        </p>
      </>
    );
  if (r.teto === null)
    return (
      <>
        <small>Gasto de {nome} até agora</small>
        <strong>{dinheiro(r.gasto)}</strong>
        <p className="mudo">
          Ainda não sei a sua renda. <Link to={`/orcamento?mes=${r.mes}`}>Definir a renda esperada →</Link>
        </p>
      </>
    );
  const limite = limiteTexto(r);
  if (!r.projecao)
    return (
      <>
        <small>Gasto de {nome} até agora</small>
        <strong>{dinheiro(r.gasto)}</strong>
        <p className="mudo">De {dinheiro(r.teto)} ({limite}). A projeção do mês aparece com 5 dias de dados do banco{ate(r)}.</p>
      </>
    );
  const diferenca = r.teto - r.projecao.media;
  const { min, max } = r.projecao;
  return (
    <>
      <small>No ritmo atual, {nome} contra {limite}</small>
      <strong className={cor(diferenca)}>{dinheiroCurto(diferenca)}</strong>
      <p className="mudo">
        O gasto deve ficar {min === max ? `em ${dinheiroCurto(max)}` : `entre ${dinheiroCurto(min)} e ${dinheiroCurto(max)}`}; {limite} é {dinheiroCurto(r.teto)}{ate(r)}.
      </p>
    </>
  );
}

/** Gasto (cheio) e projeção (claro) contra as marcas do orçado e da renda. */
function Medidor({ r }: { r: Ritmo }) {
  const aberto = r.situacao === "aberto";
  const renda = r.situacao === "fechado" ? r.renda.recebida : r.renda.esperada;
  const marcas = [
    { nome: "Orçado", valor: r.orcado, classe: "orcado" },
    { nome: r.situacao === "fechado" ? "Renda que entrou" : "Renda esperada", valor: renda ?? 0, classe: "renda" },
  ].filter((m) => m.valor > 0);
  if (!marcas.length || (r.situacao === "fechado" && !r.analisado)) return null;
  const projetado = aberto ? (r.projecao?.media ?? 0) : 0;
  const total = Math.max(r.gasto, projetado, ...marcas.map((m) => m.valor)) * 1.04;
  const x = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  return (
    <div className={`medidor ${r.nivel ?? ""}`}>
      <div className="trilho" aria-hidden="true">
        {projetado > r.gasto && <span className="projecao" style={{ width: x(projetado) }} />}
        <span className="gasto" style={{ width: x(r.gasto) }} />
        {marcas.map((m) => <i key={m.classe} className={m.classe} style={{ left: x(m.valor) }} />)}
      </div>
      <ul>
        <li><span className="chave gasto" />{r.situacao === "fechado" ? "Gasto" : aberto ? "Gasto e já lançado" : "Já lançado"} <b>{dinheiro(r.gasto)}</b></li>
        {projetado > r.gasto && <li><span className="chave projecao" />Projeção <b>{dinheiroCurto(projetado)}</b></li>}
        {marcas.map((m) => <li key={m.classe}><span className={`chave ${m.classe}`} />{m.nome} <b>{dinheiro(m.valor)}</b></li>)}
        {aberto && <li>Entrou <b>{dinheiro(r.renda.recebida)}</b></li>}
      </ul>
    </div>
  );
}

/** Diferença pequena entre a renda esperada e a que entrou não é "extra" que valha uma frase. */
const temExtra = (r: Ritmo) => r.renda.esperada !== null && r.renda.extra > r.renda.esperada * 0.05;

function Frases({ r }: { r: Ritmo }) {
  const { esperada, extra, recebida } = r.renda;
  const aberto = r.situacao === "aberto";
  return (
    <ul className="frases">
      {r.nao_apareceu.length > 0 && (
        <li>
          <Link to="/contas">
            O gasto pode ser maior: até <b className="alerta">{dinheiro(r.nao_apareceu.reduce((s, c) => s + c.valor, 0))}</b> já contam no limite de{" "}
            {new Intl.ListFormat("pt-BR").format(r.nao_apareceu.map((c) => c.conta ?? "cartão"))} e ainda não apareceram aqui.
          </Link>
        </li>
      )}
      {aberto && temExtra(r) && (
        <li>Entraram {dinheiro(extra)} além da renda esperada. Sem esse extra, até agora sobrariam {dinheiro(recebida - extra - r.gasto)}.</li>
      )}
      {r.situacao !== "fechado" && esperada && r.orcado > 0 && (
        <li>
          <Link to={`/orcamento?mes=${r.mes}`}>
            {r.orcado > esperada
              ? <>Seu orçamento passa da renda esperada em <b className="neg">{dinheiro(r.orcado - esperada)}</b>.</>
              : <>Cumprindo todo o orçamento, sobram <b>{dinheiro(esperada - r.orcado)}</b>: ele já usa {pct(r.orcado, esperada)} da renda.</>}
          </Link>
        </li>
      )}
      {r.situacao !== "futuro" && r.orcado === 0 && aberto && <li><Link to={`/orcamento?mes=${r.mes}`}>Definir orçamento →</Link></li>}
      {r.acima.map((c) => (
        <li key={c.categoria_id}>
          <Link to={`/lancamentos?mes=${r.mes}&categoria=${c.categoria_id}`}>
            <span className="ponto" style={{ background: c.cor ?? "var(--mudo)" }} />
            {c.categoria}: <b>{dinheiro(c.acima)}</b> acima do seu normal ({dinheiro(c.normal)})
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PorDia({ r }: { r: Ritmo }) {
  if (r.situacao === "fechado") {
    const { recebida } = r.renda;
    return (
      <>
        <small>{r.sobra < 0 ? "Gastou do que entrou" : "Guardou da renda"}</small>
        <strong className={r.analisado ? cor(r.sobra) : ""}>{r.analisado && recebida > 0 ? pct(r.sobra < 0 ? r.gasto : r.sobra, recebida) : "—"}</strong>
      </>
    );
  }
  if (!r.por_dia) return <><small>Renda esperada</small><strong>{dinheiro(r.renda.esperada)}</strong></>;
  const { valor, no_ritmo, livre, dias, recorrentes } = r.por_dia;
  const detalhe = recorrentes > 0 ? `Já desconta as parcelas lançadas e ${dinheiro(recorrentes)} de recorrentes que ainda vêm.` : "Já desconta as parcelas lançadas.";
  return livre < 0 ? (
    <>
      <small>Já passou do que cabe no mês</small>
      <strong className="neg">{dinheiro(livre)}</strong>
      <p className="mudo pequeno">{detalhe}</p>
    </>
  ) : (
    <>
      <small>Pode gastar por dia</small>
      <strong>{dinheiro(valor)}</strong>
      {no_ritmo !== null && no_ritmo > valor && <p>No ritmo atual, serão uns <b className="neg">{dinheiroCurto(Math.round(no_ritmo / 100) * 100)}</b> por dia.</p>}
      <p className="mudo pequeno">{dias === 1 ? "Último dia do mês." : `Nos ${dias} dias que faltam, contando hoje.`} {detalhe}</p>
    </>
  );
}

function Acumulado({ r }: { r: Ritmo }) {
  const a = r.acumulado;
  if (!a) return <><small>Guardado nos últimos meses</small><strong>—</strong><p className="mudo pequeno">Aparece quando houver um mês fechado com a renda completa.</p></>;
  return (
    <>
      <small>{a.meses === 1 ? nomeDoMes(a.ate) : `Últimos ${a.meses} meses fechados`}</small>
      <strong className={cor(a.sobra)}>{dinheiro(a.sobra)}</strong>
      <p className="mudo pequeno">
        {a.meses > 1 && `De ${mesCurto(a.de)} a ${mesCurto(a.ate)}: `}
        {a.sobra < 0 ? "você gastou mais do que ganhou. " : "isto é tudo o que sobrou. "}
        Entraram {dinheiroCurto(a.entradas)}, saíram {dinheiroCurto(a.gasto)}.
      </p>
      {r.inicio_antes && r.situacao === "aberto" && <p className="pequeno alerta">O mês inicial automático mudou (era {mesCurto(r.inicio_antes)}). <Link to="/analises">Fixar em Análises →</Link></p>}
    </>
  );
}
