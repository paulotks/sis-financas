import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { copiaDoDia, db, migrar, transacao } from "./db.js";
import { env } from "./env.js";
import { patrimonio, registrarSaldos } from "./patrimonio.js";
import { ErroPluggy, pluggy } from "./pluggy.js";
import { chaveDe, detectarRecorrentes, type Decisao, type Gasto, type Recorrente } from "./recorrentes.js";
import { diasDoMes, fechadosAntes, inicioDaAnalise, mediana, MESES_ACUMULADO, MESES_MEDIANA, nivelDo, projetar, somarMes, type TotalMes } from "./ritmo.js";
import { salvarConexao, sincronizar } from "./sync.js";
import { contarParecidos, limparCacheCategorias, NOMES_FIXOS, reaplicarRegras } from "./categorizar.js";

migrar();
copiaDoDia();
setInterval(copiaDoDia, 3_600_000).unref();
transacao(reaplicarRegras); // mudança no mapa de categorias passa a valer também para o que já está na base

export const app = Fastify({ logger: { level: "info", transport: undefined } });

// Só aceita escrita vinda do próprio PC (front em dev na 5173 ou servido pela própria API).
// ".localhost" é reservado: ninguém registra esse domínio, então não abre brecha para DNS rebinding.
const NOMES = ["localhost", "127.0.0.1", "meu-financeiro.localhost"];
const ORIGENS = new Set(
  [5173, env.porta].flatMap((p) => NOMES.map((n) => new URL(`http://${n}:${p}`).origin)), // .origin tira o ":80", como o navegador
);
const HOSTS = new Set([...ORIGENS].map((o) => new URL(o).host));
app.addHook("onRequest", async (req, reply) => {
  // Host de fora = DNS rebinding: um site qualquer apontando o próprio domínio para 127.0.0.1 leria os dados via GET
  if (!HOSTS.has(req.headers.host ?? "")) return reply.code(403).send({ erro: "host não permitido" });
  const origem = req.headers.origin;
  if (req.method !== "GET" && req.method !== "HEAD" && origem && !ORIGENS.has(origem)) {
    return reply.code(403).send({ erro: "origem não permitida" });
  }
});

app.setErrorHandler((err: Error, _req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ erro: "dados inválidos", detalhes: err.issues });
  if (err instanceof ErroPluggy) return reply.code(502).send({ erro: err.message });
  const errcode = (err as { errcode?: number }).errcode; // node:sqlite
  if (errcode === 2067) return reply.code(409).send({ erro: "já existe um registro com esse nome ou texto" }); // UNIQUE
  if (errcode === 787) return reply.code(400).send({ erro: "categoria ou conta não encontrada" }); // FOREIGN KEY
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  return reply.code(status).send({ erro: err.message });
});

const uuid = z.string().uuid();
const pessoaPFPJ = z.enum(["PF", "PJ"]);
const mesRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const fimDoMes = (mes: string) => `${mes}-${diasDoMes(mes)}`;
const diaDeHoje = () => (db.prepare("SELECT date('now','localtime') AS hoje").get() as { hoje: string }).hoje;

function ouNaoEncontrado<T>(registro: T | undefined, oQue: string): T {
  if (registro === undefined) throw Object.assign(new Error(`${oQue}: não encontrado(a)`), { statusCode: 404 });
  return registro;
}

// ---------------- Pluggy / conexões ----------------

app.post("/api/pluggy/connect-token", async (req) => {
  const { itemId } = z.object({ itemId: uuid.optional() }).parse(req.body ?? {});
  return { accessToken: await pluggy.connectToken("paulo", itemId) };
});

app.get("/api/conexoes", async () =>
  db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM contas WHERE item_id = c.item_id) AS contas,
       (SELECT group_concat(COALESCE(apelido, nome), ' · ') FROM contas WHERE item_id = c.item_id) AS nomes_contas
     FROM conexoes c ORDER BY c.criado_em`,
  ).all(),
);

/** Recebe o itemId do onSuccess do widget, confirma na Pluggy, grava e já sincroniza. */
app.post("/api/conexoes", async (req) => {
  const { itemId } = z.object({ itemId: uuid }).parse(req.body);
  salvarConexao(await pluggy.item(itemId));
  const [resultado] = await sincronizar(itemId);
  return resultado;
});

app.post("/api/sync", async (req) => {
  const { itemId, desde } = z
    .object({ itemId: uuid.optional(), desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .parse(req.body ?? {});
  return { resultados: await sincronizar(itemId, desde) };
});

app.get("/api/sync/historico", async () =>
  db.prepare("SELECT * FROM sincronizacoes ORDER BY id DESC LIMIT 30").all(),
);

// ---------------- contas ----------------

app.get("/api/contas", async () => ({
  contas: db.prepare(
    `SELECT ct.*, cx.conector, cx.imagem_url, cx.ultimo_sync
     FROM contas ct JOIN conexoes cx ON cx.item_id = ct.item_id
     ORDER BY ct.pessoa, ct.tipo, COALESCE(ct.apelido, ct.nome)`,
  ).all(),
  investimentos: db.prepare(
    `SELECT i.*, cx.conector FROM investimentos i JOIN conexoes cx ON cx.item_id = i.item_id ORDER BY i.nome`,
  ).all(),
}));

app.patch("/api/contas/:id", async (req) => {
  const { id } = z.object({ id: uuid }).parse(req.params);
  const d = z
    .object({ apelido: z.string().max(60).nullable().optional(), pessoa: z.enum(["PF", "PJ"]).optional(), oculta: z.boolean().optional() })
    .parse(req.body);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (d.apelido !== undefined) (sets.push("apelido = ?"), vals.push(d.apelido?.trim() || null));
  if (d.pessoa) (sets.push("pessoa = ?"), vals.push(d.pessoa));
  if (d.oculta !== undefined) (sets.push("oculta = ?"), vals.push(d.oculta ? 1 : 0));
  if (!sets.length) return { ok: true };
  db.prepare(`UPDATE contas SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return ouNaoEncontrado(db.prepare("SELECT * FROM contas WHERE id = ?").get(id), "conta");
});

