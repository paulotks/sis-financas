/**
 * O que é peculiar de um banco fica aqui, uma entrada por banco (docs/specs/adaptadores.md). Só entra peculiaridade com caso real; banco sem
 * entrada usa o padrão, que não muda nada. Adaptador traduz o que o banco mandou, nunca inventa o que faltou.
 * Não importa db.ts: recebe pronto o que precisa da base.
 */
import type { PConta } from "./pluggy.js";

/** O que decide a categoria de um lançamento. */
export interface Movimento {
  descricao_original: string | null;
  categoria_pluggy?: string | null;
  valor_centavos: number;
  conta_id: string;
}
export interface Linha extends Movimento {
  id: string;
  categoria_id: number | null;
  regra_id: number | null;
  categoria_manual: number;
  ignorado: number;
  status: string | null;
  parcela: number | null;
  total_parcelas: number | null;
  conta_tipo: string | null;
  item_id: string;
  banco: string | null;
  pessoa: string;
  oculta: number;
  momento: string; // com hora; nas parcelas é a data da compra, igual em todas
}
interface Contexto {
  /** A categoria que a linha teria sem as trocas. */
  categoriaDe: (l: Linha) => number | null;
  /** Categorias que não contam no resumo (grupo transferencia). */
  foraDoResumo: Set<number>;
  categoriaPorNome: (nome: string) => number | null;
}
interface Adaptador {
  nome: string;
  /**
   * Movimento interno que vem em par (+X e -X). A Pluggy dá categorias diferentes às duas pernas (Internal, Investments,
   * Salary, Clothing…), então aqui vale a descrição (em minúsculas): ou as duas saem do resumo, ou nenhuma.
   */
  internos?: [RegExp, string][];
  /** O que depende de várias linhas juntas: devolve a categoria das que mudam. Vale acima das regras do usuário. */
  trocas?: (linhas: Linha[], contexto: Contexto) => Map<string, number | null>;
  /** Total da fatura sem o que ela carrega da anterior. `pagamentos` = soma, com sinal, dos lançamentos de Pagamento de fatura dela. */
  totalDaFatura?: (total: number, pagamentos: number) => number;
}

/** Chave: código COMPE. */
const ADAPTADORES: Record<string, Adaptador> = {
  // "total da fatura anterior" (−) e o pagamento dele (+) vêm como lançamentos da própria fatura: o que não foi pago está dentro do total
  "104": { nome: "Caixa", totalDaFatura: (total, pagamentos) => total + pagamentos },
  "260": { nome: "Nubank", trocas: pixNoCredito },
  "323": {
    nome: "Mercado Pago",
    internos: [
      [/^dinheiro (reservado|retirado)\b/, "Transferência entre contas"], // cofrinhos
      [/^débito automático (fatura|total)\b/, "Pagamento de fatura"], // perna da conta e perna do cartão
    ],
  },
};

/**
 * Código COMPE do banco de uma conexão, do começo de `transferNumber` ("260/0001/12345-6"). Sem as três partes, o começo é a agência.
 * Null = não dá para saber, ou há mais de um (grupos financeiros podem juntar dois na mesma conexão): quem chama mantém o que já sabia.
 */
export function codigoDoBanco(contas: PConta[]) {
  const codigos = new Set(contas.flatMap((c) => c.bankData?.transferNumber?.match(/^(\d{3})\/[^/]*\/./)?.[1] ?? []));
  return codigos.size === 1 ? [...codigos][0] : null;
}

/**
 * Banco nulo = ainda não se sabe (antes da primeira sincronização, ou conexão só de cartão): vale tudo, como era antes de existir o código.
 * Sem isto, as regras reaplicadas na subida desfariam os movimentos internos. Peça nova não deve valer para nulo.
 */
const valeNo = (banco: string | null, codigo: string) => banco === null || banco === codigo;

