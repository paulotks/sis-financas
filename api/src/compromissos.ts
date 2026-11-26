/**
 * Contas do mês (docs/specs/lote-7.md): o mês pelo dinheiro que sai da conta, no mês em que sai. Lente de caixa e só leitura: nada daqui
 * soma em Resumo, Orçamento, alarme, Análises, metas ou patrimônio. Uma linha por conta cadastrada à mão, por recorrente que sai de conta e
 * por fatura de cartão PF visível; o que é pago no cartão está dentro da fatura. As funções puras montam um mês: a aba Ano chama as mesmas.
 */
import { fechamentoAbreOSeguinte } from "./adaptadores.js";
import { db } from "./db.js";
import { menosDias, previstas, type Prevista } from "./faltas.js";
import { chaveDe, deveCobrar, nomeDe, type Recorrente } from "./recorrentes.js";
import { diasDoMes, somarMes } from "./ritmo.js";
import { BASE_RESUMO, fimDoMes, listarRecorrentes, reguaDoMes, somar, totaisDoMes, ultimoDiaComDado } from "./totais.js";
import type {
  CandidatoAPagamento, CandidatosAPagamento, Compromisso, CompromissoCadastrado, CompromissoFatura, CompromissoManual, CompromissoRecorrente, Compromissos,
} from "./tipos.js";

const RUIDO = 100; // até R$ 1 de diferença, a fatura está paga
const IGUAL = 5; // folga de centavos ao comparar com um crédito
const DIAS_ATE_O_VENCIMENTO = 10; // sem a data de fechamento, como nos avisos
const DIAS_DE_FOLGA = 15; // fatura do banco a até isso do vencimento esperado é a daquele ciclo
const MESES_DA_MEDIA = 2; // cartão sem fatura do banco há mais que isso: a média é velha demais para estimar

/** A parcela já vem à parte: "Loja 3/10" vira "Loja". */
const semParcela = (descricao: string) => descricao.replace(/\s*\d{1,2}\/\d{1,2}\s*$/, "");

/** O mesmo dia de `data` em `mes`; 31 vira o último dia. */
const diaEm = (mes: string, data: string) => `${mes}-${String(Math.min(Number(data.slice(8, 10)), diasDoMes(mes))).padStart(2, "0")}`;

/**
 * As recorrentes que saem de conta no mês; a cobrança feita no cartão está na fatura e a ignorada não é recorrente. Série que trocou de meio
 * de pagamento: o passado vale cobrança a cobrança; o que vem, pela conta da última. `pegos` = lançamentos que uma conta à mão levou (no mês
 * e no da última cobrança de cada recorrente): a conta à mão escolhe primeiro.
 */
export function linhasDeRecorrentes(rs: Recorrente[], mes: string, hoje: string, dadosAte: string, pegos = new Set<string>()): CompromissoRecorrente[] {
  const mesAtual = hoje.slice(0, 7);
  return rs.filter((r) => r.status !== "ignorada").flatMap((r): CompromissoRecorrente[] => {
    const linha = (dia: string, valor: number, pago: boolean, parada = false): CompromissoRecorrente => ({
      tipo: "recorrente", nome: r.descricao, conta: r.conta, categoria: r.categoria, cor: r.cor, chave: r.chave, valor_chave: r.valor_chave,
      sugestao: r.status === null, parada, dia, valor, pago: pago ? valor : 0, pago_em: pago ? dia : null,
      situacao: pago ? "paga" : parada || dia < dadosAte ? "atrasada" : "a_pagar",
    });
    const todasDoMes = r.cobrancas.filter((c) => !c.cartao && c.data.startsWith(mes));
    const doMes = todasDoMes.filter((c) => !pegos.has(c.id)); // a que uma conta à mão pegou é dela; a que sobrou ainda é desta
    const pagas = doMes.filter((c) => c.data <= hoje); // em qualquer mês e qualquer status de hoje: a cancelada aparece onde cobrou
    if (pagas.length) return [linha(pagas.at(-1)!.data, somar(pagas.map((c) => c.valor)), true)];
    // mês que passou: só o que cobrou; a que hoje cobra no cartão vem na fatura; a do mês que a conta à mão pegou não se projeta
    if (mes < mesAtual || r.cartao || doMes.length < todasDoMes.length) return [];
    if (pegos.has(r.cobrancas.findLast((c) => c.data <= hoje)?.id ?? "")) return []; // a última é de uma conta à mão: o que vem é dela
    const agendada = doMes.find((c) => c.data > hoje); // já lançada com data futura: ainda não saiu
    if (agendada) return [linha(agendada.data, agendada.valor, false)];
    if (deveCobrar(r) && r.a_lancar.slice(0, 7) <= mes) {
      // no mês atual, a atrasada do mês passado continua com a data dela; nos futuros, o dia da última cobrança
      return [linha(mes === mesAtual || r.a_lancar.startsWith(mes) ? r.a_lancar : diaEm(mes, r.cobrancas.at(-1)!.data), r.valor, false)];
    }
    // confirmada nunca some calada: se parou de cobrar, fica atrasada no mês atual (nos futuros não se projeta, como no alarme)
    if (r.status === "confirmada" && r.situacao === "parada" && mes === mesAtual) return [linha(r.a_lancar, r.valor, false, true)];
    return [];
  });
}