// ---------------- lançamentos ----------------

const SELECT_LANC = `
  SELECT l.id, l.conta_id, l.data, l.descricao, l.descricao_original, l.valor_centavos, l.tipo, l.status,
         l.categoria_id, l.categoria_manual, l.categoria_pluggy, l.comerciante, l.parcela, l.total_parcelas,
         l.notas, l.tags, l.ignorado,
         COALESCE(ct.apelido, ct.nome) AS conta, ct.tipo AS conta_tipo, ct.pessoa,
         cat.nome AS categoria, cat.cor AS categoria_cor, cat.grupo AS categoria_grupo
  FROM lancamentos l
  JOIN contas ct ON ct.id = l.conta_id
  LEFT JOIN categorias cat ON cat.id = l.categoria_id`;

const formatarLanc = (r: Record<string, unknown>) => ({
  ...r,
  tags: JSON.parse(String(r.tags ?? "[]")),
  ignorado: !!r.ignorado,
  categoria_manual: !!r.categoria_manual,
});

app.get("/api/lancamentos", async (req) => {
  const q = z
    .object({
      mes: z.string().regex(mesRe).optional(),
      conta: z.union([uuid, z.enum(["contas", "cartoes"])]).optional(), // uma conta, só contas ou só cartões
      categoria: z.coerce.number().int().optional(),
      busca: z.string().max(100).optional(),
      pendentes: z.enum(["1", "0"]).optional(),
      estornos: z.enum(["1", "0"]).optional(),
      pessoa: z.enum(["PF", "PJ"]).optional(),
    })
    .parse(req.query);
  const onde: string[] = ["ct.oculta = 0"];
  const vals: (string | number)[] = [];
  if (q.mes) (onde.push("l.data BETWEEN ? AND ?"), vals.push(`${q.mes}-01`, fimDoMes(q.mes)));
  if (q.conta === "cartoes") onde.push("ct.tipo IS 'CREDIT'");
  else if (q.conta === "contas") onde.push("ct.tipo IS NOT 'CREDIT'"); // o que não é cartão é conta, como na tela
  else if (q.conta) (onde.push("l.conta_id = ?"), vals.push(q.conta));
  if (q.categoria) (onde.push("l.categoria_id = ?"), vals.push(q.categoria));
  if (q.pessoa) (onde.push("ct.pessoa = ?"), vals.push(q.pessoa));
  if (q.pendentes === "1") onde.push("l.categoria_id IS NULL AND l.ignorado = 0 AND l.status IS NOT 'REMOVIDO'");
  if (q.estornos === "1")
    onde.push(
      `ct.tipo = 'CREDIT' AND l.valor_centavos > 0 AND l.ignorado = 0 AND l.status IS NOT 'REMOVIDO'
       AND COALESCE(l.categoria_id, 0) NOT IN (SELECT id FROM categorias WHERE grupo = 'transferencia')`,
    );
  if (q.busca) {
    onde.push("(l.descricao LIKE ? OR l.descricao_original LIKE ? OR l.notas LIKE ?)");
    const b = `%${q.busca}%`;
    vals.push(b, b, b);
  }
  const itens = (db.prepare(`${SELECT_LANC} WHERE ${onde.join(" AND ")} ORDER BY l.data DESC, l.rowid DESC LIMIT 2000`).all(...vals) as Record<string, unknown>[]).map(formatarLanc);
  // total de verdade: a lista para em 2000 e a tela precisa saber que foi cortada
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id WHERE ${onde.join(" AND ")}`).get(...vals) as { total: number };
  return { itens, total };
});

app.patch("/api/lancamentos/:id", async (req) => {
  const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
  const d = z
    .object({
      descricao: z.string().trim().min(1).max(200).optional(),
      categoria_id: z.number().int().nullable().optional(),
      notas: z.string().max(1000).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      ignorado: z.boolean().optional(),
    })
    .parse(req.body);

  const sets: string[] = ["atualizado_em = datetime('now','localtime')"];
  const vals: (string | number | null)[] = [];
  if (d.descricao !== undefined) (sets.push("descricao = ?"), vals.push(d.descricao));
  if (d.categoria_id !== undefined) {
    sets.push("categoria_id = ?", "categoria_manual = ?", "regra_id = NULL");
    vals.push(d.categoria_id, d.categoria_id === null ? 0 : 1);
  }
  if (d.notas !== undefined) (sets.push("notas = ?"), vals.push(d.notas));
  if (d.tags !== undefined) (sets.push("tags = ?"), vals.push(JSON.stringify(d.tags)));
  if (d.ignorado !== undefined) (sets.push("ignorado = ?"), vals.push(d.ignorado ? 1 : 0));
  db.prepare(`UPDATE lancamentos SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return formatarLanc(ouNaoEncontrado(db.prepare(`${SELECT_LANC} WHERE l.id = ?`).get(id), "lançamento") as Record<string, unknown>);
});

