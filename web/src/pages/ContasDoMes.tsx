import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api, dataCurta, dinheiro, lerDinheiro, mesAtual, mesCurto, nomeMes, semSimbolo, type Compromisso, type CompromissoFatura, type CompromissoManual, type EdicaoCompromisso, type Recorrente,
} from "../lib/api";
import CampoDinheiro from "../components/CampoDinheiro";
import SeletorMes from "../components/SeletorMes";

/** Duas abas: o mês (com as ações) e o ano (só leitura), que mostra cada mês como a aba Mês dele. */
export default function ContasDoMes() {
  const [params] = useSearchParams();
  return params.get("aba") === "ano" ? <Ano /> : <Mes />;
}

function Abas({ aba }: { aba: "mes" | "ano" }) {
  const [params, setParams] = useSearchParams();
  return (
    <div className="segmentado">
      <button className={aba === "mes" ? "ativo" : ""} onClick={() => setParams({})}>Mês</button>
      <button className={aba === "ano" ? "ativo" : ""} onClick={() => setParams({ aba: "ano", ano: (params.get("mes") ?? mesAtual()).slice(0, 4) })}>Ano</button>
    </div>
  );
}

/**
 * O mês pelo dinheiro que sai da conta, no mês em que sai. Nada daqui soma em outro número: as ações são a decisão da sugestão (a mesma de
 * Recorrentes) e as contas à mão, que só existem nesta página.
 */
