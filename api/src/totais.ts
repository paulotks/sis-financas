/**
 * Os totais do mês e o que sai deles: régua da renda, normal das categorias, recorrentes. Só lê a base; importar não migra nem abre porta
 * (as rotas ficam em server.ts).
 */
import { db } from "./db.js";
import { faltasDosCartoes, previstas } from "./faltas.js";
import { detectarRecorrentes, type Decisao, type Gasto, type Recorrente } from "./recorrentes.js";
import { diasDoMes, fechadosAntes, inicioDaAnalise, mediana, MESES_MEDIANA, type TotalMes } from "./ritmo.js";

export const fimDoMes = (mes: string) => `${mes}-${diasDoMes(mes)}`;

/** O que conta no mês. Resumo e orçamento usam este mesmo trecho: se um mudar, o outro muda junto. */
export const BASE_RESUMO = `FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id LEFT JOIN categorias cat ON cat.id = l.categoria_id
  WHERE l.data BETWEEN ? AND ? AND ct.pessoa = ? AND ct.oculta = 0 AND l.ignorado = 0 AND l.status IS NOT 'REMOVIDO'
    AND COALESCE(cat.grupo, '') <> 'transferencia'`;
/**
 * Gasto em centavos positivos; NULL = é entrada. Dinheiro que entra já com categoria de gasto é estorno ou reembolso e abate a
 * categoria. Sem categoria não abate: pode ser renda, ou um pagamento de fatura ainda não marcado como transferência.
 */
export const GASTO = `CASE WHEN l.valor_centavos < 0 OR cat.grupo <> 'renda' THEN -l.valor_centavos END`;
/** Entrada em centavos; NULL = é gasto (o contrário de GASTO). */
export const ENTRADA = `CASE WHEN ${GASTO} IS NULL THEN l.valor_centavos END`;
export const periodo = (mes: string, pessoa: string) => [`${mes}-01`, fimDoMes(mes), pessoa];

interface GastoCategoria { categoria_id: number | null; categoria: string; cor: string | null; grupo: string | null; total: number; qtd: number }
export const gastosPorCategoria = (mes: string, pessoa: string) =>
  db.prepare(
    `SELECT l.categoria_id, COALESCE(cat.nome,'Sem categoria') AS categoria, cat.cor, cat.grupo, SUM(${GASTO}) AS total, COUNT(${GASTO}) AS qtd
     ${BASE_RESUMO} GROUP BY l.categoria_id HAVING COUNT(${GASTO}) > 0 ORDER BY total DESC`,
  ).all(...periodo(mes, pessoa)) as unknown as GastoCategoria[];

export function totaisDoMes(mes: string, pessoa: string) {
  const tot = db.prepare(
    `SELECT COALESCE(SUM(${ENTRADA}),0) AS entradas,
            COALESCE(SUM(${GASTO}),0) AS saidas,
            SUM(l.categoria_id IS NULL) AS pendentes ${BASE_RESUMO}`,
  ).get(...periodo(mes, pessoa)) as { entradas: number; saidas: number; pendentes: number | null };
  return { ...tot, pendentes: tot.pendentes ?? 0 };
}

/** Parcelas que o banco ainda não mandou, das compras PF que contam no resumo, por mês. É estimativa: não entra em nenhum total. */
export function previstasPF(hoje: string) {
  const contam = new Set((db.prepare(`SELECT l.id ${BASE_RESUMO} AND l.total_parcelas > 1`).all("0000-01-01", hoje, "PF") as { id: string }[]).map((l) => l.id));
  const porMes = new Map<string, number>();
  for (const p of previstas(hoje)) if (contam.has(p.ultima)) porMes.set(p.mes, (porMes.get(p.mes) ?? 0) + p.valor);
  return porMes;
}

/** Gasto que o limite dos cartões PF já conta e ainda não apareceu nos lançamentos. Teto, e só aviso: não entra em nenhum total. */
export function naoApareceuPF(hoje: string) {
  const faltas = faltasDosCartoes(hoje);
  const cartoes = db.prepare("SELECT id AS conta_id, COALESCE(apelido, nome) AS conta FROM contas WHERE pessoa = 'PF' AND oculta = 0").all() as { conta_id: string; conta: string | null }[];
  return cartoes.map((c) => ({ ...c, valor: faltas.get(c.conta_id)?.nao_apareceu ?? 0 })).filter((c) => c.valor > 0);
}

/** Em categoria de renda, o planejado é a renda esperada: não é gasto. */
const planejadoPorCategoria = (mes: string) =>
  db.prepare(
    `SELECT c.id AS categoria_id, c.nome AS categoria, c.cor, c.grupo,
            (SELECT valor_centavos FROM orcamentos WHERE categoria_id = c.id AND mes <= ? ORDER BY mes DESC LIMIT 1) AS planejado
     FROM categorias c WHERE c.grupo <> 'transferencia' ORDER BY c.nome`,
  ).all(mes) as { categoria_id: number; categoria: string; cor: string | null; grupo: string; planejado: number | null }[];
