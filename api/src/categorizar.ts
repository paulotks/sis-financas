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

/** Decide a categoria de um lançamento novo: regra do Paulo > categoria da Pluggy > pendente (null). */
export function sugerirCategoria(descricaoOriginal: string, categoriaPluggy: string | null | undefined, regras: Regra[]) {
  const texto = descricaoOriginal.toLowerCase();
  const regra = regras.find((r) => texto.includes(r.padrao.toLowerCase()));
  if (regra) return { categoria_id: regra.categoria_id, regra_id: regra.id, descricao: regra.descricao };
  const cp = (categoriaPluggy ?? "").toLowerCase();
  if (cp) {
    for (const [termo, nome] of MAPA_PLUGGY) {
      if (cp.includes(termo)) return { categoria_id: categoriaPorNome(nome), regra_id: null, descricao: null };
    }
  }
  return { categoria_id: null, regra_id: null, descricao: null };
}

/** Reaplica as regras aos lançamentos não categorizados à mão. Retorna quantos mudaram. */
export function reaplicarRegras(): number {
  const regras = carregarRegras();
  const alvo = db
    .prepare("SELECT id, descricao_original, categoria_pluggy, categoria_id FROM lancamentos WHERE categoria_manual = 0")
    .all() as { id: string; descricao_original: string | null; categoria_pluggy: string | null; categoria_id: number | null }[];
  const upd = db.prepare("UPDATE lancamentos SET categoria_id = ?, regra_id = ?, atualizado_em = datetime('now','localtime') WHERE id = ?");
  let n = 0;
  for (const l of alvo) {
    const s = sugerirCategoria(l.descricao_original ?? "", l.categoria_pluggy, regras);
    if (s.categoria_id !== l.categoria_id) {
      upd.run(s.categoria_id, s.regra_id, l.id);
      n++;
    }
  }
  return n;
}