/** De qual compra veio um crédito no cartão: até 5 candidatas do mesmo cartão. Só mostra; quem escolhe é o Paulo. */
app.get("/api/lancamentos/:id/compras", async (req) => {
  const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
  type L = { conta_id: string; conta_tipo: string; data: string; descricao_original: string | null; valor_centavos: number };
  const credito = ouNaoEncontrado(db.prepare(`${SELECT_LANC} WHERE l.id = ?`).get(id), "lançamento") as unknown as L;
  if (credito.conta_tipo !== "CREDIT" || credito.valor_centavos <= 0) throw Object.assign(new Error("só vale para crédito em cartão"), { statusCode: 400 });
  // maior ou igual: estorno pode ser parcial
  const compras = db.prepare(
    `${SELECT_LANC} WHERE l.conta_id = ? AND l.valor_centavos <= ? AND l.data BETWEEN date(?, '-120 days') AND ? AND l.status IS NOT 'REMOVIDO'
     ORDER BY l.data DESC, l.rowid DESC`,
  ).all(credito.conta_id, -credito.valor_centavos, credito.data, credito.data) as unknown as L[];
  const palavras = (l: L) => new Set(chaveDe(l.descricao_original ?? "").split(" ").filter((p) => p.length >= 3));
  const doCredito = palavras(credito);
  const emComum = (l: L) => [...palavras(l)].filter((p) => doCredito.has(p)).length;
  const igual = (l: L) => Number(l.valor_centavos === -credito.valor_centavos);
  // a ordem por data vem do SQL e o sort é estável
  return compras.sort((a, b) => igual(b) - igual(a) || emComum(b) - emComum(a)).slice(0, 5).map((l) => formatarLanc(l as unknown as Record<string, unknown>));
});

app.get("/api/meses", async () =>
  (db.prepare("SELECT DISTINCT substr(data,1,7) AS mes FROM lancamentos ORDER BY mes DESC").all() as { mes: string }[]).map((r) => r.mes),
);

// ---------------- resumo do mês ----------------

/** O que conta no mês. Resumo e orçamento usam este mesmo trecho: se um mudar, o outro muda junto. */
const BASE_RESUMO = `FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id LEFT JOIN categorias cat ON cat.id = l.categoria_id
  WHERE l.data BETWEEN ? AND ? AND ct.pessoa = ? AND ct.oculta = 0 AND l.ignorado = 0 AND l.status IS NOT 'REMOVIDO'
    AND COALESCE(cat.grupo, '') <> 'transferencia'`;
/**
 * Gasto em centavos positivos; NULL = é entrada. Dinheiro que entra já com categoria de gasto é estorno ou reembolso e abate a
 * categoria. Sem categoria não abate: pode ser renda, ou um pagamento de fatura ainda não marcado como transferência.
 */
const GASTO = `CASE WHEN l.valor_centavos < 0 OR cat.grupo <> 'renda' THEN -l.valor_centavos END`;
/** Entrada em centavos; NULL = é gasto (o contrário de GASTO). */
const ENTRADA = `CASE WHEN ${GASTO} IS NULL THEN l.valor_centavos END`;
const periodo = (mes: string, pessoa: string) => [`${mes}-01`, fimDoMes(mes), pessoa];

interface GastoCategoria { categoria_id: number | null; categoria: string; cor: string | null; grupo: string | null; total: number; qtd: number }
const gastosPorCategoria = (mes: string, pessoa: string) =>
  db.prepare(
    `SELECT l.categoria_id, COALESCE(cat.nome,'Sem categoria') AS categoria, cat.cor, cat.grupo, SUM(${GASTO}) AS total, COUNT(${GASTO}) AS qtd
     ${BASE_RESUMO} GROUP BY l.categoria_id HAVING COUNT(${GASTO}) > 0 ORDER BY total DESC`,
  ).all(...periodo(mes, pessoa)) as unknown as GastoCategoria[];

function totaisDoMes(mes: string, pessoa: string) {
  const tot = db.prepare(
    `SELECT COALESCE(SUM(${ENTRADA}),0) AS entradas,
            COALESCE(SUM(${GASTO}),0) AS saidas,
            SUM(l.categoria_id IS NULL) AS pendentes ${BASE_RESUMO}`,
  ).get(...periodo(mes, pessoa)) as { entradas: number; saidas: number; pendentes: number | null };
  return { ...tot, pendentes: tot.pendentes ?? 0 };
}

app.get("/api/resumo", async (req) => {
  const { mes, pessoa } = z
    .object({ mes: z.string().regex(mesRe), pessoa: z.enum(["PF", "PJ"]).default("PF") })
    .parse(req.query);
  return { mes, pessoa, ...totaisDoMes(mes, pessoa), porCategoria: gastosPorCategoria(mes, pessoa) };
});

// ---------------- orçamento (só PF: a empresa não entra no orçamento da casa) ----------------

