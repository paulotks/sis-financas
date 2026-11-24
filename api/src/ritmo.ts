/** Ritmo do mês: a renda aguenta o gasto? Funções puras, em centavos; quem lê a base é server.ts. */

/** Antes deste dia o mês tem pouco gasto para projetar o resto. */
const DIA_MINIMO = 5;
export const MESES_MEDIANA = 3;
export const MESES_ACUMULADO = 6;

export interface TotalMes {
  mes: string; // AAAA-MM
  entradas: number; // tudo o que entrou (igual ao Resumo)
  renda: number; // só o que tem categoria de renda
  gasto: number; // igual às saídas do Resumo
}

export type Nivel = "verde" | "amarelo" | "vermelho";

export function mediana(ns: number[]): number | null {
  if (!ns.length) return null;
  const o = [...ns].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return Math.round(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2);
}

export function somarMes(mes: string, delta: number) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function diasDoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Os até `n` meses fechados antes de `mes`, do mais antigo ao mais novo, sem passar de `inicio`. */
export const fechadosAntes = (totais: TotalMes[], mes: string, n: number, inicio: string | null) =>
  inicio === null ? [] : totais.filter((t) => t.mes < mes && t.mes >= inicio && t.mes >= somarMes(mes, -n));

/**
 * Primeiro mês com renda de verdade: pelo menos metade da mediana dos 3 últimos fechados. Antes dele a renda está incompleta (conta ainda
 * não conectada; um rendimento de centavos também é renda) e o prejuízo seria falso.
 */
export function inicioDaAnalise(totais: TotalMes[], mesAtual: string): string | null {
  const ultimos = totais.filter((t) => t.mes < mesAtual && t.mes >= somarMes(mesAtual, -MESES_MEDIANA)).map((t) => t.renda);
  // sem mês fechado com renda (instalação nova), vale a do mês atual
  const normal = mediana(ultimos) || (totais.find((t) => t.mes === mesAtual)?.renda ?? 0);
  if (normal <= 0) return null;
  return totais.filter((t) => t.mes <= mesAtual).sort((a, b) => (a.mes < b.mes ? -1 : 1)).find((t) => t.renda >= normal / 2)?.mes ?? null;
}

/**
 * Faixa do gasto no fim do mês, por dois métodos: a regra de três exagera quando caem as contas fixas, e o histórico esconde mês fora do
 * padrão. A média dos dois errou menos que cada um (spec do lote 3). Nunca menor que o já lançado (parcelas com data futura).
 */
export function projetar(p: { gastoAteHoje: number; dia: number; diasNoMes: number; depoisDoDia: number[]; jaLancado: number }) {
  if (p.dia < DIA_MINIMO) return null;
  const regraDeTres = (p.gastoAteHoje / p.dia) * p.diasNoMes;
  const tipico = p.gastoAteHoje + (mediana(p.depoisDoDia) ?? regraDeTres - p.gastoAteHoje);
  const [min, max] = [regraDeTres, tipico].map((v) => Math.max(Math.round(v), p.jaLancado)).sort((a, b) => a - b);
  return { min, max, media: Math.round((min + max) / 2) };
}

/** Sem renda e sem orçado não há contra o que comparar. */
export function nivelDo(gasto: number, orcado: number, renda: number | null): Nivel | null {
  if (renda !== null && gasto > renda) return "vermelho";
  if (orcado > 0 && gasto > orcado) return "amarelo";
  return renda !== null || orcado > 0 ? "verde" : null;
}
