import { db } from "./db.js";

interface Regra {
  id: number;
  padrao: string;
  categoria_id: number;
  descricao: string | null;
}

/** Categoria da Pluggy (em inglês) -> nossa categoria. Primeiro termo que aparecer vence. */
const MAPA_PLUGGY: [string, string][] = [
  ["credit card payment", "Pagamento de fatura"],
  ["same person transfer", "Transferência entre contas"],
  // específicos antes dos genéricos que eles contêm (income, rent, tickets, interest, vehicle, sports)
  ["income taxes", "Impostos e taxas"],
  ["fixed income", "Investimentos"],
  ["variable income", "Investimentos"],
  ["proceeds interests", "Investimentos"],
  ["car rental", "Transporte"],
  ["traffic tickets", "Transporte"],
  ["financing", "Juros e dívidas"],
  ["sports goods", "Compras"],
  ["salary", "Renda"],
  ["income", "Renda"],
  ["retirement", "Renda"],
  ["groceries", "Mercado"],
  ["supermarket", "Mercado"],
  ["eating out", "Alimentação fora"],
  ["restaurant", "Alimentação fora"],
  ["food delivery", "Alimentação fora"],
  ["gas station", "Combustível"],
  ["fuel", "Combustível"],
  ["taxi", "Transporte"],
  ["ride", "Transporte"],
  ["public transport", "Transporte"],
  ["parking", "Transporte"],
  ["tolls", "Transporte"],
  ["vehicle", "Transporte"],
  ["pharmacy", "Saúde"],
  ["health", "Saúde"],
  ["dentist", "Saúde"],
  ["hospital", "Saúde"],
  ["education", "Educação"],
  ["school", "Educação"],
  ["university", "Educação"],
  ["rent", "Moradia"],
  ["housing", "Moradia"],
  ["electricity", "Contas da casa"],
  ["water", "Contas da casa"],
  ["internet", "Contas da casa"],
  ["telecommunication", "Contas da casa"],
  ["mobile", "Contas da casa"],
  ["utilities", "Contas da casa"],
  ["pet", "Pet"],
  ["streaming", "Assinaturas"],
  ["digital services", "Assinaturas"],
  ["software", "Assinaturas"],
  ["entertainment", "Lazer"],
  ["leisure", "Lazer"],
  ["travel", "Lazer"],
  ["tickets", "Lazer"],
  ["personal care", "Cuidados pessoais"],
  ["gym", "Cuidados pessoais"],
  ["sports", "Cuidados pessoais"],
  ["shopping", "Compras"],
  ["clothing", "Compras"],
  ["electronics", "Compras"],
  ["taxes", "Impostos e taxas"],
  ["bank fees", "Impostos e taxas"],
  ["interest", "Juros e dívidas"],
  ["loan", "Juros e dívidas"],
  ["late payment", "Juros e dívidas"],
  ["investment", "Investimentos"],
];

/**
 * Movimento interno que vem em par (+X e -X). A Pluggy dá categorias diferentes às duas pernas (Internal, Investments,
 * Salary, Clothing…), então aqui vale a descrição: ou as duas saem do resumo, ou nenhuma.
 * "Valor adicionado" (Pix no crédito do Nubank) fica de fora de propósito: tirar só essa perna contaria o gasto em dobro.
 */
const INTERNOS: [RegExp, string][] = [
  [/^dinheiro (reservado|retirado)\b/, "Transferência entre contas"], // cofrinhos do Mercado Pago
  [/^débito automático (fatura|total)\b/, "Pagamento de fatura"], // fatura do Mercado Pago: perna da conta e perna do cartão
];

let idsPorNome: Map<string, number> | null = null;
function categoriaPorNome(nome: string) {
  if (!idsPorNome) {
    idsPorNome = new Map(
      (db.prepare("SELECT id, nome FROM categorias").all() as { id: number; nome: string }[]).map((c) => [c.nome, c.id]),
    );
  }
  return idsPorNome.get(nome) ?? null;
}
export function limparCacheCategorias() {
  idsPorNome = null;
}