export const somar = (ns: (number | null)[]) => ns.reduce<number>((s, n) => s + (n ?? 0), 0);

export const totaisPorMes = (ate: string) =>
  db.prepare(
    `SELECT substr(l.data,1,7) AS mes, COALESCE(SUM(${ENTRADA}),0) AS entradas,
            COALESCE(SUM(CASE WHEN cat.grupo = 'renda' THEN ${ENTRADA} END),0) AS renda, COALESCE(SUM(${GASTO}),0) AS gasto
     ${BASE_RESUMO} GROUP BY 1 ORDER BY 1`,
  ).all("0000-01-01", fimDoMes(ate), "PF") as unknown as TotalMes[];

/** Totais PF até o mês atual e o primeiro mês da análise: o que o usuário escolheu ou, sem escolha, o primeiro com a renda completa. */
export function historicoPF(mesAtual: string) {
  const totais = totaisPorMes(mesAtual);
  const inicio_automatico = inicioDaAnalise(totais, mesAtual);
  const escolhido = db.prepare("SELECT valor FROM config WHERE chave = 'inicio_analise'").get() as { valor: string } | undefined;
  return { totais, inicio: escolhido?.valor ?? inicio_automatico, inicio_automatico, inicio_definido: !!escolhido };
}

/** A renda que serve de régua no mês, o histórico de onde ela saiu e o orçado de gasto. Só PF. */
export function reguaDoMes(mes: string, mesAtual: string, { totais, inicio } = historicoPF(mesAtual)) {
  const anteriores = fechadosAntes(totais, mes < mesAtual ? mes : mesAtual, MESES_MEDIANA, inicio);
  const cats = planejadoPorCategoria(mes);
  const definida = somar(cats.filter((c) => c.grupo === "renda").map((c) => c.planejado));
  return {
    totais, inicio, anteriores, cats,
    orcado: somar(cats.filter((c) => c.grupo !== "renda").map((c) => c.planejado)),
    esperada: definida || mediana(anteriores.map((t) => t.renda)) || null,
    origem: definida ? ("definida" as const) : ("mediana" as const),
  };
}

/** O normal de cada categoria: a mediana do gasto nos meses anteriores. Nulo = não há mês anterior na análise. */
export function normalPorCategoria(anteriores: TotalMes[]) {
  const meses = anteriores.map((t) => new Map(gastosPorCategoria(t.mes, "PF").map((g) => [g.categoria_id, g.total])));
  return (categoria_id: number | null) => {
    const m = mediana(meses.map((totais) => totais.get(categoria_id) ?? 0));
    return m === null ? null : Math.max(0, m); // reembolso pode deixar o mês da categoria negativo; "normal" abaixo de zero não diz nada
  };
}

/**
 * Último dia com dado de todos os bancos PF visíveis: depois dele, dia sem gasto pode ser só dado que não chegou. Banco 48 h atrás do mais
 * novo não segura os outros (a tela já o acusa).
 */
export function ultimoDiaComDado(hoje: string) {
  const { dia } = db.prepare(
    `WITH bancos AS (SELECT julianday(atualizado_pluggy) AS lido FROM conexoes WHERE item_id IN (SELECT item_id FROM contas WHERE pessoa = 'PF' AND oculta = 0))
     SELECT date(MIN(lido), 'localtime') AS dia FROM bancos WHERE lido >= (SELECT MAX(lido) FROM bancos) - 2`,
  ).get() as { dia: string | null };
  return dia !== null && dia < hoje ? dia : hoje;
}
/** Quantos dias do mês têm dado; 0 = os dados ainda são do mês anterior. */
export const diasComDado = (mes: string, ate: string) => (ate < `${mes}-01` ? 0 : Number(ate.slice(8)));

/** Deve cobrar de novo: conta no alarme. Sugestão conta até ser ignorada. */
export const deveCobrar = (r: Recorrente) => r.status !== "ignorada" && r.status !== "cancelada" && r.situacao !== "parada";

export function listarRecorrentes(pessoa: string, hoje: string) {
  const gastos = db.prepare(
    `SELECT l.data, l.descricao, l.descricao_original, l.status, -l.valor_centavos AS valor, cat.nome AS categoria, cat.cor, COALESCE(ct.apelido, ct.nome) AS conta
     ${BASE_RESUMO} AND l.valor_centavos < 0 AND COALESCE(l.total_parcelas, 0) <= 1 ORDER BY l.data`,
  ).all("0000-01-01", hoje, pessoa) as unknown as Gasto[];
  const decisoes = db.prepare("SELECT chave, valor_centavos AS valor, status, proposta, decidido_em FROM recorrencias").all() as unknown as Decisao[];
  return detectarRecorrentes(gastos, hoje, decisoes);
}
