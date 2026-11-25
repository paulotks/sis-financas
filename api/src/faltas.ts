/**
 * O que o banco não mandou (regras em docs/specs/avisos.md). É aviso: nada daqui soma em gasto, projeção, nível, orçamento ou patrimônio.
 */
import { totalDaFatura } from "./adaptadores.js";
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

// ---------------- faturas (só comparam; quem lê a base é faltasDosCartoes) ----------------

const RUIDO = 100; // diferença de até R$ 1 é arredondamento
const IGUAL = 5; // mesmo valor, a menos dos centavos que se somam numa fatura cheia de parcelas
const DIAS_DE_HISTORICO = 365;
const DIAS_DO_PAGAMENTO = 16; // numa série mensal completa, todo dia está a até 16 de um vencimento
const DIAS_ATE_A_FATURA = 10; // o pagamento pode chegar antes da linha da fatura

const menosDias = (data: string, n: number) => new Date(Date.parse(data) - n * 86_400_000).toISOString().slice(0, 10);
const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);
const iguais = (a: number, b: number) => Math.abs(a - b) <= IGUAL;

export interface Fatura {
  id: string;
  vencimento: string;
  fechamento: string;
  total: number | null;
}
/** Lançamento de cartão; pagamento = tem a categoria Pagamento de fatura. */
export interface Lancado {
  data: string;
  valor: number; // com sinal
  fatura_id: string | null;
  pagamento: number;
}

/**
 * Total da fatura contra a soma dos lançamentos dela; as seguidas com a mesma diferença viram uma linha (costuma ser uma parcela que o banco
 * não manda). Positiva = falta lançamento. Só entra fatura vencida e que abriu depois do primeiro lançamento ligado a uma fatura.
 * O que não é falta: crédito que o banco abateu do pagamento da fatura anterior (está na soma, não no total) ou que ficou fora da fatura.
 */
export function faturasQueNaoFecham(banco: string | null, faturas: Fatura[], lancados: Lancado[], hoje: string) {
  const primeiro = lancados.reduce((m, l) => (l.fatura_id && l.data < m ? l.data : m), "9999"); // banco que nunca liga à fatura: nada a conferir
  const linhas: { de: string; ate: string; qtd: number; diferenca: number; i: number }[] = [];
  faturas.forEach((f, i) => {
    const abertura = faturas[i - 1]?.fechamento;
    if (!abertura || abertura < primeiro || f.total === null || f.vencimento >= hoje || f.vencimento < menosDias(hoje, DIAS_DE_HISTORICO)) return;
    const dela = lancados.filter((l) => l.fatura_id === f.id);
    const pagamentos = soma(dela.filter((l) => l.pagamento).map((l) => l.valor));
    const diferenca = totalDaFatura(banco, f.total, pagamentos) + soma(dela.filter((l) => !l.pagamento).map((l) => l.valor));
    if (Math.abs(diferenca) <= RUIDO) return;
    const explicada = lancados.some((l) =>
      l.valor > 0 && !l.pagamento && iguais(l.valor, Math.abs(diferenca)) &&
      (diferenca > 0 ? l.fatura_id === f.id : l.fatura_id !== f.id && l.data > abertura && l.data <= f.vencimento));
    if (explicada) return;
    const antes = linhas.at(-1);
    if (antes && antes.i === i - 1 && iguais(antes.diferenca, diferenca)) Object.assign(antes, { ate: f.vencimento, qtd: antes.qtd + 1, i });
    else linhas.push({ de: f.vencimento, ate: f.vencimento, qtd: 1, diferenca, i });
  });
  return linhas.map(({ i, ...l }) => l);
}

/** Pagamento recebido no cartão sem fatura que o explique: ela e as compras dela não vieram. */
export const pagamentosSemFatura = (faturas: Fatura[], lancados: Lancado[], hoje: string) =>
  lancados
    .filter((l) =>
      l.pagamento && l.valor > 0 && faturas.length > 0 && l.data > faturas[0].vencimento &&
      l.data >= menosDias(hoje, DIAS_DE_HISTORICO) && l.data <= menosDias(hoje, DIAS_ATE_A_FATURA) &&
      !faturas.some((f) => {
        const distancia = Math.abs(dias(f.vencimento, l.data));
        return distancia <= DIAS_DO_PAGAMENTO || (f.total !== null && iguais(f.total, l.valor) && distancia <= 45); // paga com atraso
      }))
    .map(({ data, valor }) => ({ data, valor }));

/** Por cartão. Lançamento ignorado conta: continua na fatura e no limite. */
export function faltasDosCartoes(hoje: string) {
  type DaConta<T> = T & { conta_id: string };
  const cartoes = db.prepare("SELECT ct.id, cx.banco FROM contas ct JOIN conexoes cx ON cx.item_id = ct.item_id WHERE ct.tipo = 'CREDIT'").all() as {
    id: string; banco: string | null;
  }[];
  const faturas = db.prepare(
    `SELECT id, conta_id, vencimento, total_centavos AS total, COALESCE(substr(json_extract(bruto, '$.billClosingDate'), 1, 10), date(vencimento, '-10 days')) AS fechamento
     FROM faturas WHERE vencimento IS NOT NULL ORDER BY vencimento`,
  ).all() as unknown as DaConta<Fatura>[];
  const lancados = db.prepare(
    `SELECT l.conta_id, l.data, l.valor_centavos AS valor, l.fatura_id, cat.nome IS 'Pagamento de fatura' AS pagamento
     FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id LEFT JOIN categorias cat ON cat.id = l.categoria_id
     WHERE ct.tipo = 'CREDIT' AND l.status IS NOT 'REMOVIDO'`,
  ).all() as unknown as DaConta<Lancado>[];
  return new Map(cartoes.map((c) => {
    const minhas = faturas.filter((f) => f.conta_id === c.id), meus = lancados.filter((l) => l.conta_id === c.id);
    return [c.id, { faturas: faturasQueNaoFecham(c.banco, minhas, meus, hoje), sem_fatura: pagamentosSemFatura(minhas, meus, hoje) }];
  }));
}