function Mes() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesAtual();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["compromissos", mes], queryFn: () => api.compromissos(mes) });
  const decidir = useMutation({
    mutationFn: api.decidirRecorrente,
    onSettled: () => Promise.all([["compromissos"], ["recorrentes"], ["ritmo"], ["analises"]].map((queryKey) => qc.invalidateQueries({ queryKey }))), // sugestão conta no alarme
  });
  // a conta à mão só muda esta página
  const aoMudar = { onSettled: () => Promise.all([["compromissos"], ["candidatos"]].map((queryKey) => qc.invalidateQueries({ queryKey }))) };
  const criar = useMutation({ mutationFn: api.criarCompromisso, ...aoMudar });
  const editar = useMutation({ mutationFn: ({ id, ...e }: EdicaoCompromisso & { id: number }) => api.editarCompromisso(id, e), ...aoMudar });
  const apagar = useMutation({ mutationFn: api.apagarCompromisso, ...aoMudar });
  const marcar = useMutation({ mutationFn: ({ id, pago }: { id: number; pago: boolean }) => api.marcarCompromisso(id, mes, pago), ...aoMudar });
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const d = q.data, passou = mes < mesAtual();
  const erro = q.error ?? decidir.error ?? criar.error ?? editar.error ?? apagar.error ?? marcar.error;
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
        <Abas aba="mes" />
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
        Só pessoa física. Cada linha é o que sai da conta no mês: a conta que você cadastrou à mão, a recorrente que cobra na conta e a fatura de
        cada cartão, que já tem as compras dele. O pago vem dos lançamentos do banco. Estes números não entram em nenhum outro; só confirmar ou
        ignorar uma sugestão muda o alarme, como em Recorrentes.
        {d && <> Atrasada = venceu e os dados do banco já vão até {dataCurta(d.dados_ate)}.</>}
      </p>

      <div className="acoes-linha">
        <button className="botao" aria-expanded={nova} onClick={() => setNova(!nova)}>{nova ? "Fechar" : "+ Adicionar conta"}</button>
      </div>
      {nova && <Nova mes={mes} salvando={criar.isPending} onCriar={(k, depois) => criar.mutate(k, { onSuccess: () => (depois(), setNova(false)) })} />}

      <div className="tabela-wrap">
        <table className="tabela compacta contas-do-mes">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Dia</th>
              <th>Conta</th>
              <th className="num" style={{ width: 130 }}>Valor</th>
              <th style={{ width: 280 }}>Situação</th>
              <th style={{ width: 330 }}><span className="so-leitor">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {d?.linhas.length === 0 && <tr><td colSpan={5} className="vazio">Nenhuma conta neste mês.</td></tr>}
            {!d && <tr><td colSpan={5} className="vazio">{q.isLoading ? "Carregando…" : ""}</td></tr>}
            {d?.linhas.map((l) => {
              const id = l.tipo === "fatura" ? `f|${l.conta_id}|${l.dia}` : l.tipo === "manual" ? `m|${l.cadastro.id}` : `r|${l.chave}|${l.valor_chave}|${l.dia}`;
              const resolvida = l.situacao === "paga" || l.situacao === "nao_paga";
              if (l.tipo === "manual") {
                const k = l.cadastro, salvar = (e: EdicaoCompromisso) => editar.mutate({ id: k.id, ...e });
                return (
                  <Fragment key={id}>
                    <tr className={resolvida ? "resolvida" : ""}>
                      <td>{dataCurta(l.dia)}</td>
                      <td>
                        <div className="linha-nome">
                          <CampoTexto nome="nome" valor={k.nome} rotulo={`Nome de ${k.nome}`} maximo={60} obrigatorio onSalvar={(nome) => salvar({ nome })} />
                          <span className="selo">à mão</span>
                        </div>
                        <div className="sub campos-linha">
                          <label>todo dia <CampoDia valor={k.dia} rotulo={`Dia de ${k.nome}`} onSalvar={(dia) => salvar({ dia })} /></label>
                          <label>acha por <CampoTexto nome="texto" valor={k.texto ?? ""} rotulo={`Texto do pagamento de ${k.nome}`} dica="texto do lançamento" onSalvar={(texto) => salvar({ texto: texto || null })} /></label>
                          <label>
                            até
                            <input
                              key={k.fim ?? ""} className="editavel" type="month" name="fim" aria-label={`Até quando vale ${k.nome}`} min={k.inicio} defaultValue={k.fim ?? ""}
                              onBlur={(e) => e.target.value !== (k.fim ?? "") && !e.target.validity.badInput && salvar({ fim: e.target.value || null })}
                            />
                          </label>
                        </div>
                      </td>
                      <td className="num">
                        <CampoDinheiro valor={k.valor} obrigatorio rotulo={`Valor esperado de ${k.nome}`} onSalvar={(valor) => salvar({ valor })} />
                        {l.situacao === "paga" && l.valor !== k.valor && <div className="sub">pago {dinheiro(l.valor)}</div>}
                      </td>
                      <td><Situacao l={l} /></td>
                      <td>
                        <div className="acoes-linha">
                          {!l.pago_por && (
                            <button className="botao secundario" disabled={marcar.isPending} aria-label={`${l.marcada ? "Desfazer a marca de pago" : "Marcar como pago"}: ${k.nome}`}
                              onClick={() => marcar.mutate({ id: k.id, pago: !l.marcada })}>
                              {l.marcada ? "Desfazer" : "Marcar como pago"}
                            </button>
                          )}
                          <button className="botao secundario" aria-expanded={aberta === id} aria-label={`Vincular pagamento: ${k.nome}`} onClick={() => setAberta(aberta === id ? null : id)}>
                            {aberta === id ? "Fechar" : "Vincular pagamento"}
                          </button>
                          <button
                            className="icone-botao" title="Apagar de todos os meses" aria-label={`Apagar ${k.nome}`}
                            onClick={() => confirm(`Apagar "${k.nome}"? Some de todos os meses, com as marcas de pago.`) && apagar.mutate(k.id)}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                    {aberta === id && (
                      <tr className="detalhe"><td /><td colSpan={4}><Candidatos l={l} mes={mes} onUsar={(texto) => salvar({ texto })} /></td></tr>
                    )}
                  </Fragment>
                );
              }
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

/** As contas × os 12 meses, só leitura. Cada coluna é a aba Mês daquele mês (o cabeçalho abre ela); o rodapé soma o passado pelo que saiu. */
function Ano() {
  const [params, setParams] = useSearchParams();
  const ano = params.get("ano") ?? mesAtual().slice(0, 4);
  const q = useQuery({ queryKey: ["compromissos", "ano", ano], queryFn: () => api.compromissosDoAno(ano) });
  const d = q.data, irPara = (n: number) => setParams({ aba: "ano", ano: String(Number(ano) + n) }, { replace: true });
  const rodape = (rotulo: string, dica: string, valor: (m: NonNullable<typeof d>["meses"][number]) => number | null) => (
    <tr>
      <th title={dica}>{rotulo}</th>
      {d!.meses.map((m) => {
        const v = valor(m);
        return <td key={m.mes} className={`num ${m.passou ? "" : "previsto"} ${v !== null && v < 0 ? "neg" : ""}`}>{v === null ? "—" : semSimbolo(v)}</td>;
      })}
    </tr>
  );

  return (
    <section>
      <header className="topo">
        <h1>Contas do mês</h1>
        <Abas aba="ano" />
        <div className="seletor-mes">
          <button className="icone-botao" title="Ano anterior" onClick={() => irPara(-1)}>‹</button>
          <span>{ano}</span>
          <button className="icone-botao" title="Próximo ano" onClick={() => irPara(1)}>›</button>
        </div>
      </header>

      {q.error && <div className="aviso erro">{q.error.message}</div>}
      <p className="mudo pequeno">
        Em reais. Cada coluna é a aba Mês daquele mês: clique no mês para abrir, e para confirmar, marcar ou editar. O que já foi pago aparece em cor
        cheia; o que ainda vai sair, mais claro (≈ = fatura estimada). No rodapé, o mês que passou conta o que saiu e a renda que entrou; do mês
        atual em diante, o esperado. A fatura que foi para a seguinte conta só o que foi pago dela: o resto está no total da seguinte.
      </p>

      <div className="tabela-wrap">
        <table className="tabela compacta contas-do-ano">
          <thead>
            <tr>
              <th>Conta</th>
              {(d?.meses ?? []).map((m) => (
                <th key={m.mes} className={`num ${m.mes === mesAtual() ? "atual" : ""}`}>
                  <Link to={`?mes=${m.mes}`} title={`Abrir ${nomeMes(m.mes).toLowerCase()}`}>{nomeMes(m.mes).slice(0, 3)}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d?.linhas.length === 0 && <tr><td colSpan={13} className="vazio">Nenhuma conta neste ano.</td></tr>}
            {!d && <tr><td colSpan={13} className="vazio">{q.isLoading ? "Carregando…" : ""}</td></tr>}
            {d?.linhas.map((l) => {
              const ultima = l.meses.findLast((c) => c.length)![0];
              return (
                <tr key={l.id}>
                  <td className="nome" title={l.tipo === "fatura" ? `Fatura ${l.nome}` : l.nome}>
                    {l.tipo === "fatura" ? `Fatura ${l.nome}` : l.nome}
                    {l.tipo === "manual" && <span className="selo">à mão</span>}
                    {ultima.tipo === "recorrente" && ultima.sugestao && <span className="selo">sugestão</span>}
                  </td>
                  {l.meses.map((c, i) => <td key={i} className="num">{c.map((x, j) => <Celula key={j} l={x} passou={d.meses[i].passou} />)}</td>)}
                </tr>
              );
            })}
          </tbody>
          {d && (
            <tfoot>
              {rodape("Contas", "O que saiu, no mês que passou; o esperado, do atual em diante.", (m) => m.total)}
              {rodape("Renda", "A que entrou, no mês que passou; a esperada (a régua do alarme), do atual em diante.", (m) => m.renda)}
              {rodape("Metas", "O que as metas pedem no mês.", (m) => m.metas)}
              {rodape("Livre", "Renda − contas − metas desta tabela. Pelo vencimento: não é o número do Resumo nem a sobra do Orçamento.", (m) => m.livre)}
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

/** Pago em cor cheia; o que vai sair, mais claro; o mês que passou sem pagamento, "não paga". */
function Celula({ l, passou }: { l: Compromisso; passou: boolean }) {
  if (l.situacao === "paga") return <div title={l.pago_em ? `paga em ${dataCurta(l.pago_em)}` : "nada a pagar"}>{semSimbolo(l.valor)}</div>;
  if (l.situacao === "nao_paga") {
    const para = l.tipo === "fatura" && l.foi_para ? ` foi para a fatura de ${mesCurto(l.foi_para)}` : "";
    return <div className="mudo" title={l.pago > 0 ? `paga ${dinheiro(l.pago)} de ${dinheiro(l.valor)} · o resto${para}` : `não paga ·${para}`}>{l.pago > 0 ? semSimbolo(l.pago) : "não paga"}</div>;
  }
  if (passou) return <div className="alerta" title={`venceu em ${dataCurta(l.dia)} sem pagamento`}>não paga</div>;
  const estimada = l.tipo === "fatura" && l.estimada;
  const dica = `${l.situacao === "atrasada" ? "atrasada" : "a pagar"}, ${dataCurta(l.dia)}${estimada ? " (estimada)" : ""}${l.pago > 0 ? ` · paga ${dinheiro(l.pago)}` : ""}`;
  return <div className={`previsto ${l.situacao === "atrasada" ? "alerta" : ""}`} title={dica}>{estimada && "≈ "}{semSimbolo(l.valor)}</div>;
}

function Situacao({ l }: { l: Compromisso }) {
  const parcial = l.situacao !== "paga" && l.pago > 0 ? `paga ${dinheiro(l.pago)} de ${dinheiro(l.valor)}` : null;
  if (l.tipo === "manual" && l.situacao === "paga") {
    return l.pago_por
      ? <span className="ok">✓ paga em {dataCurta(l.pago_por.data)}<div className="sub">{l.pago_por.descricao}{l.pago_por.conta && ` · ${l.pago_por.conta}`}</div></span>
      : <span className="ok">✓ marcada como paga</span>;
  }
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

/** Texto editável na linha: Enter ou sair do campo salva, Esc desfaz. Volta ao gravado na hora: o que a API gravar (ou recusar) aparece em seguida. */
function CampoTexto({ nome, valor, rotulo, dica, maximo = 100, obrigatorio = false, onSalvar }: {
  nome: string; valor: string; rotulo: string; dica?: string; maximo?: number; obrigatorio?: boolean; onSalvar: (v: string) => void;
}) {
  return (
    <input
      key={valor} className="editavel" name={nome} aria-label={rotulo} placeholder={dica} maxLength={maximo} defaultValue={valor}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== valor && (v || !obrigatorio)) onSalvar(v);
        e.target.value = valor;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.value = valor;
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}

function CampoDia({ valor, rotulo, onSalvar }: { valor: number; rotulo: string; onSalvar: (dia: number) => void }) {
  return (
    <input
      key={valor} className="editavel num dia" name="dia" type="number" min={1} max={31} aria-label={rotulo} defaultValue={valor}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n >= 1 && n <= 31 && n !== valor) onSalvar(n);
        e.target.value = String(valor); // o gravado; o novo chega com a resposta
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.value = String(valor);
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}

/** Conta nova, valendo do mês que está na tela em diante: em N parcelas, até o mês da última. */
function Nova({ mes, salvando, onCriar }: { mes: string; salvando: boolean; onCriar: (k: EdicaoCompromisso & { nome: string; valor: number; dia: number }, depois: () => void) => void }) {
  const [nome, setNome] = useState(""), [valor, setValor] = useState(""), [dia, setDia] = useState(""), [texto, setTexto] = useState(""), [parcelas, setParcelas] = useState("");
  const centavos = lerDinheiro(valor), n = Number(dia), p = Number(parcelas);
  const diaOk = Number.isInteger(n) && n >= 1 && n <= 31, parcelasOk = !parcelas || (Number.isInteger(p) && p >= 1);
  const pronto = !!nome.trim() && (centavos ?? 0) > 0 && diaOk && parcelasOk;
  return (
    <form
      className="painel nova-conta"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pronto) return;
        onCriar(
          { nome: nome.trim(), valor: centavos!, dia: n, inicio: mes, ...(texto.trim() && { texto: texto.trim() }), ...(parcelas && { parcelas: p }) },
          () => (setNome(""), setValor(""), setDia(""), setTexto(""), setParcelas("")),
        );
      }}
    >
      <div className="linha-form">
        <input className="campo" name="nova-nome" aria-label="Nome da conta" placeholder="Nome (aluguel, curso…)" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
        <input className="campo num" name="nova-valor" aria-label="Valor esperado" inputMode="decimal" placeholder="Valor" value={valor} aria-invalid={!!valor && !((centavos ?? 0) > 0)} onChange={(e) => setValor(e.target.value)} />
        <input className="campo num dia" name="nova-dia" aria-label="Dia do mês" type="number" min={1} max={31} placeholder="Dia" value={dia} onChange={(e) => setDia(e.target.value)} />
        <input className="campo" name="nova-texto" aria-label="Texto do pagamento (opcional)" placeholder="Texto do pagamento (opcional)" maxLength={100} value={texto} onChange={(e) => setTexto(e.target.value)} />
        <input className="campo num" name="nova-parcelas" aria-label="Em quantas parcelas (opcional)" type="number" min={1} placeholder="Parcelas" value={parcelas} aria-invalid={!parcelasOk} onChange={(e) => setParcelas(e.target.value)} />
        <button className="botao" disabled={!pronto || salvando}>Adicionar</button>
      </div>
      <p className="mudo pequeno">
        Vale de {nomeMes(mes).toLowerCase()} em diante; com parcelas, até a última. O pagamento é achado pelo texto, numa saída de conta (não de
        cartão: o que se paga no cartão já está na fatura). Sem texto, marque como paga à mão. Dá para escolher o lançamento depois, em
        “Vincular pagamento”. O texto não cria regra de categoria.
      </p>
    </form>
  );
}

/** Os candidatos do mês, do valor mais próximo ao mais longe: escolher grava o nome do lançamento no texto da conta. */
function Candidatos({ l, mes, onUsar }: { l: CompromissoManual; mes: string; onUsar: (texto: string) => void }) {
  const k = l.cadastro;
  const q = useQuery({ queryKey: ["candidatos", k.id, mes], queryFn: () => api.candidatos(k.id, mes) });
  const [todos, setTodos] = useState(false);
  const lista = (q.data ?? []).filter((c) => c.nome.length >= 3); // nome curto demais não serve de texto
  return (
    <div className="fatura-aberta">
      <p className="mudo pequeno">
        Saídas de conta de {nomeMes(mes).toLowerCase()}, da mais perto de {dinheiro(k.valor)} à mais longe. Escolher grava o nome do lançamento em
        “acha por”. Se o nome muda com a forma de pagamento (boleto e Pix, por exemplo), encurte o texto para o trecho que os dois têm. Não cria
        regra de categoria.
      </p>
      {q.isLoading && <p className="mudo pequeno">Carregando…</p>}
      {q.error && <div className="aviso erro">{q.error.message}</div>}
      {q.data && lista.length === 0 && <p className="mudo pequeno">Nenhuma saída de conta neste mês.</p>}
      <ul>
        {(todos ? lista : lista.slice(0, 10)).map((c) => (
          <li key={c.id}>
            <span>{dataCurta(c.data)} · {c.descricao} <span className="mudo">{c.conta}{c.de && ` · já paga “${c.de}”`}</span></span>
            <span className="num">
              {dinheiro(c.valor)}{" "}
              <button className="botao secundario" disabled={c.nome === k.texto} aria-label={`Usar ${c.descricao}, ${dinheiro(c.valor)}`} onClick={() => onUsar(c.nome)}>
                {c.nome === k.texto ? "Em uso" : "Usar"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {!todos && lista.length > 10 && <button className="botao secundario" onClick={() => setTodos(true)}>Mostrar todas ({lista.length})</button>}
    </div>
  );
}