/** O texto da conta à mão e o nome do lançamento, do mesmo jeito: sem acento, número, símbolo, espaço nem forma de pagamento ("Pagamento de conta"). */
export const normalizarTexto = (texto: string) => nomeDe(chaveDe(texto));
export const MINIMO_LETRAS_DO_TEXTO = 3;

const vale = (c: CompromissoCadastrado, mes: string) => c.inicio <= mes && (c.fim === null || mes <= c.fim);

/**
 * Quem paga cada conta à mão no mês: o candidato cujo nome contém o texto. Disputa (duas contas, ou dois candidatos): cada conta fica com o de
 * valor mais próximo do esperado, começando pela menor diferença, e um lançamento paga uma conta só. O empate se decide pela conta, a data e o
 * id, para a mesma leitura dar sempre o mesmo dono.
 */
export function casar(contas: CompromissoCadastrado[], candidatos: CandidatoAPagamento[]): Map<number, CandidatoAPagamento> {
  const pares = contas.flatMap((k) => (k.texto ? candidatos.filter((c) => c.nome.includes(k.texto!)).map((c) => ({ k, c, d: Math.abs(c.valor - k.valor) })) : []))
    .sort((a, b) => a.d - b.d || a.k.id - b.k.id || a.c.data.localeCompare(b.c.data) || a.c.id.localeCompare(b.c.id));
  const donos = new Map<number, CandidatoAPagamento>(), usados = new Set<string>();
  for (const { k, c } of pares) {
    if (donos.has(k.id) || usados.has(c.id)) continue;
    donos.set(k.id, c);
    usados.add(c.id);
  }
  return donos;
}

/**
 * As contas à mão do mês (de `inicio` a `fim`). Paga pelo lançamento que casou (valor e dia reais); senão pela marca à mão; senão, atrasada
 * quando os dados do banco já cobrem o dia, também nos meses que passaram.
 */
export function linhasDeManuais(
  contas: CompromissoCadastrado[], donos: Map<number, CandidatoAPagamento>, marcas: Map<number, number>, mes: string, dadosAte: string,
): CompromissoManual[] {
  return contas.filter((k) => vale(k, mes)).map((k): CompromissoManual => {
    const c = donos.get(k.id), marcado = marcas.get(k.id), dia = `${mes}-${String(Math.min(k.dia, diasDoMes(mes))).padStart(2, "0")}`;
    const base = { tipo: "manual" as const, nome: k.nome, cadastro: k, pago_por: c ? { data: c.data, descricao: c.descricao, conta: c.conta } : null, marcada: false };
    if (c) return { ...base, dia: c.data, valor: c.valor, pago: c.valor, pago_em: c.data, situacao: "paga" };
    if (marcado !== undefined) return { ...base, marcada: true, dia, valor: marcado, pago: marcado, pago_em: null, situacao: "paga" };
    return { ...base, dia, valor: k.valor, pago: 0, pago_em: null, situacao: dia < dadosAte ? "atrasada" : "a_pagar" };
  });
}

