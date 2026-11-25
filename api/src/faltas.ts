/**
 * O que o banco não mandou (regras em docs/specs/avisos.md). É aviso: nada daqui soma em gasto, projeção, nível, orçamento ou patrimônio.
 */
import { db } from "./db.js";
import { somarMes } from "./ritmo.js";

/** Compra sem parcela há mais tempo que isto: o banco parou de mandar, ou ela foi antecipada ou cancelada. */
const MESES_PARADA = 3;

const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export interface Parcela {
  id: string;
  conta_id: string;
  data: string;
  compra: string; // dia da compra
  valor: number; // centavos, positivo
  parcela: number;
  total: number;
}
export interface Prevista {
  conta_id: string;
  ultima: string; // id da última parcela vista
  mes: string;
  valor: number;
}

/**
 * Há cartão que só manda a parcela quando ela cai. Projeta as que faltam, depois do mês atual, a partir da última vista; se a compra já tem
 * parcela com data futura, o banco manda as futuras e não há o que prever.
 * Mesma compra: o dia (a hora só vem certa na 1ª parcela) e o valor com folga (a 1ª leva o resto da divisão). A descrição não serve: muda
 * quando o lançamento é confirmado.
 * ponytail: duas compras iguais no mesmo dia viram uma (prevê a menos), e a estornada segue prevista até a última; cruzar com o crédito se
 * aparecer caso.
 */
export function parcelasPrevistas(parcelas: Parcela[], hoje: string): Prevista[] {
  const mesAtual = hoje.slice(0, 7);
  const compras: Parcela[][] = [];
  for (const p of parcelas) {
    const mesma = compras.find(([c]) =>
      c.conta_id === p.conta_id && c.total === p.total && Math.abs(c.valor - p.valor) <= p.total && Math.abs(dias(c.compra, p.compra)) <= 1);
    if (mesma) mesma.push(p);
    else compras.push([p]);
  }
  return compras.flatMap((compra) => {
    const u = compra.reduce((a, p) => (p.parcela > a.parcela ? p : a));
    // há banco em que a 2ª parcela vem com a data da compra: o mês não pode ficar para trás
    const base = [u.data.slice(0, 7), somarMes(u.compra.slice(0, 7), u.parcela - 1)].sort()[1];
    if (compra.some((p) => p.data > hoje) || base < somarMes(mesAtual, -MESES_PARADA)) return [];
    return Array.from({ length: u.total - u.parcela }, (_, i) => ({ conta_id: u.conta_id, ultima: u.id, mes: somarMes(base, i + 1), valor: u.valor }))
      .filter((p) => p.mes > mesAtual);
  });
}

/** De todos os cartões. Quem usa escolhe o que conta: o limite conta até o lançamento ignorado. */
export const previstas = (hoje: string) =>
  parcelasPrevistas(
    db.prepare(
      `SELECT l.id, l.conta_id, l.data, -l.valor_centavos AS valor, l.parcela, l.total_parcelas AS total,
         date(json_extract(l.bruto, '$.creditCardMetadata.purchaseDate'), '-3 hours') AS compra
       FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id
       WHERE ct.tipo = 'CREDIT' AND l.valor_centavos < 0 AND l.total_parcelas > 1 AND l.parcela >= 1 AND l.status IS NOT 'REMOVIDO'
         AND l.data >= date(?, '-6 months') AND compra IS NOT NULL
       ORDER BY l.data`,
    ).all(hoje) as unknown as Parcela[],
    hoje,
  );