/** Em categoria de renda, o planejado é a renda esperada: não é gasto. */
const planejadoPorCategoria = (mes: string) =>
  db.prepare(
    `SELECT c.id AS categoria_id, c.nome AS categoria, c.cor, c.grupo,
            (SELECT valor_centavos FROM orcamentos WHERE categoria_id = c.id AND mes <= ? ORDER BY mes DESC LIMIT 1) AS planejado
     FROM categorias c WHERE c.grupo <> 'transferencia' ORDER BY c.nome`,
  ).all(mes) as { categoria_id: number; categoria: string; cor: string | null; grupo: string; planejado: number | null }[];
const somar = (ns: (number | null)[]) => ns.reduce<number>((s, n) => s + (n ?? 0), 0);

const totaisPorMes = (ate: string) =>
  db.prepare(
    `SELECT substr(l.data,1,7) AS mes, COALESCE(SUM(${ENTRADA}),0) AS entradas,
            COALESCE(SUM(CASE WHEN cat.grupo = 'renda' THEN ${ENTRADA} END),0) AS renda, COALESCE(SUM(${GASTO}),0) AS gasto
     ${BASE_RESUMO} GROUP BY 1 ORDER BY 1`,
  ).all("0000-01-01", fimDoMes(ate), "PF") as unknown as TotalMes[];

/** Totais PF até o mês atual e o primeiro mês da análise: o que o usuário escolheu ou, sem escolha, o primeiro com a renda completa. */
function historicoPF(mesAtual: string) {
  const totais = totaisPorMes(mesAtual);
  const inicio_automatico = inicioDaAnalise(totais, mesAtual);
  const escolhido = db.prepare("SELECT valor FROM config WHERE chave = 'inicio_analise'").get() as { valor: string } | undefined;
  return { totais, inicio: escolhido?.valor ?? inicio_automatico, inicio_automatico, inicio_definido: !!escolhido };
}