export interface FaturaDoBanco {
  id: string;
  vencimento: string;
  fechamento: string | null; // billClosingDate; nulo = não veio
  total: number | null;
}
export interface LancadoNoCartao {
  id: string;
  data: string;
  valor: number; // com sinal
  fatura_id: string | null;
  pagamento: number; // categoria Pagamento de fatura
  descricao: string;
  parcela: number | null;
  total_parcelas: number | null;
}
interface Ciclo {
  vencimento: string;
  fechamento: string;
  fatura: FaturaDoBanco | null; // nulo = o banco ainda não mandou (ou não vai mandar)
}

/**
 * Um ciclo por mês, do anterior à primeira fatura (só abre a janela da primeira) até o seguinte a `ate` (fecha a janela do último). O mês sem
 * fatura do banco repete o dia do vencimento do cartão e a distância até o fechamento da última fatura que trouxe a data.
 */
function ciclosDoCartao(faturas: FaturaDoBanco[], vencimentoDoCartao: string | null, desde: string, ate: string): Ciclo[] {
  const dia = vencimentoDoCartao ?? faturas.at(-1)?.vencimento;
  const comData = faturas.findLast((f) => f.fechamento);
  const distancia = comData ? Math.round((Date.parse(comData.vencimento) - Date.parse(comData.fechamento!)) / 86_400_000) : DIAS_ATE_O_VENCIMENTO;
  const ciclos: Ciclo[] = [];
  for (let m = somarMes(desde, -1); m <= somarMes(ate, 1); m = somarMes(m, 1)) {
    const doMes = faturas.filter((f) => f.vencimento.startsWith(m));
    if (doMes.length) ciclos.push(...doMes.map((f) => ({ vencimento: f.vencimento, fechamento: f.fechamento ?? menosDias(f.vencimento, DIAS_ATE_O_VENCIMENTO), fatura: f })));
    else if (dia) {
      const vencimento = diaEm(m, dia);
      // a do banco pode ter vencido no começo do mês seguinte (ou no fim do anterior): não inventa outra ao lado dela
      const perto = faturas.some((f) => Math.abs(Date.parse(f.vencimento) - Date.parse(vencimento)) <= DIAS_DE_FOLGA * 86_400_000);
      if (!perto) ciclos.push({ vencimento, fechamento: menosDias(vencimento, distancia), fatura: null });
    }
  }
  return ciclos;
}

/**
 * A fatura do cartão que vence no mês. Pago = Pagamento de fatura positivo no lado do cartão, depois do fechamento dela e até o da seguinte
 * (o boleto pode vir ligado à fatura seguinte: vale a data, não o `fatura_id`). Lançamento cai no ciclo da fatura dele ou, sem ela, no
 * primeiro que fecha no dia dele ou depois; no banco em que o dia do fechamento abre o ciclo seguinte, no primeiro que fecha depois dele.
 * A fatura fechada de um cartão que liga os lançamentos a ela tem só os ligados: o total do banco bate com eles.
 */
