/**
 * Metas (só PF): quanto cada uma pede por mês (sai do teto do alarme), o progresso pela posição ligada e quando chega.
 * Contas e decisões em docs/specs/lote-6.md; as rotas ficam em server.ts.
 */
import { db } from "./db.js";
import { posicoes, type Posicao } from "./patrimonio.js";
import { somarMes } from "./ritmo.js";

const DIAS_DO_RITMO = 90, DIAS_MINIMOS = 28;
const MESES_MAXIMO = 1200; // além de 100 anos é o mesmo que não chegar

/** Meses de `base` até `mes`; `base` não conta, porque o saldo de hoje já tem o que entrou nele. */
const mesesAte = (base: string, mes: string) => {
  const [[a1, m1], [a2, m2]] = [base, mes].map((m) => m.split("-").map(Number));
  return (a2 - a1) * 12 + m2 - m1;
};

/** Mês em que `porMes` cobre o que falta; nulo = já chegou ou, nesse passo, não chega. */
export function chegaEm(falta: number, porMes: number, base: string) {
  const n = Math.ceil(falta / porMes);
  return falta <= 0 || porMes <= 0 || n > MESES_MAXIMO ? null : somarMes(base, n);
}

/** Quanto por mês para chegar no prazo. Prazo no próprio mês = tudo agora; nulo = já chegou ou o prazo passou. */
export const precisaPorMes = (falta: number, prazo: string, base: string) =>
  falta <= 0 || prazo < base ? null : Math.ceil(falta / Math.max(1, mesesAte(base, prazo)));

/** Vale a última linha até o mês, como no orçamento; nulo = a meta ainda não pedia nada. */
const PEDE = "(SELECT valor_centavos FROM metas_mensais WHERE meta_id = m.id AND mes <= ? ORDER BY mes DESC LIMIT 1)";

/** Soma do que as metas pedem no mês. */
export const metasDoMes = (mes: string) => (db.prepare(`SELECT COALESCE(SUM(${PEDE}), 0) AS total FROM metas m`).get(mes) as { total: number }).total;

type Ligacao = { origem: Posicao["origem"] | null; ref_id: string | null };
export interface Meta extends Ligacao {
  id: number; nome: string; tipo: "guardar" | "juntar" | "quitar"; alvo: number | null; prazo: string | null; por_mes: number | null; encerrada_em: string | null;
}
export const lerMetas = (mes: string) =>
  db.prepare(`SELECT id, nome, tipo, alvo_centavos AS alvo, prazo, ${PEDE} AS por_mes, origem, ref_id, encerrada_em FROM metas m ORDER BY id`).all(mes) as unknown as Meta[];

export const mesmaPosicao = (a: Ligacao, b: Ligacao) => a.origem !== null && a.origem === b.origem && a.ref_id === b.ref_id;

/** Quanto a posição andou de verdade (na direção da meta é positivo), por 30 dias, desde a foto mais antiga da janela. */
function andou(p: Posicao, hoje: string) {
  const f = db.prepare(
    `SELECT saldo_centavos AS saldo, julianday(?) - julianday(data) AS dias FROM saldos_diarios
     WHERE origem = ? AND ref_id = ? AND data >= date(?, ?) ORDER BY data LIMIT 1`,
  ).get(hoje, p.origem, p.ref_id, hoje, `-${DIAS_DO_RITMO} days`) as { saldo: number; dias: number } | undefined;
  return f && f.dias >= DIAS_MINIMOS ? { dias: f.dias, por_mes: Math.round(((p.valor - p.sinal * f.saldo) / f.dias) * 30) } : null;
}

/** As metas como estão em `mes`, com o progresso de hoje. Progresso nulo = nada ligado, ou a posição saiu do patrimônio. */
export function listarMetas(mes: string, hoje: string, todas = posicoes("PF")) {
  const mesAtual = hoje.slice(0, 7);
  const base = mes > mesAtual ? somarMes(mes, -1) : mesAtual; // no mês futuro, o primeiro aporte é o dele
  return lerMetas(mes).map((m) => {
    const p = todas.find((x) => mesmaPosicao(x, m));
    const falta = !p ? null : Math.max(0, m.tipo === "quitar" ? -p.valor : (m.alvo ?? 0) - p.valor);
    const passo = p ? andou(p, hoje) : null;
    return {
      ...m,
      medida: p ? { nome: p.nome, conta: p.conta, valor: p.valor } : null,
      falta,
      feito: !p || falta === null || m.alvo === null ? null : m.tipo === "quitar" ? m.alvo - falta : p.valor, // negativo: a dívida cresceu
      chega: falta === null || mes < mesAtual ? null : chegaEm(falta, m.por_mes ?? 0, base),
      precisa: falta === null || m.prazo === null ? null : precisaPorMes(falta, m.prazo, base),
      andou: passo && falta !== null ? { ...passo, chega: chegaEm(falta, passo.por_mes, mesAtual) } : null,
    };
  });
}