/** A renda que serve de régua no mês, o histórico de onde ela saiu e o orçado de gasto. Só PF. */
function reguaDoMes(mes: string, mesAtual: string, { totais, inicio } = historicoPF(mesAtual)) {
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

app.get("/api/orcamento", async (req) => {
  const { mes } = z.object({ mes: z.string().regex(mesRe) }).parse(req.query);
  const gastos = gastosPorCategoria(mes, "PF");
  const { cats, anteriores, esperada, origem } = reguaDoMes(mes, diaDeHoje().slice(0, 7));
  const linhas = cats
    .map((c) => ({ ...c, planejado: c.grupo === "renda" ? null : c.planejado, realizado: gastos.find((g) => g.categoria_id === c.categoria_id)?.total ?? 0 }))
    .filter((c) => c.grupo !== "renda" || c.realizado); // renda só aparece se teve saída (para o total bater com o Resumo)
  const entradas = db.prepare(
    `SELECT l.categoria_id, substr(l.data,1,7) AS mes, SUM(${ENTRADA}) AS total ${BASE_RESUMO} GROUP BY 1, 2 HAVING COUNT(${ENTRADA}) > 0`,
  );
  const doMes = entradas.all(...periodo(mes, "PF")) as { categoria_id: number | null; total: number }[];
  const antes = anteriores.length
    ? (entradas.all(`${anteriores[0].mes}-01`, fimDoMes(anteriores.at(-1)!.mes), "PF") as { categoria_id: number | null; mes: string; total: number }[])
    : [];
  const renda = cats.filter((c) => c.grupo === "renda").map(({ grupo, ...c }) => ({
    ...c,
    recebido: doMes.find((e) => e.categoria_id === c.categoria_id)?.total ?? 0,
    sugerido: mediana(anteriores.map((t) => antes.find((e) => e.categoria_id === c.categoria_id && e.mes === t.mes)?.total ?? 0)),
  }));
  return {
    mes, linhas, sem_categoria: gastos.find((g) => g.categoria_id === null)?.total ?? 0,
    renda, renda_esperada: esperada, renda_origem: origem, entradas_sem_categoria: doMes.find((e) => e.categoria_id === null)?.total ?? 0,
  };
});

app.put("/api/orcamento", async (req) => {
  const d = z
    .object({ mes: z.string().regex(mesRe), categoria_id: z.number().int(), valor_centavos: z.number().int().min(0).max(1e11) })
    .parse(req.body);
  db.prepare(
    `INSERT INTO orcamentos (categoria_id, mes, valor_centavos) VALUES (?,?,?)
     ON CONFLICT(categoria_id, mes) DO UPDATE SET valor_centavos = excluded.valor_centavos`,
  ).run(d.categoria_id, d.mes, d.valor_centavos);
  return { ok: true };
});

// ---------------- ritmo: a renda aguenta o mês? (só PF) ----------------

app.get("/api/ritmo", async (req) => {
  const hoje = diaDeHoje(), mesAtual = hoje.slice(0, 7);
  const { mes } = z.object({ mes: z.string().regex(mesRe).default(mesAtual) }).parse(req.query);
  const situacao = mes === mesAtual ? "aberto" : mes < mesAtual ? "fechado" : "futuro";
  const { totais, inicio, anteriores, cats, orcado, esperada, origem } = reguaDoMes(mes, mesAtual);
  const { entradas, saidas } = totaisDoMes(mes, "PF");
  // sem renda esperada, o orçado é o único limite
  const teto = esperada ?? (orcado || null);
  const analisado = inicio !== null && mes >= inicio;

  const lista = situacao === "aberto" ? listarRecorrentes("PF", hoje) : [];
  // a atrasada do mês passado ainda vem: também desconta
  const recorrentes = somar(lista.filter((r) => deveCobrar(r) && r.proxima.slice(0, 7) <= mes).map((r) => r.valor));
  const gastoEntre = (de: string, ate: string) =>
    (db.prepare(`SELECT COALESCE(SUM(${GASTO}),0) AS total ${BASE_RESUMO}`).get(de, ate, "PF") as { total: number }).total;
  const dia = Number(hoje.slice(8)), diasNoMes = diasDoMes(mes);
  const gastoAteHoje = situacao === "aberto" ? gastoEntre(`${mes}-01`, hoje) : 0;
  const projecao = situacao === "aberto"
    ? projetar({
        gastoAteHoje, dia, diasNoMes, jaLancado: saidas,
        depoisDoDia: anteriores.map((t) => gastoEntre(`${t.mes}-${String(dia + 1).padStart(2, "0")}`, fimDoMes(t.mes))),
      })
    : null;
  const dias = diasNoMes - dia + 1; // contando hoje
  const livre = (teto ?? 0) - saidas - recorrentes;

  const noFim = fechadosAntes(totais, situacao === "fechado" ? somarMes(mes, 1) : mesAtual, MESES_ACUMULADO, inicio);
  const ganho = somar(noFim.map((t) => t.entradas)), gasto = somar(noFim.map((t) => t.gasto));

  const historico = anteriores.map((t) => gastosPorCategoria(t.mes, "PF"));
  const acima = situacao === "futuro" || !historico.length ? [] : gastosPorCategoria(mes, "PF")
    .filter((g) => g.categoria_id !== null)
    .map(({ categoria_id, categoria, cor, total }) => {
      // reembolso pode deixar o mês da categoria negativo; "normal" abaixo de zero não diz nada
      const normal = Math.max(0, mediana(historico.map((h) => h.find((x) => x.categoria_id === categoria_id)?.total ?? 0))!);
      return { categoria_id, categoria, cor, gasto: total, normal, acima: total - normal };
    })
    // dentro do próprio orçado não é culpado, mesmo acima do normal (o normal pode estar baixo por causa de reembolso)
    .filter((c) => c.acima > 0 && c.gasto > (cats.find((x) => x.categoria_id === c.categoria_id)?.planejado ?? 0))
    .sort((a, b) => b.acima - a.acima)
    .slice(0, 3);

  return {
    mes, situacao, hoje, inicio, analisado,
    renda: { esperada, origem, recebida: entradas, extra: esperada === null ? 0 : Math.max(0, entradas - esperada) },
    orcado, gasto: saidas, sobra: entradas - saidas, teto, projecao,
    // contra a renda, não contra o teto: sem renda conhecida, passar do orçado é amarelo, não "estourando a renda"
    nivel: situacao === "aberto" ? nivelDo(projecao?.media ?? saidas, orcado, esperada)
      : situacao === "fechado" && analisado ? nivelDo(saidas, orcado, entradas)
      : null,
    por_dia: situacao === "aberto" && teto !== null ? { valor: Math.trunc(livre / dias), no_ritmo: projecao && Math.round((projecao.media - saidas) / dias), livre, dias, recorrentes } : null,
    acumulado: noFim.length ? { de: noFim[0].mes, ate: noFim.at(-1)!.mes, meses: noFim.length, entradas: ganho, gasto, sobra: ganho - gasto } : null,
    acima,
    canceladas_cobradas: lista.flatMap((r) => (r.cobrou_depois ? [{ descricao: r.descricao, ...r.cobrou_depois }] : [])),
  };
});

// ---------------- análises (só PF; mesmos totais do Resumo) ----------------

const MESES_GRAFICO = 12;

app.get("/api/analises", async (req) => {
  const hoje = diaDeHoje(), mesAtual = hoje.slice(0, 7);
  const { mes } = z.object({ mes: z.string().regex(mesRe).default(mesAtual) }).parse(req.query);
  const historico = historicoPF(mesAtual), { inicio } = historico;
  const naAnalise = (m: string) => inicio !== null && m >= inicio && m <= mesAtual;

  // mês a mês: o atual entra como "aberto" e fica fora do acumulado, porque a sobra dele ainda engana
  const orcado_hoje = reguaDoMes(mesAtual, mesAtual, historico).orcado;
  let acumulado = 0;
  const meses = historico.totais.filter((t) => naAnalise(t.mes)).slice(-MESES_GRAFICO).map((t) => {
    const aberto = t.mes === mesAtual, sobra = t.entradas - t.gasto;
    if (!aberto) acumulado += sobra;
    return { mes: t.mes, aberto, entradas: t.entradas, gasto: t.gasto, orcado: reguaDoMes(t.mes, mesAtual, historico).orcado || null, sobra, acumulado: aberto ? null : acumulado };
  });

  // dia a dia: gasto acumulado do mês (até hoje, se aberto) contra o mês anterior
  const regua = reguaDoMes(mes, mesAtual, historico);
  const porDia = (m: string) => {
    const dias = db.prepare(`SELECT l.data AS data, SUM(${GASTO}) AS total ${BASE_RESUMO} GROUP BY 1`).all(...periodo(m, "PF")) as { data: string; total: number | null }[];
    let soma = 0;
    return Array.from({ length: m === mesAtual ? Number(hoje.slice(8)) : diasDoMes(m) }, (_, i) =>
      (soma += dias.find((d) => Number(d.data.slice(8)) === i + 1)?.total ?? 0));
  };
  const mes_anterior = somarMes(mes, -1);

  // quem estourou: toda categoria com gasto, normal, mês passado ou orçado
  const gastoPor = (m: string) => new Map(gastosPorCategoria(m, "PF").map((g) => [g.categoria_id, g]));
  const atual = gastoPor(mes), passado = naAnalise(mes_anterior) ? gastoPor(mes_anterior) : null;
  const antes = regua.anteriores.map((t) => gastoPor(t.mes));
  const categorias = !naAnalise(mes) ? [] : regua.cats.filter((c) => c.grupo !== "renda").map(({ categoria_id, categoria, cor, grupo, planejado }) => ({
    categoria_id, categoria, cor, grupo,
    gasto: atual.get(categoria_id)?.total ?? 0,
    normal: antes.length ? Math.max(0, mediana(antes.map((a) => a.get(categoria_id)?.total ?? 0))!) : null,
    mes_passado: passado ? (passado.get(categoria_id)?.total ?? 0) : null,
    orcado: planejado || null,
  })).filter((c) => c.gasto || c.normal || c.mes_passado || c.orcado);

  // já comprometido: o que já está lançado nos próximos meses (parcelas) e as recorrentes, se continuarem
  const todos = totaisPorMes(somarMes(mesAtual, MESES_GRAFICO));
  const recorrentes = somar(listarRecorrentes("PF", hoje).filter(deveCobrar).map((r) => r.valor));
  const comprometido = Array.from({ length: MESES_GRAFICO }, (_, i) => somarMes(mesAtual, i + 1)).map((m) => ({
    mes: m, parcelas: Math.max(0, todos.find((t) => t.mes === m)?.gasto ?? 0), recorrentes, esperada: reguaDoMes(m, mesAtual, historico).esperada,
  }));

  return {
    mes, mes_atual: mesAtual, inicio, inicio_automatico: historico.inicio_automatico, inicio_definido: historico.inicio_definido,
    meses, orcado_hoje: orcado_hoje || null,
    dia_a_dia: {
      dias: naAnalise(mes) ? porDia(mes) : [], anterior: naAnalise(mes_anterior) ? porDia(mes_anterior) : null, mes_anterior,
      ja_lancado: totaisDoMes(mes, "PF").saidas, // com as parcelas de data futura: é o gasto do Resumo e do Orçamento
      orcado: regua.orcado || null, esperada: regua.esperada,
    },
    categorias, comprometido,
  };
});

/** Primeiro mês da análise (alarme e gráficos). null = volta ao automático. */
app.put("/api/analises/inicio", async (req) => {
  const { mes } = z.object({ mes: z.string().regex(mesRe).nullable() }).parse(req.body);
  if (mes === null) db.prepare("DELETE FROM config WHERE chave = 'inicio_analise'").run();
  else if (mes > diaDeHoje().slice(0, 7)) throw Object.assign(new Error("o mês inicial não pode ser no futuro"), { statusCode: 400 });
  else
    db.prepare("INSERT INTO config (chave, valor) VALUES ('inicio_analise', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(mes);
  return { ok: true };
});

// ---------------- recorrentes ----------------

/** Deve cobrar de novo: conta no alarme. Sugestão conta até ser ignorada. */
const deveCobrar = (r: Recorrente) => r.status !== "ignorada" && r.status !== "cancelada" && r.situacao !== "parada";

function listarRecorrentes(pessoa: string, hoje: string) {
  const gastos = db.prepare(
    `SELECT l.data, l.descricao, l.descricao_original, l.status, -l.valor_centavos AS valor, cat.nome AS categoria, cat.cor, COALESCE(ct.apelido, ct.nome) AS conta
     ${BASE_RESUMO} AND l.valor_centavos < 0 AND COALESCE(l.total_parcelas, 0) <= 1 ORDER BY l.data`,
  ).all("0000-01-01", hoje, pessoa) as unknown as Gasto[];
  const decisoes = db.prepare("SELECT chave, valor_centavos AS valor, status, proposta, decidido_em FROM recorrencias").all() as unknown as Decisao[];
  return detectarRecorrentes(gastos, hoje, decisoes);
}

const decisaoRecorrente = z.object({
  chave: z.string().min(1).max(300),
  valor: z.number().int().positive().max(1e12), // valor_chave da recorrente
  status: z.enum(["confirmada", "ignorada", "cancelada"]).nullable(), // null = volta a sugestão
});

/** A recorrente escolhida e a linha de `recorrencias` que é só dela: se já decidiu antes, é a mesma linha, mesmo que o valor tenha mudado. */
function acharRecorrente(d: { chave: string; valor: number }) {
  const hoje = diaDeHoje();
  const r = ouNaoEncontrado(pessoaPFPJ.options.flatMap((p) => listarRecorrentes(p, hoje)).find((x) => x.chave === d.chave && x.valor_chave === d.valor), "recorrente");
  return { r, linha: r.decisao ?? { chave: r.chave, valor: r.valor_chave } };
}

app.get("/api/recorrentes", async (req) => {
  const { pessoa } = z.object({ pessoa: pessoaPFPJ.default("PF") }).parse(req.query);
  return listarRecorrentes(pessoa, diaDeHoje());
});

app.put("/api/recorrentes", async (req) => {
  const d = decisaoRecorrente.parse(req.body), { linha } = acharRecorrente(d);
  // a data só muda se a decisão mudou: é dela que conta o "cobrou depois de cancelada"
  db.prepare(
    `INSERT INTO recorrencias (chave, valor_centavos, status) VALUES (?,?,?) ON CONFLICT(chave, valor_centavos) DO UPDATE SET
       proposta = NULL, status = excluded.status, decidido_em = CASE WHEN status = excluded.status THEN decidido_em ELSE excluded.decidido_em END`,
  ).run(linha.chave, linha.valor, d.status ?? "sugerida");
  return { ok: true };
});

/** O MCP só propõe: nada muda nos números até alguém aceitar (ou recusar) na tela, pelo PUT acima. */
app.post("/api/recorrentes/propostas", async (req) => {
  const d = decisaoRecorrente.parse(req.body), { r, linha } = acharRecorrente(d);
  if (r.status === d.status) throw Object.assign(new Error("a recorrente já está assim"), { statusCode: 409 });
  db.prepare(
    `INSERT INTO recorrencias (chave, valor_centavos, status, proposta) VALUES (?,?,?,?)
     ON CONFLICT(chave, valor_centavos) DO UPDATE SET proposta = excluded.proposta`,
  ).run(linha.chave, linha.valor, r.status ?? "sugerida", d.status ?? "sugerida");
  return { ok: true };
});

// ---------------- patrimônio ----------------

app.get("/api/patrimonio", async (req) => patrimonio(z.object({ pessoa: pessoaPFPJ.default("PF") }).parse(req.query).pessoa));

const bem = z.object({ nome: z.string().trim().min(1).max(60), valor_centavos: z.number().int().min(-1e12).max(1e12) });
app.post("/api/bens", async (req) => {
  const d = bem.extend({ pessoa: pessoaPFPJ }).parse(req.body);
  const r = db.prepare("INSERT INTO bens (nome, valor_centavos, pessoa) VALUES (?,?,?) RETURNING *").get(d.nome, d.valor_centavos, d.pessoa);
  registrarSaldos();
  return r;
});
app.patch("/api/bens/:id", async (req) => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  const d = bem.partial().parse(req.body);
  const r = db.prepare("UPDATE bens SET nome = COALESCE(?, nome), valor_centavos = COALESCE(?, valor_centavos) WHERE id = ? RETURNING *")
    .get(d.nome ?? null, d.valor_centavos ?? null, id);
  registrarSaldos();
  return ouNaoEncontrado(r, "bem");
});
app.delete("/api/bens/:id", async (req) => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  return transacao(() => {
    db.prepare("DELETE FROM saldos_diarios WHERE origem = 'bem' AND ref_id = ?").run(String(id)); // o id pode ser reaproveitado
    db.prepare("DELETE FROM bens WHERE id = ?").run(id);
    return { ok: true };
  });
});