export function faturasDoCartao(
  cartao: { id: string; nome: string; vencimento: string | null; banco: string | null },
  faturas: FaturaDoBanco[], // por vencimento
  lancados: LancadoNoCartao[],
  futuras: Prevista[], // parcelas que o banco ainda não mandou, deste cartão
  recorrentes: Recorrente[], // todas: as cobranças de qualquer uma não são "outras compras"
  mes: string, hoje: string, dadosAte: string,
): CompromissoFatura[] {
  const mesAtual = hoje.slice(0, 7);
  const primeiro = lancados.reduce<string | null>((m, l) => (m === null || l.data < m ? l.data : m), null);
  if (primeiro === null) return []; // sem lançamento não dá para dizer nada
  // desde a primeira fatura ou o primeiro lançamento: o mês sem fatura do banco ainda pode ter sido pago
  const desde = [faturas[0]?.vencimento.slice(0, 7) ?? mesAtual, primeiro.slice(0, 7)].sort()[0];
  const ciclos = ciclosDoCartao(faturas, cartao.vencimento, desde, mes > mesAtual ? mes : mesAtual);
  const conhecidas = new Set(faturas.map((f) => f.id));
  const liga = lancados.some((l) => l.fatura_id && conhecidas.has(l.fatura_id));
  const seguinteNoFechamento = fechamentoAbreOSeguinte(cartao.banco);
  /** Dentro do ciclo que vai do fechamento `de` ao `ate`. */
  const entre = (data: string, de: string, ate: string) => (seguinteNoFechamento ? data >= de && data < ate : data > de && data <= ate);
  const lancadosPorId = new Map(lancados.map((l) => [l.id, l]));
  const recorrenteDe = new Map(recorrentes.filter((r) => r.status !== "ignorada").flatMap((r) => r.cobrancas.map((c) => [c.id, r] as const)));
  const doCartao = recorrentes.filter((r) => r.cartao && r.conta_id === cartao.id && deveCobrar(r));

  return ciclos.flatMap((c, i): CompromissoFatura[] => {
    const anterior = ciclos[i - 1], seguinte = ciclos[i + 1];
    if (!c.vencimento.startsWith(mes) || !anterior || !seguinte) return [];
    const fechada = c.fatura?.total != null; // fatura fechada não recebe mais nada
    const naJanela = lancados.filter((l) => l.valor > 0 && l.data <= hoje && entre(l.data, c.fechamento, seguinte.fechamento));
    const pagamentos = naJanela.filter((l) => l.pagamento);
    const pago = somar(pagamentos.map((l) => l.valor)), pago_em = pagamentos.at(-1)?.data ?? null;

    // o que está (ou vai estar) nela
    const dela = lancados.filter((l) => !l.pagamento &&
      (l.fatura_id && conhecidas.has(l.fatura_id) ? l.fatura_id === c.fatura?.id : (!liga || !fechada) && entre(l.data, anterior.fechamento, c.fechamento)));
    const previstasDela = fechada ? [] : futuras.flatMap((p) => {
      const u = lancadosPorId.get(p.ultima)!, data = diaEm(p.mes, u.data);
      if (!entre(data, anterior.fechamento, c.fechamento)) return [];
      const n = futuras.filter((x) => x.ultima === p.ultima && x.mes <= p.mes).length; // a k-ésima prevista da compra
      return [{ descricao: semParcela(u.descricao), parcela: u.parcela! + n, total: u.total_parcelas!, valor: p.valor, prevista: true }];
    });
    const lancadasRec = new Map<Recorrente, number>();
    for (const l of dela) {
      const r = recorrenteDe.get(l.id);
      if (r) lancadasRec.set(r, (lancadasRec.get(r) ?? 0) - l.valor);
    }
    const aVir = fechada ? [] : doCartao.flatMap((r) => {
      const base = r.cobrancas.at(-1)!.data;
      // as que ainda não estão lançadas: a_lancar e as seguintes, no dia da última cobrança
      const datas = Array.from({ length: 13 }, (_, k) => diaEm(somarMes(base.slice(0, 7), k + 1), base)).filter((d) => entre(d, anterior.fechamento, c.fechamento));
      return datas.map(() => ({ nome: r.descricao, valor: r.valor, prevista: true }));
    });
    const recorrentesDela = [...[...lancadasRec].map(([r, valor]) => ({ nome: r.descricao, valor, prevista: false })), ...aVir];
    const parcelas = [
      ...dela.filter((l) => (l.total_parcelas ?? 0) > 1 && !recorrenteDe.has(l.id))
        .map((l) => ({ descricao: semParcela(l.descricao), parcela: l.parcela ?? 0, total: l.total_parcelas!, valor: -l.valor, prevista: false })),
      ...previstasDela,
    ];
    const resto = dela.filter((l) => (l.total_parcelas ?? 0) <= 1 && !recorrenteDe.has(l.id));
    const outras = { valor: -somar(resto.map((l) => l.valor)), qtd: resto.length };
    const comprometido = somar(recorrentesDela.map((r) => r.valor)) + somar(parcelas.map((p) => p.valor)) + outras.valor;

    const linha = { tipo: "fatura" as const, nome: cartao.nome, conta_id: cartao.id, dia: c.vencimento, fechamento: c.fechamento, pago, pago_em, comprometido,
      recorrentes: recorrentesDela, parcelas, outras, estimada: false, sem_fatura: c.fatura?.total == null, foi_para: null };
    const vencida = c.vencimento < dadosAte;
    const total = c.fatura?.total ?? null;
    if (total !== null) {
      // o banco pode descontar do pagamento um crédito que chegou depois do fechamento (o mesmo caso do aviso 70)
      const quitada = pago >= total - RUIDO || (pago > 0 && naJanela.some((l) => !l.pagamento && Math.abs(l.valor - (total - pago)) <= IGUAL));
      if (!quitada && c.fechamento < primeiro) return []; // de antes do primeiro lançamento: não dá para saber se foi paga
      // não paga e a seguinte já fechou: o saldo foi para ela (está no total que o banco cobra lá)
      const levou = !quitada && seguinte.fatura?.total != null && seguinte.fechamento <= hoje ? seguinte.vencimento.slice(0, 7) : null;
      // saldo credor não abate as outras contas: é nada a pagar
      return [{ ...linha, valor: Math.max(0, total), foi_para: levou, situacao: quitada ? "paga" : levou ? "nao_paga" : vencida ? "atrasada" : "a_pagar" }];
    }
    if (pago > 0) return [{ ...linha, valor: pago, situacao: "paga" }]; // sem o total do banco, vale o que foi pago
    if (mes < mesAtual) return []; // mês que passou nunca tem estimativa
    const ultimas = faturas.filter((f) => f.total !== null && f.vencimento < c.vencimento).slice(-3);
    const recente = (ultimas.at(-1)?.vencimento ?? "") >= `${somarMes(mesAtual, -MESES_DA_MEDIA)}-01`;
    const media = recente ? Math.round(somar(ultimas.map((f) => f.total)) / ultimas.length) : 0;
    const valor = Math.max(media, comprometido);
    if (valor <= 0) return []; // nada no ciclo e nada para comparar: não há o que estimar
    return [{ ...linha, estimada: true, valor, situacao: vencida ? "atrasada" : "a_pagar" }];
  });
}