export const internosDe = (banco: string | null) =>
  Object.entries(ADAPTADORES).flatMap(([codigo, a]) => (valeNo(banco, codigo) ? (a.internos ?? []) : []));

export const trocasDe = (linhas: Linha[], contexto: Contexto) =>
  new Map(Object.entries(ADAPTADORES).flatMap(([codigo, a]) => [...(a.trocas?.(linhas.filter((l) => valeNo(l.banco, codigo)), contexto) ?? [])]));

/** Banco sem a peça, ou que ainda não se sabe: o total como veio. */
export const totalDaFatura = (banco: string | null, total: number, pagamentos: number) =>
  ADAPTADORES[banco ?? ""]?.totalDaFatura?.(total, pagamentos) ?? total;

/**
 * Pix no crédito do Nubank: (1) +X entra na conta, (2) o Pix de −X sai dela e (3) o cartão cobra X mais a tarifa. O gasto é a (3), então
 * (1) e (2) saem do resumo, sempre juntas, e a (3) sem categoria própria herda a que a (2) teria. Vale acima das regras.
 * Devolve só o que muda. Não mexe se falta a (3) ou se alguma perna já está fora do resumo: assim nunca muda o resultado do mês.
 * ponytail: as pernas são casadas pelo horário (1 s entre elas nos dados reais); se o banco parar de mandar a hora, vale a 1ª do mesmo dia.
 */
function pixNoCredito(linhas: Linha[], { categoriaDe, foraDoResumo, categoriaPorNome }: Contexto) {
  const trocas = new Map<string, number | null>();
  const fora = (l: Linha) => l.ignorado === 1 || foraDoResumo.has(categoriaDe(l) ?? 0);
  const vivas = linhas.filter((l) => l.status !== "REMOVIDO");
  const usadas = new Set<string>();
  const maisPerto = (a: Linha, minutos: number, serve: (l: Linha) => boolean) => {
    const distancia = (l: Linha) => Math.abs(Date.parse(l.momento) - Date.parse(a.momento));
    const achada = vivas
      .filter((l) => !usadas.has(l.id) && serve(l) && distancia(l) <= minutos * 60_000)
      .sort((x, y) => distancia(x) - distancia(y))[0];
    if (achada) usadas.add(achada.id);
    return achada;
  };
  const entradas = vivas.filter((l) => l.conta_tipo === "BANK" && l.valor_centavos > 0 && /^valor adicionado na conta por cartão de crédito/i.test(l.descricao_original ?? ""));
  for (const entrou of entradas.sort((a, b) => (a.momento < b.momento ? -1 : 1))) {
    const saiu = maisPerto(entrou, 1, (l) => l.conta_id === entrou.conta_id && l.valor_centavos === -entrou.valor_centavos);
    const cobranca = maisPerto(entrou, 15, (l) => {
      const tarifa = (-l.valor_centavos * (l.total_parcelas || 1)) / entrou.valor_centavos; // 1 = sem tarifa
      return l.conta_tipo === "CREDIT" && l.item_id === entrou.item_id && l.pessoa === entrou.pessoa && !l.oculta && (l.parcela ?? 1) === 1 && tarifa >= 1 && tarifa <= 1.5;
    });
    if (!saiu || !cobranca || entrou.categoria_manual || saiu.categoria_manual || entrou.ignorado || fora(saiu) || fora(cobranca)) continue;
    const transferencia = categoriaPorNome("Transferência entre contas");
    trocas.set(entrou.id, transferencia).set(saiu.id, transferencia);
    const parcelas = vivas.filter((l) =>
      l === cobranca || (cobranca.total_parcelas! > 1 && l.conta_id === cobranca.conta_id && l.momento === cobranca.momento && l.total_parcelas === cobranca.total_parcelas));
    for (const l of parcelas) if (!l.categoria_manual && categoriaDe(l) === null) trocas.set(l.id, categoriaDe(saiu));
  }
  return trocas;
}
