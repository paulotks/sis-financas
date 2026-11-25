import { internosDe, trocasDe, type Linha, type Movimento } from "./adaptadores.js";
import { db } from "./db.js";

/** Onde a regra vale. Sentido nulo = entrada e saída; conta nula = todas. */
interface Alcance {
  padrao: string;
  sentido: "saida" | "entrada" | null;
  conta_id: string | null;
}
interface Regra extends Alcance {
  id: number;
  prioridade: number;
  categoria_id: number;
  descricao: string | null;
}

export const PRIORIDADE_PADRAO = 50; // a da coluna, em db.ts

/** Categoria da Pluggy (em inglês) -> nossa categoria. Primeiro termo que aparecer vence. */
const MAPA_PLUGGY: [string, string][] = [
  ["credit card payment", "Pagamento de fatura"],
  ["same person transfer", "Transferência entre contas"],
  // específicos antes dos genéricos que eles contêm (income, rent, tickets, interest, vehicle, sports)
  ["income taxes", "Impostos e taxas"],
  ["fixed income", "Investimentos"],
  ["variable income", "Investimentos"],
  ["proceeds interests", "Renda"], // rendimento diário da conta
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
  ["food and drinks", "Alimentação fora"],
  ["gas station", "Combustível"],
  ["fuel", "Combustível"],
  ["taxi", "Transporte"],
  ["ride", "Transporte"],
  ["public transport", "Transporte"],
  ["parking", "Transporte"],
  ["tolls", "Transporte"],
  ["vehicle", "Transporte"],
  ["automotive", "Transporte"],
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
  ["accomodation", "Lazer"], // é assim que a Pluggy manda; a documentação escreve com dois "m"
  ["accommodation", "Lazer"],
  ["cinema", "Lazer"],
  ["lottery", "Lazer"],
  ["gambling", "Lazer"],
  ["personal care", "Cuidados pessoais"],
  ["gym", "Cuidados pessoais"],
  ["sports", "Cuidados pessoais"],
  ["shopping", "Compras"],
  ["clothing", "Compras"],
  ["electronics", "Compras"],
  ["houseware", "Compras"],
  ["bookstore", "Compras"],
  ["office supplies", "Compras"],
  ["kids and toys", "Compras"],
  ["taxes", "Impostos e taxas"],
  ["tax on financial operations", "Impostos e taxas"], // IOF
  ["bank fees", "Impostos e taxas"],
  ["account fees", "Impostos e taxas"],
  ["interest", "Juros e dívidas"],
  ["loan", "Juros e dívidas"],
  ["late payment", "Juros e dívidas"],
  ["investment", "Investimentos"],
];

/** Categorias que o código acha pelo nome: apagar ou renomear uma faria o mapa devolver "sem categoria"; mudar o grupo, os totais. */
export const NOMES_FIXOS = new Set([...MAPA_PLUGGY, ...internosDe(null)].map(([, nome]) => nome));

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

/** Texto mais longo antes de sentido/conta: senão uma regra nova e curta, só de saída, passaria na frente de toda regra antiga específica. */
const precedencia = (a: Regra, b: Regra) =>
  b.prioridade - a.prioridade ||
  b.padrao.length - a.padrao.length ||
  Number(b.conta_id !== null) - Number(a.conta_id !== null) ||
  Number(b.sentido !== null) - Number(a.sentido !== null) ||
  a.id - b.id;

export const carregarRegras = () =>
  (db.prepare("SELECT id, padrao, sentido, conta_id, categoria_id, descricao, prioridade FROM regras").all() as unknown as Regra[]).sort(precedencia);

/** A regra que já existe com este texto (maiúsculas não contam, com ou sem acento), sentido e conta: repetir corrige essa, não cria outra. */
export const regraIgual = (regras: Regra[], a: Alcance) =>
  regras.find((r) => r.padrao.toLowerCase() === a.padrao.toLowerCase() && r.sentido === a.sentido && r.conta_id === a.conta_id);

/** Única comparação de regra com lançamento. */
const alcanca = (r: Alcance, l: Movimento) =>
  (r.sentido === null || r.sentido === (l.valor_centavos < 0 ? "saida" : "entrada")) &&
  (r.conta_id === null || r.conta_id === l.conta_id) &&
  (l.descricao_original ?? "").toLowerCase().includes(r.padrao.toLowerCase());

/** Decide a categoria de um lançamento novo: regra do Paulo > movimento interno do banco > categoria da Pluggy > pendente (null). */
export function sugerirCategoria(l: Movimento, regras: Regra[], banco: string | null) {
  const texto = (l.descricao_original ?? "").toLowerCase();
  const regra = regras.find((r) => alcanca(r, l));
  if (regra) return { categoria_id: regra.categoria_id, regra_id: regra.id, descricao: regra.descricao };
  const interno = internosDe(banco).find(([re]) => re.test(texto));
  if (interno) return { categoria_id: categoriaPorNome(interno[1]), regra_id: null, descricao: null };
  const cp = (l.categoria_pluggy ?? "").toLowerCase();
  if (cp) {
    for (const [termo, nome] of MAPA_PLUGGY) {
      if (cp.includes(termo)) return { categoria_id: categoriaPorNome(nome), regra_id: null, descricao: null };
    }
  }
  return { categoria_id: null, regra_id: null, descricao: null };
}