export const lerCadastros = () =>
  db.prepare("SELECT id, nome, valor_centavos AS valor, dia, texto, inicio, fim FROM compromissos ORDER BY id").all() as unknown as CompromissoCadastrado[];

/** Saída de conta PF que não é cartão (o do cartão já está na fatura), com os filtros do Resumo, no mês e até hoje. */
export function candidatosDoMes(mes: string, hoje: string): CandidatoAPagamento[] {
  const ate = fimDoMes(mes) < hoje ? fimDoMes(mes) : hoje;
  return (db.prepare(
    `SELECT l.id, l.data, -l.valor_centavos AS valor, COALESCE(l.descricao, l.descricao_original, '') AS descricao, l.descricao_original,
            COALESCE(ct.apelido, ct.nome) AS conta
     ${BASE_RESUMO} AND ct.tipo IS NOT 'CREDIT' AND l.valor_centavos < 0 ORDER BY l.data, l.id`,
  ).all(`${mes}-01`, ate, "PF") as unknown as (CandidatoAPagamento & { descricao_original: string | null })[])
    .map(({ descricao_original, ...c }) => ({ ...c, nome: normalizarTexto(descricao_original ?? "") }));
}

/** Quem paga cada conta à mão no mês. A busca é refeita a cada leitura: a Pluggy recriar o lançamento com outro id não quebra nada. */
export function donosDoMes(mes: string, hoje: string, cadastros = lerCadastros()) {
  const vigentes = cadastros.filter((k) => vale(k, mes));
  return vigentes.length ? casar(vigentes, candidatosDoMes(mes, hoje)) : new Map<number, CandidatoAPagamento>();
}

/** Para "Vincular pagamento": os candidatos do mês, do valor mais próximo do esperado ao mais longe, com a conta à mão que já ficou com cada um. */
export function candidatosPara(cadastro: CompromissoCadastrado, mes: string, hoje: string): CandidatosAPagamento {
  const cadastros = lerCadastros(), donos = donosDoMes(mes, hoje, cadastros);
  const de = new Map([...donos].flatMap(([id, c]) => (id === cadastro.id ? [] : [[c.id, cadastros.find((k) => k.id === id)!.nome] as const])));
  return candidatosDoMes(mes, hoje).map((c) => ({ ...c, de: de.get(c.id) ?? null }))
    .sort((a, b) => Math.abs(a.valor - cadastro.valor) - Math.abs(b.valor - cadastro.valor) || b.data.localeCompare(a.data));
}

