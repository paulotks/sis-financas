import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dinheiro, dinheiroCurto, lerDinheiro, mesAtual, mesCurto, nomeMes, type EdicaoMeta, type Meta, type Posicao, type Ritmo } from "../lib/api";
import CampoDinheiro from "../components/CampoDinheiro";
import SeletorMes from "../components/SeletorMes";

const TIPOS: Record<Meta["tipo"], string> = { guardar: "Guardar por mês", juntar: "Juntar um valor", quitar: "Quitar uma dívida" };
const idDe = (p: Pick<Posicao, "origem" | "ref_id">) => `${p.origem}:${p.ref_id}`;
const nomeDe = (p: { nome: string | null; conta: string | null }) => `${p.nome ?? "Sem nome"}${p.conta ? ` (${p.conta})` : ""}`;

export default function Metas() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesAtual();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["metas", mes], queryFn: () => api.metas(mes) });
  const ritmo = useQuery({ queryKey: ["ritmo", mes], queryFn: () => api.ritmo(mes) });
  // mudam o teto: alarme, orçamento e análises
  const aoSalvar = { onSettled: () => Promise.all([["metas"], ["ritmo"], ["orcamento"], ["analises"], ["compromissos"]].map((queryKey) => qc.invalidateQueries({ queryKey }))) };
  const criar = useMutation({ mutationFn: api.criarMeta, ...aoSalvar });
  const editar = useMutation({ mutationFn: ({ id, ...d }: EdicaoMeta & { id: number; encerrada?: boolean }) => api.editarMeta(id, d), ...aoSalvar });
  const apagar = useMutation({ mutationFn: api.apagarMeta, ...aoSalvar });
  const erro = q.error ?? ritmo.error ?? criar.error ?? editar.error ?? apagar.error;
  const d = q.data;
  const ativas = d?.metas.filter((m) => !m.encerrada_em) ?? [];
  const encerradas = d?.metas.filter((m) => m.encerrada_em) ?? [];
  /** O que pode medir: do tipo certo e que não mede outra meta em andamento. */
  const livres = (tipo: Meta["tipo"], menos?: number) =>
    d?.posicoes.filter((p) => p.serve === tipo && !ativas.some((m) => m.id !== menos && m.origem === p.origem && m.ref_id === p.ref_id)) ?? [];

  return (
    <section>
      <header className="topo">
        <h1>Metas</h1>
        <SeletorMes mes={mes} onChange={(m) => setParams({ mes: m }, { replace: true })} />
      </header>
      {erro && <div className="aviso erro flutuante" role="alert">{erro.message}</div>}

      {q.isLoading ? <p className="mudo">Carregando…</p> : <Topo total={d?.total ?? null} r={ritmo.data} />}
      <p className="mudo pequeno">
        Só pessoa física. O valor por mês vale de {nomeMes(mes).toLowerCase()} em diante, até você mudar, e sai do teto do alarme. Meses anteriores não
        mudam. O progresso é o de hoje.
      </p>

      {d && ativas.length === 0 && <p className="mudo">Nenhuma meta em andamento. Crie a primeira abaixo.</p>}
      {ativas.map((m) => (
        <Cartao
          key={m.id} m={m} mes={mes} opcoes={livres(m.tipo, m.id)}
          onSalvar={(e) => editar.mutate({ id: m.id, ...e })}
          onEncerrar={() => confirm(`Encerrar "${m.nome}"? Ela deixa de descontar do teto de ${nomeMes(mesAtual()).toLowerCase()} em diante; os meses anteriores não mudam.`) && editar.mutate({ id: m.id, encerrada: true })}
        />
      ))}

      <Nova livres={livres} salvando={criar.isPending} onCriar={(n, depois) => criar.mutate({ ...n, mes }, { onSuccess: depois })} />

      {encerradas.length > 0 && (
        <details className="ignoradas">
          <summary className="mudo">Encerradas ({encerradas.length})</summary>
          <ul className="bens metas-encerradas">
            {encerradas.map((m) => (
              <li key={m.id}>
                <span>{m.nome} <span className="mudo pequeno">{TIPOS[m.tipo].toLowerCase()}{m.alvo ? `, ${dinheiro(m.alvo)}` : ""} · encerrada em {mesCurto(m.encerrada_em!)}</span></span>
                <button className="botao secundario" disabled={editar.isPending} onClick={() => editar.mutate({ id: m.id, encerrada: false })}>Reabrir</button>
                <button
                  className="icone-botao"
                  title="Apagar de vez (muda o resultado dos meses em que ela valia)"
                  aria-label={`Apagar ${m.nome}`}
                  onClick={() => confirm(`Apagar "${m.nome}" de vez? Os meses em que ela valia deixam de contar com ela. Só faça isso se foi criada por engano.`) && apagar.mutate(m.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** O que as metas pedem, se o plano cobre e como o mês vai: os mesmos números do alarme. */
function Topo({ total, r }: { total: number | null; r?: Ritmo }) {
  const esperada = r?.renda.esperada ?? null, sobra = r && esperada !== null && r.orcado > 0 ? esperada - r.orcado : null;
  const veredito = (dito: [string, string]) => (r!.falta_metas > 0 ? <span className="pequeno alerta">Com as metas, {dito[0]} {dinheiro(r!.falta_metas)}.</span> : <span className="pequeno mudo">{dito[1]}</span>);
  return (
    <div className="cards">
      <div className="card">
        <small>As metas pedem no mês</small>
        <strong>{dinheiro(total)}</strong>
        {!!total && esperada !== null && <span className="mudo pequeno">{Math.round((total / esperada) * 100)}% da renda esperada ({dinheiro(esperada)})</span>}
        {!!total && r && esperada === null && <span className="alerta pequeno">Sem renda esperada, não dá para descontar. <Link to={`/orcamento?mes=${r.mes}`}>Definir →</Link></span>}
      </div>
      <div className="card">
        <small>Sobra planejada (renda − orçamento)</small>
        <strong className={sobra !== null && sobra < 0 ? "neg" : ""}>{dinheiro(sobra)}</strong>
        {r && sobra === null && <span className="mudo pequeno"><Link to={`/orcamento?mes=${r.mes}`}>Definir o orçamento →</Link></span>}
        {r && sobra !== null && !!total && (sobra < total
          ? <span className="alerta pequeno">▲ Mesmo cumprindo o plano, faltam {dinheiro(total - sobra)}. <Link to={`/orcamento?mes=${r.mes}`}>Rever o orçamento →</Link></span>
          : <span className="mudo pequeno">Cumprindo o plano, cobre as metas.</span>)}
      </div>
      <div className="card">
        {!r ? <><small>No mês</small><strong>—</strong></> : r.situacao === "futuro" ? (
          <><small>No mês</small><strong>—</strong><span className="mudo pequeno">Ainda não começou.</span></>
        ) : r.situacao === "fechado" ? (
          <>
            <small>Sobrou no mês</small>
            <strong className={r.analisado && r.sobra < 0 ? "neg" : ""}>{dinheiro(r.sobra)}</strong>
            {!r.analisado ? <span className="mudo pequeno">A renda deste mês está incompleta.</span> : !!total && veredito(["faltaram", "Deu para as metas."])}
          </>
        ) : esperada === null || !r.projecao ? (
          <><small>No ritmo atual, sobra</small><strong>—</strong><span className="mudo pequeno">{esperada === null ? "Falta a renda esperada." : "A projeção aparece com 5 dias de dados do banco."}</span></>
        ) : (
          <>
            <small>No ritmo atual, {r.projecao.media > esperada ? "falta" : "sobra"}</small>
            <strong className={r.projecao.media > esperada ? "neg" : ""}>{dinheiroCurto(Math.abs(esperada - r.projecao.media))}</strong>
            {!!total && veredito(["faltam", "Dá para as metas."])}
          </>
        )}
      </div>
    </div>
  );
}

function Cartao({ m, mes, opcoes, onSalvar, onEncerrar }: { m: Meta; mes: string; opcoes: Posicao[]; onSalvar: (e: EdicaoMeta) => void; onEncerrar: () => void }) {
  const ligada = m.origem && m.ref_id ? idDe({ origem: m.origem, ref_id: m.ref_id }) : "";
  const pct = m.feito === null || !m.alvo ? null : Math.max(0, Math.min(100, (m.feito / m.alvo) * 100));
  return (
    <article className="painel meta">
      <header>
        <input
          key={m.nome}
          className="editavel titulo"
          name="nome"
          aria-label={`Nome de ${m.nome}`}
          maxLength={60}
          defaultValue={m.nome}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== m.nome) onSalvar({ nome: v });
            else e.target.value = m.nome;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.value = m.nome;
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
        />
        <small className="mudo">{TIPOS[m.tipo]}</small>
        <button className="botao secundario" title="Deixa de descontar do teto e guarda os meses anteriores" aria-label={`Encerrar ${m.nome}`} onClick={onEncerrar}>Encerrar</button>
      </header>
      <div className="campos">
        <label>Por mês<CampoDinheiro valor={m.por_mes} rotulo={`Por mês de ${m.nome}`} onSalvar={(por_mes) => onSalvar({ por_mes, mes })} /></label>
        {m.tipo !== "guardar" && (
          <>
            <label>{m.tipo === "juntar" ? "Alvo" : "Dívida no começo"}<CampoDinheiro valor={m.alvo} obrigatorio rotulo={`${m.tipo === "juntar" ? "Alvo" : "Dívida no começo"} de ${m.nome}`} onSalvar={(alvo) => onSalvar({ alvo })} /></label>
            <label>
              Prazo
              <input
                key={m.prazo ?? ""}
                className="editavel"
                type="month"
                name="prazo"
                aria-label={`Prazo de ${m.nome}`}
                defaultValue={m.prazo ?? ""}
                onBlur={(e) => e.target.value !== (m.prazo ?? "") && !e.target.validity.badInput && onSalvar({ prazo: e.target.value || null })}
              />
            </label>
            <label className="medida">
              Medida por
              <Medida valor={ligada} opcoes={opcoes} atual={m} onEscolher={(medida) => onSalvar({ medida })} />
            </label>
          </>
        )}
      </div>
      {pct !== null && (
        <div className="progresso">
          <span className="barra"><span style={{ width: `${pct}%` }} /></span>
          <small className="mudo">{Math.floor(pct)}%</small>
        </div>
      )}
      <Frases m={m} onUsar={(por_mes) => onSalvar({ por_mes, mes })} />
    </article>
  );
}

/** De onde sai o progresso. A ligada continua na lista mesmo fora do patrimônio ou com a dívida já zerada. */
function Medida({ valor, opcoes, atual, onEscolher }: { valor: string; opcoes: Posicao[]; atual?: Meta; onEscolher: (p: Pick<Posicao, "origem" | "ref_id"> | null) => void }) {
  return (
    <select
      className="campo"
      name="medida"
      aria-label={atual ? `${atual.nome}: medida por` : "Medida por"}
      value={valor}
      onChange={(e) => {
        const p = opcoes.find((o) => idDe(o) === e.target.value);
        onEscolher(p ? { origem: p.origem, ref_id: p.ref_id } : null);
      }}
    >
      <option value="">Escolher…</option>
      {valor && !opcoes.some((o) => idDe(o) === valor) && <option value={valor}>{atual?.medida ? nomeDe(atual.medida) : "Fora do patrimônio"}</option>}
      {opcoes.map((o) => <option key={idDe(o)} value={idDe(o)}>{nomeDe(o)}: {dinheiro(o.valor)}</option>)}
    </select>
  );
}

function Frases({ m, onUsar }: { m: Meta; onUsar: (centavos: number) => void }) {
  const pede = m.por_mes ?? 0;
  if (m.tipo === "guardar") return <p className="mudo pequeno">Tem de sobrar no mês (entradas − gastos), somado ao que as outras metas pedem.</p>;
  if (m.falta === null || m.feito === null)
    return (
      <p className="mudo pequeno">
        {m.origem && m.falta === null ? "O que media esta meta saiu do patrimônio (conta oculta, resgatada ou de outra pessoa). Escolha outra em “Medida por”."
          : m.tipo === "juntar" ? "Escolha em “Medida por” a conta, o cofrinho ou o bem que guarda este dinheiro. O que o banco não manda, lance em Contas." : "Escolha em “Medida por” o cartão ou a dívida. Empréstimo e financiamento, lance em Contas com sinal de menos."}
      </p>
    );
  const chegou = m.falta === 0;
  return (
    <ul className="frases">
      <li>
        {chegou ? <><b className="pos">✓</b> {m.tipo === "juntar" ? <>Chegou ao alvo: <b>{dinheiro(m.feito)}</b> de {dinheiro(m.alvo)}.</> : <>Dívida de {dinheiro(m.alvo)} quitada.</>}</>
          : m.tipo === "juntar" ? <><b>{dinheiro(m.feito)}</b> de {dinheiro(m.alvo)}. Faltam {dinheiro(m.falta)}.</>
          : m.feito < 0 ? <>A dívida cresceu <b className="neg">{dinheiro(-m.feito)}</b> desde o começo: hoje são {dinheiro(m.falta)}.</>
          : <>Já caiu <b>{dinheiro(m.feito)}</b> de {dinheiro(m.alvo)}. Faltam {dinheiro(m.falta)}.</>}
        {m.tipo === "quitar" && m.origem === "conta" && !chegou && <span className="mudo"> Cartão entra pelo limite usado, com as parcelas futuras.</span>}
      </li>
      {chegou && pede > 0 && <li className="alerta">Ainda desconta {dinheiro(pede)} por mês do teto: encerre (✓) ou mude.</li>}
      {m.chega && <li>Com {dinheiro(pede)} por mês, chega em <b>{mesCurto(m.chega)}</b>.</li>}
      {m.prazo && m.precisa !== null && (
        <li>
          Para chegar em {mesCurto(m.prazo)}, precisa {m.tipo === "quitar" ? "cair" : "de"} <b className={m.tipo === "juntar" && m.precisa > pede ? "alerta" : ""}>{dinheiro(m.precisa)}</b> por mês.{" "}
          {/* na dívida não: a parcela já é gasto e descontaria duas vezes */}
          {m.tipo === "juntar" && m.precisa !== pede && <button className="botao secundario" onClick={() => onUsar(m.precisa!)}>Usar</button>}
        </li>
      )}
      {m.prazo && m.precisa === null && !chegou && <li className="alerta">O prazo ({mesCurto(m.prazo)}) já passou.</li>}
      {m.andou && !chegou && (
        <li>
          Nos últimos {m.andou.dias} dias, {m.andou.por_mes === 0 ? "não andou" : <>{m.andou.por_mes > 0 ? "andou" : "recuou"} <b className={m.andou.por_mes < 0 ? "neg" : ""}>{dinheiro(Math.abs(m.andou.por_mes))}</b> por mês</>}
          {m.andou.chega && <>: nesse passo, chega em {mesCurto(m.andou.chega)}</>}.
        </li>
      )}
      {m.tipo === "quitar" && !chegou && (
        <li className="mudo">{pede > 0 ? "O valor por mês é só para o que sai da sobra: parcela que já é gasto contaria duas vezes." : "Não desconta do teto: a parcela já conta como gasto do mês."}</li>
      )}
    </ul>
  );
}

function Nova({ livres, salvando, onCriar }: {
  livres: (tipo: Meta["tipo"]) => Posicao[];
  salvando: boolean;
  onCriar: (m: EdicaoMeta & { nome: string; tipo: Meta["tipo"] }, depois: () => void) => void;
}) {
  const [tipo, setTipo] = useState<Meta["tipo"]>("guardar");
  const [nome, setNome] = useState(""), [alvo, setAlvo] = useState(""), [porMes, setPorMes] = useState(""), [medida, setMedida] = useState("");
  const centavosAlvo = lerDinheiro(alvo), centavosPorMes = lerDinheiro(porMes);
  const escolhida = livres(tipo).find((p) => idDe(p) === medida);
  const invalido = (v: number | null) => v === null || v < 0;
  // guardar sem valor não pede nada; juntar precisa do alvo; quitar, da dívida
  const pronto = !!nome.trim() && !invalido(centavosPorMes) && (tipo === "guardar" ? centavosPorMes! > 0 : tipo === "juntar" ? (centavosAlvo ?? 0) > 0 : !!escolhida);
  return (
    <form
      className="painel meta nova"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pronto) return;
        onCriar(
          {
            tipo, nome: nome.trim(),
            ...(centavosPorMes! > 0 && { por_mes: centavosPorMes! }),
            ...(tipo === "juntar" && { alvo: centavosAlvo! }),
            ...(tipo !== "guardar" && escolhida && { medida: { origem: escolhida.origem, ref_id: escolhida.ref_id } }),
          },
          () => (setNome(""), setAlvo(""), setPorMes(""), setMedida("")),
        );
      }}
    >
      <h2>Nova meta</h2>
      <div className="segmentado" role="group" aria-label="Tipo da meta">
        {(Object.keys(TIPOS) as Meta["tipo"][]).map((t) => (
          <button type="button" key={t} className={tipo === t ? "ativo" : ""} aria-pressed={tipo === t} onClick={() => (setTipo(t), setMedida(""))}>{TIPOS[t]}</button>
        ))}
      </div>
      <div className="linha-form">
        <input className="campo" name="nova-nome" aria-label="Nome da meta" placeholder={tipo === "guardar" ? "Sobrar todo mês" : tipo === "juntar" ? "Reserva, viagem…" : "Financiamento, cartão…"} maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
        {tipo === "juntar" && <input className="campo num" name="nova-alvo" aria-label="Alvo" inputMode="decimal" placeholder="Alvo" value={alvo} aria-invalid={invalido(centavosAlvo)} onChange={(e) => setAlvo(e.target.value)} />}
        <input className="campo num" name="nova-por-mes" aria-label="Por mês" inputMode="decimal" placeholder={tipo === "guardar" ? "Por mês" : "Por mês (opcional)"} value={porMes} aria-invalid={invalido(centavosPorMes)} onChange={(e) => setPorMes(e.target.value)} />
        {tipo !== "guardar" && <Medida valor={escolhida ? medida : ""} opcoes={livres(tipo)} onEscolher={(p) => setMedida(p ? idDe(p) : "")} />}
        <button className="botao" disabled={!pronto || salvando}>Criar</button>
      </div>
      <p className="mudo pequeno">
        {tipo === "guardar" ? "Um valor que tem de sobrar todo mês. Sai do teto: o alarme passa a avisar quando o gasto invade essa parte."
          : tipo === "juntar" ? "O progresso é o saldo da conta, do cofrinho ou do bem escolhido. O valor por mês, se houver, sai do teto."
          : "O progresso é o quanto a dívida escolhida caiu. Deixe o valor por mês em branco se a parcela já entra como gasto: preenchido, sai do teto e contaria duas vezes."}
      </p>
    </form>
  );
}