/** A categoria que cada lançamento não editado à mão teria com estas regras. Não grava: a prévia e a gravação usam este mesmo cálculo. */
function calcular(regras: Regra[]) {
  const linhas = db
    .prepare(
      `SELECT l.id, l.descricao_original, l.categoria_pluggy, l.valor_centavos, l.conta_id, l.categoria_id, l.regra_id, l.categoria_manual,
         l.ignorado, l.status, l.parcela, l.total_parcelas, ct.tipo AS conta_tipo, ct.item_id, cx.banco, ct.pessoa, ct.oculta,
         COALESCE(json_extract(l.bruto, '$.creditCardMetadata.purchaseDate'), json_extract(l.bruto, '$.date'), l.data) AS momento
       FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id JOIN conexoes cx ON cx.item_id = ct.item_id`,
    )
    .all() as unknown as Linha[];
  const alvo = linhas.filter((l) => !l.categoria_manual);
  const sugestoes = new Map(alvo.map((l) => [l.id, sugerirCategoria(l, regras, l.banco)]));
  // antes de comparar com o gravado, e não num passo depois: senão as pernas iriam e voltariam a cada vez, inflando a contagem
  const contexto = {
    categoriaDe: (l: Linha) => (l.categoria_manual ? l.categoria_id : sugestoes.get(l.id)!.categoria_id),
    foraDoResumo: new Set((db.prepare("SELECT id FROM categorias WHERE grupo = 'transferencia'").all() as { id: number }[]).map((c) => c.id)),
    categoriaPorNome,
  };
  const trocas = trocasDe(linhas, contexto);
  return alvo.map((l) => ({ l, ...(trocas.has(l.id) ? { categoria_id: trocas.get(l.id)!, regra_id: null } : sugestoes.get(l.id)!) }));
}

/**
 * O que gravar esta regra mudaria. `total` é o mesmo número que a gravação devolve: desconta o que outra regra ganha e inclui o que o Pix no
 * crédito puxa junto. Depende da categoria (uma de transferência desfaz o Pix no crédito); sem ela, supõe uma de gasto que ninguém tem.
 * `parecidos` = os que têm o texto, mudem ou não. Nos exemplos, o que já tem categoria vem primeiro, e `vai_para` é o que não vai para a da regra.
 */
export function previaDaRegra(alcance: Alcance, categoria_id = -1) {
  const regras = carregarRegras();
  const igual = regraIgual(regras, alcance);
  const nova: Regra = { ...(igual ?? { ...alcance, id: Infinity, prioridade: PRIORIDADE_PADRAO, descricao: null }), categoria_id };
  const linhas = calcular([...regras.filter((r) => r !== igual), nova].sort(precedencia));
  const mudam = linhas.filter((m) => m.categoria_id !== m.l.categoria_id);
  const nomes = new Map((db.prepare("SELECT id, nome FROM categorias").all() as { id: number; nome: string }[]).map((c) => [c.id, c.nome]));
  const nome = (id: number | null) => nomes.get(id ?? 0) ?? null;
  const grupos = new Map<string, { descricao: string | null; categoria: string | null; vai_para?: string | null; qtd: number }>();
  for (const { l, categoria_id: vai } of mudam) {
    const chave = `${l.categoria_id}|${vai}|${l.descricao_original}`;
    const g = grupos.get(chave) ?? { descricao: l.descricao_original, categoria: nome(l.categoria_id), ...(vai !== categoria_id && { vai_para: nome(vai) }), qtd: 0 };
    g.qtd++;
    grupos.set(chave, g);
  }
  const exemplos = [...grupos.values()].sort((a, b) => Number(a.categoria === null) - Number(b.categoria === null) || b.qtd - a.qtd);
  return {
    parecidos: linhas.filter(({ l }) => alcanca(alcance, l)).length,
    total: mudam.length,
    pendentes: mudam.filter(({ l }) => l.categoria_id === null).length,
    descricoes: exemplos.length,
    exemplos: exemplos.slice(0, 20),
  };
}

/** Reaplica as regras aos lançamentos não categorizados à mão. Retorna os ids dos que mudaram de categoria. */
export function reaplicarRegras(): string[] {
  const upd = db.prepare("UPDATE lancamentos SET categoria_id = ?, regra_id = ?, atualizado_em = datetime('now','localtime') WHERE id = ?");
  const mudaram: string[] = [];
  for (const { l, categoria_id, regra_id } of calcular(carregarRegras())) {
    if (categoria_id === l.categoria_id && regra_id === l.regra_id) continue;
    upd.run(categoria_id, regra_id, l.id);
    if (categoria_id !== l.categoria_id) mudaram.push(l.id);
  }
  return mudaram;
}