/** O mês inteiro: linhas pelo dia (os pagos no fim) e o topo. Só PF, sem conta oculta. */
export function compromissosDoMes(mes: string, hoje: string): Compromissos {
  const mesAtual = hoje.slice(0, 7), dadosAte = ultimoDiaComDado(hoje);
  const recorrentes = listarRecorrentes("PF", hoje);
  const cadastros = lerCadastros();
  // a conta à mão escolhe primeiro: no mês, e no mês da última cobrança de cada recorrente (a que a perdeu não se projeta mais)
  const donos = donosDoMes(mes, hoje, cadastros), pegos = new Set([...donos.values()].map((c) => c.id));
  const mesesDaUltima = new Set(recorrentes.flatMap((r) => r.cobrancas.findLast((c) => c.data <= hoje)?.data.slice(0, 7) ?? []));
  for (const m of mesesDaUltima) if (m !== mes) for (const c of donosDoMes(m, hoje, cadastros).values()) pegos.add(c.id);
  const marcas = new Map((db.prepare("SELECT compromisso_id AS id, valor_centavos AS valor FROM compromissos_pagos WHERE mes = ?").all(mes) as { id: number; valor: number }[])
    .map((m) => [m.id, m.valor]));
  const cartoes = db.prepare(
    `SELECT ct.id, COALESCE(ct.apelido, ct.nome) AS nome, ct.vencimento, cx.banco
     FROM contas ct JOIN conexoes cx ON cx.item_id = ct.item_id WHERE ct.tipo = 'CREDIT' AND ct.pessoa = 'PF' AND ct.oculta = 0`,
  ).all() as { id: string; nome: string; vencimento: string | null; banco: string | null }[];
  const faturas = db.prepare(
    `SELECT id, conta_id, vencimento, substr(json_extract(bruto, '$.billClosingDate'), 1, 10) AS fechamento, total_centavos AS total
     FROM faturas WHERE vencimento IS NOT NULL ORDER BY vencimento`,
  ).all() as unknown as (FaturaDoBanco & { conta_id: string })[];
  const lancados = db.prepare(
    `SELECT l.id, l.conta_id, l.data, l.valor_centavos AS valor, l.fatura_id, cat.nome IS 'Pagamento de fatura' AS pagamento,
            COALESCE(l.descricao, l.descricao_original, '') AS descricao, l.parcela, l.total_parcelas
     FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id LEFT JOIN categorias cat ON cat.id = l.categoria_id
     WHERE ct.tipo = 'CREDIT' AND ct.pessoa = 'PF' AND ct.oculta = 0 AND l.status IS NOT 'REMOVIDO' ORDER BY l.data`,
  ).all() as unknown as (LancadoNoCartao & { conta_id: string })[]; // ignorado entra: continua na fatura
  const futuras = previstas(hoje);
  const linhas: Compromisso[] = [
    ...linhasDeManuais(cadastros, donos, marcas, mes, dadosAte),
    ...linhasDeRecorrentes(recorrentes, mes, hoje, dadosAte, pegos),
    ...cartoes.flatMap((c) => faturasDoCartao(c, faturas.filter((f) => f.conta_id === c.id), lancados.filter((l) => l.conta_id === c.id),
      futuras.filter((p) => p.conta_id === c.id), recorrentes, mes, hoje, dadosAte)),
  ];
  const resolvida = (l: Compromisso) => l.situacao === "paga" || l.situacao === "nao_paga";
  linhas.sort((a, b) => Number(resolvida(a)) - Number(resolvida(b)) || a.dia.localeCompare(b.dia) || a.nome.localeCompare(b.nome));

  const { esperada, metas } = reguaDoMes(mes, mesAtual);
  // paga conta inteira (o banco pode ter abatido um crédito); pago a mais (perna repetida do banco) não vira crédito
  const pagoDe = (l: Compromisso) => (l.situacao === "paga" ? l.valor : Math.max(0, Math.min(l.pago, l.valor)));
  const total = somar(linhas.map((l) => l.valor)), pago = somar(linhas.map(pagoDe));
  return {
    mes, dados_ate: dadosAte, renda: { esperada, entrou: totaisDoMes(mes, "PF").entradas },
    total, pago, falta: somar(linhas.map((l) => Math.max(0, l.valor - pagoDe(l)))), metas, livre: esperada === null ? null : esperada - total - metas, linhas,
  };
}