// ---------------- categorias e regras ----------------

/** Com a contagem de tudo que aponta para a categoria, inclusive lançamento ignorado ou REMOVIDO. */
const listarCategorias = () =>
  (db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM lancamentos WHERE categoria_id = c.id) AS lancamentos,
       (SELECT COUNT(*) FROM regras WHERE categoria_id = c.id) AS regras,
       (SELECT COUNT(*) FROM orcamentos WHERE categoria_id = c.id) AS orcamentos
     FROM categorias c ORDER BY grupo, nome`,
  ).all() as { id: number; nome: string; grupo: string; cor: string | null; lancamentos: number; regras: number; orcamentos: number }[])
    .map((c) => ({ ...c, usos: c.lancamentos + c.regras + c.orcamentos, fixa: NOMES_FIXOS.has(c.nome) }));
const categoriaOu404 = (id: number) => ouNaoEncontrado(listarCategorias().find((c) => c.id === id), "categoria");
const conflito = (mensagem: string) => Object.assign(new Error(mensagem), { statusCode: 409 });
const recusarNomeFixo = (nome: string) => {
  if (NOMES_FIXOS.has(nome)) throw conflito(`"${nome}" é usada pela categorização automática: não dá para apagar nem renomear`);
};

app.get("/api/categorias", async () => listarCategorias());

const grupos = z.enum(["essencial", "estilo_de_vida", "financeiro", "renda", "transferencia"]);
app.post("/api/categorias", async (req) => {
  const d = z.object({ nome: z.string().trim().min(1).max(40), grupo: grupos, cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(req.body);
  const r = db.prepare("INSERT INTO categorias (nome, grupo, cor) VALUES (?,?,?) RETURNING *").get(d.nome, d.grupo, d.cor ?? "#95a5a6");
  limparCacheCategorias();
  return r;
});
app.patch("/api/categorias/:id", async (req) => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  const d = z.object({ nome: z.string().trim().min(1).max(40).optional(), grupo: grupos.optional(), cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(req.body);
  const atual = categoriaOu404(id);
  if (d.nome !== undefined && d.nome !== atual.nome) recusarNomeFixo(atual.nome);
  db.prepare("UPDATE categorias SET nome = COALESCE(?, nome), grupo = COALESCE(?, grupo), cor = COALESCE(?, cor) WHERE id = ?")
    .run(d.nome ?? null, d.grupo ?? null, d.cor ?? null, id);
  limparCacheCategorias();
  return db.prepare("SELECT * FROM categorias WHERE id = ?").get(id);
});
/** Só apaga categoria sem uso: regras e orçamentos têm ON DELETE CASCADE e sumiriam junto, em silêncio. */
app.delete("/api/categorias/:id", async (req) => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  return transacao(() => {
    const c = categoriaOu404(id);
    recusarNomeFixo(c.nome);
    if (c.usos) throw conflito(`"${c.nome}" está em uso (lançamentos, regras ou orçamento): não dá para apagar`);
    db.prepare("DELETE FROM categorias WHERE id = ?").run(id);
    limparCacheCategorias();
    return { ok: true };
  });
});
/** Gasto, renda ou transferência: é o que decide como a categoria entra no resumo (os três grupos de gasto contam igual). */
const tipoDoGrupo = (grupo: string) => (grupo === "renda" || grupo === "transferencia" ? grupo : "gasto");
/**
 * Leva lançamentos (a edição manual continua manual) e regras para o destino e apaga a origem. Só entre categorias do mesmo
 * tipo, para o total do mês não mudar. O orçamento da origem é perdido (cascade): fica o do destino.
 */
app.post("/api/categorias/:id/mesclar", async (req) => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  const { destino } = z.object({ destino: z.number().int() }).parse(req.body);
  return transacao(() => {
    const de = categoriaOu404(id), para = categoriaOu404(destino);
    if (de.id === para.id) throw conflito("escolha duas categorias diferentes");
    recusarNomeFixo(de.nome);
    if (tipoDoGrupo(de.grupo) !== tipoDoGrupo(para.grupo)) throw conflito("só dá para mesclar categorias do mesmo tipo: gasto, renda ou transferência");
    db.prepare("UPDATE lancamentos SET categoria_id = ?, atualizado_em = datetime('now','localtime') WHERE categoria_id = ?").run(para.id, de.id);
    db.prepare("UPDATE regras SET categoria_id = ? WHERE categoria_id = ?").run(para.id, de.id);
    db.prepare("DELETE FROM categorias WHERE id = ?").run(de.id);
    limparCacheCategorias();
    return { ok: true, lancamentos: de.lancamentos, regras: de.regras };
  });
});

app.get("/api/regras", async () =>
  db.prepare(
    `SELECT r.*, c.nome AS categoria, COALESCE(ct.apelido, ct.nome) AS conta, (SELECT COUNT(*) FROM lancamentos WHERE regra_id = r.id) AS usos
     FROM regras r JOIN categorias c ON c.id = r.categoria_id LEFT JOIN contas ct ON ct.id = r.conta_id ORDER BY r.prioridade DESC, r.padrao`,
  ).all(),
);
const alcanceRegra = z.object({
  padrao: z.string().trim().min(3).max(120), // texto curto demais pegaria quase tudo
  sentido: z.enum(["saida", "entrada"]).nullable().default(null), // nulo = os dois
  conta_id: uuid.nullable().default(null), // nulo = todas
});
app.get("/api/regras/previa", async (req) => contarParecidos(alcanceRegra.parse(req.query)));
/** Cria a regra; se já existe uma com o mesmo texto (maiúsculas não contam), sentido e conta, troca a categoria dela: é o Paulo corrigindo. */
app.post("/api/regras", async (req) => {
  const d = alcanceRegra.extend({ categoria_id: z.number().int(), descricao: z.string().trim().max(200).optional(), prioridade: z.number().int().min(0).max(100).optional() }).parse(req.body);
  return transacao(() => {
    const atual = db.prepare("SELECT id FROM regras WHERE padrao = ? COLLATE NOCASE AND sentido IS ? AND conta_id IS ?")
      .get(d.padrao, d.sentido, d.conta_id) as { id: number } | undefined;
    const r = atual
      ? db.prepare("UPDATE regras SET categoria_id = ?, descricao = COALESCE(?, descricao), prioridade = COALESCE(?, prioridade) WHERE id = ? RETURNING *")
        .get(d.categoria_id, d.descricao ?? null, d.prioridade ?? null, atual.id)
      : db.prepare("INSERT INTO regras (padrao, sentido, conta_id, categoria_id, descricao, prioridade) VALUES (?,?,?,?,?,?) RETURNING *")
        .get(d.padrao, d.sentido, d.conta_id, d.categoria_id, d.descricao ?? null, d.prioridade ?? 50);
    return { regra: r, recategorizados: reaplicarRegras() };
  });
});
app.delete("/api/regras/:id", async (req) => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  return transacao(() => {
    db.prepare("DELETE FROM regras WHERE id = ?").run(id);
    return { ok: true, recategorizados: reaplicarRegras() }; // também limpa o regra_id de quem usava a regra
  });
});

app.get("/api/saude", async () => ({ ok: true }));

// ---------------- front compilado (npm run build && npm start) ----------------

if (fs.existsSync(env.webDist)) {
  await app.register(fastifyStatic, { root: env.webDist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/") ? reply.code(404).send({ erro: "rota não encontrada" }) : reply.sendFile("index.html"),
  );
}

await app.listen({ host: "127.0.0.1", port: env.porta });