export function carregarRegras(): Regra[] {
  return db.prepare("SELECT id, padrao, categoria_id, descricao FROM regras ORDER BY prioridade DESC, length(padrao) DESC").all() as unknown as Regra[];
}

/** Decide a categoria de um lançamento novo: regra do Paulo > movimento interno > categoria da Pluggy > pendente (null). */
export function sugerirCategoria(descricaoOriginal: string, categoriaPluggy: string | null | undefined, regras: Regra[]) {
  const texto = descricaoOriginal.toLowerCase();
  const regra = regras.find((r) => texto.includes(r.padrao.toLowerCase()));
  if (regra) return { categoria_id: regra.categoria_id, regra_id: regra.id, descricao: regra.descricao };
  const interno = INTERNOS.find(([re]) => re.test(texto));
  if (interno) return { categoria_id: categoriaPorNome(interno[1]), regra_id: null, descricao: null };
  const cp = (categoriaPluggy ?? "").toLowerCase();
  if (cp) {
    for (const [termo, nome] of MAPA_PLUGGY) {
      if (cp.includes(termo)) return { categoria_id: categoriaPorNome(nome), regra_id: null, descricao: null };
    }
  }
  return { categoria_id: null, regra_id: null, descricao: null };
}

/**
 * Quantos lançamentos uma regra com esse texto pegaria (fora os editados à mão): mesma comparação de sugerirCategoria.
 * Nos exemplos, o que já tem categoria vem primeiro: é o que a regra trocaria.
 */
export function contarParecidos(padrao: string) {
  const texto = padrao.toLowerCase();
  const parecidos = (
    db.prepare(
      `SELECT l.descricao_original, l.categoria_id, c.nome AS categoria
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id WHERE l.categoria_manual = 0`,
    ).all() as { descricao_original: string | null; categoria_id: number | null; categoria: string | null }[]
  ).filter((l) => (l.descricao_original ?? "").toLowerCase().includes(texto));
  const grupos = new Map<string, { descricao: string | null; categoria: string | null; qtd: number }>();
  for (const l of parecidos) {
    const chave = `${l.categoria_id}|${l.descricao_original}`;
    const g = grupos.get(chave) ?? { descricao: l.descricao_original, categoria: l.categoria, qtd: 0 };
    g.qtd++;
    grupos.set(chave, g);
  }
  const exemplos = [...grupos.values()].sort((a, b) => Number(a.categoria === null) - Number(b.categoria === null) || b.qtd - a.qtd);
  return {
    total: parecidos.length,
    pendentes: parecidos.filter((l) => l.categoria_id === null).length,
    descricoes: exemplos.length,
    exemplos: exemplos.slice(0, 20),
  };
}

/** Reaplica as regras aos lançamentos não categorizados à mão. Retorna quantos mudaram. */
export function reaplicarRegras(): number {
  const regras = carregarRegras();
  const alvo = db
    .prepare("SELECT id, descricao_original, categoria_pluggy, categoria_id, regra_id FROM lancamentos WHERE categoria_manual = 0")
    .all() as {
    id: string;
    descricao_original: string | null;
    categoria_pluggy: string | null;
    categoria_id: number | null;
    regra_id: number | null;
  }[];
  const upd = db.prepare("UPDATE lancamentos SET categoria_id = ?, regra_id = ?, atualizado_em = datetime('now','localtime') WHERE id = ?");
  let n = 0;
  for (const l of alvo) {
    const s = sugerirCategoria(l.descricao_original ?? "", l.categoria_pluggy, regras);
    if (s.categoria_id !== l.categoria_id || s.regra_id !== l.regra_id) {
      upd.run(s.categoria_id, s.regra_id, l.id);
      if (s.categoria_id !== l.categoria_id) n++;
    }
  }
  return n;
}
