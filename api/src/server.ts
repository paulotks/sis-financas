import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { db, migrar, transacao } from "./db.js";
import { env } from "./env.js";
import { ErroPluggy, pluggy } from "./pluggy.js";
import { salvarConexao, sincronizar } from "./sync.js";
import { contarParecidos, limparCacheCategorias, reaplicarRegras } from "./categorizar.js";

migrar();
reaplicarRegras(); // mudança no mapa de categorias passa a valer também para o que já está na base

export const app = Fastify({ logger: { level: "info", transport: undefined } });

// Só aceita escrita vinda do próprio PC (front em dev na 5173 ou servido pela própria API).
const ORIGENS = new Set(
  [5173, env.porta].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]),
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
  if (errcode === 787) return reply.code(400).send({ erro: "categoria não encontrada" }); // FOREIGN KEY
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  return reply.code(status).send({ erro: err.message });
});

const uuid = z.string().uuid();
const mesRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const fimDoMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

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
      conta: uuid.optional(),
      categoria: z.coerce.number().int().optional(),
      busca: z.string().max(100).optional(),
      pendentes: z.enum(["1", "0"]).optional(),
      pessoa: z.enum(["PF", "PJ"]).optional(),
    })
    .parse(req.query);
  const onde: string[] = ["ct.oculta = 0"];
  const vals: (string | number)[] = [];
  if (q.mes) (onde.push("l.data BETWEEN ? AND ?"), vals.push(`${q.mes}-01`, fimDoMes(q.mes)));
  if (q.conta) (onde.push("l.conta_id = ?"), vals.push(q.conta));
  if (q.categoria) (onde.push("l.categoria_id = ?"), vals.push(q.categoria));
  if (q.pessoa) (onde.push("ct.pessoa = ?"), vals.push(q.pessoa));
  if (q.pendentes === "1") onde.push("l.categoria_id IS NULL AND l.ignorado = 0 AND l.status IS NOT 'REMOVIDO'");
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

app.get("/api/meses", async () =>
  (db.prepare("SELECT DISTINCT substr(data,1,7) AS mes FROM lancamentos ORDER BY mes DESC").all() as { mes: string }[]).map((r) => r.mes),
);

// ---------------- resumo do mês ----------------

app.get("/api/resumo", async (req) => {
  const { mes, pessoa } = z
    .object({ mes: z.string().regex(mesRe), pessoa: z.enum(["PF", "PJ"]).default("PF") })
    .parse(req.query);
  const base = `FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id LEFT JOIN categorias cat ON cat.id = l.categoria_id
    WHERE l.data BETWEEN ? AND ? AND ct.pessoa = ? AND ct.oculta = 0 AND l.ignorado = 0 AND l.status IS NOT 'REMOVIDO'
      AND COALESCE(cat.grupo, '') <> 'transferencia'`;
  const p = [`${mes}-01`, fimDoMes(mes), pessoa];
  const tot = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN l.valor_centavos > 0 THEN l.valor_centavos END),0) AS entradas,
            COALESCE(SUM(CASE WHEN l.valor_centavos < 0 THEN -l.valor_centavos END),0) AS saidas,
            SUM(l.categoria_id IS NULL) AS pendentes ${base}`,
  ).get(...p) as { entradas: number; saidas: number; pendentes: number | null };
  const porCategoria = db.prepare(
    `SELECT l.categoria_id, COALESCE(cat.nome,'Sem categoria') AS categoria, cat.cor, cat.grupo,
            -SUM(l.valor_centavos) AS total, COUNT(*) AS qtd
     ${base} AND l.valor_centavos < 0 GROUP BY l.categoria_id ORDER BY total DESC`,
  ).all(...p);
  const saldos = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN tipo='BANK' THEN saldo_centavos END),0) AS contas,
            COALESCE(SUM(CASE WHEN tipo='CREDIT' THEN saldo_centavos END),0) AS cartoes
     FROM contas WHERE pessoa = ? AND oculta = 0`,
  ).get(pessoa);
  return { mes, pessoa, ...tot, pendentes: tot.pendentes ?? 0, porCategoria, saldos };
});

// ---------------- categorias e regras ----------------

app.get("/api/categorias", async () => db.prepare("SELECT * FROM categorias ORDER BY grupo, nome").all());

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
  db.prepare("UPDATE categorias SET nome = COALESCE(?, nome), grupo = COALESCE(?, grupo), cor = COALESCE(?, cor) WHERE id = ?")
    .run(d.nome ?? null, d.grupo ?? null, d.cor ?? null, id);
  limparCacheCategorias();
  return ouNaoEncontrado(db.prepare("SELECT * FROM categorias WHERE id = ?").get(id), "categoria");
});

app.get("/api/regras", async () =>
  db.prepare(
    `SELECT r.*, c.nome AS categoria, (SELECT COUNT(*) FROM lancamentos WHERE regra_id = r.id) AS usos
     FROM regras r JOIN categorias c ON c.id = r.categoria_id ORDER BY r.prioridade DESC, r.padrao`,
  ).all(),
);
const padraoRegra = z.string().trim().min(3).max(120); // texto curto demais pegaria quase tudo
app.get("/api/regras/previa", async (req) => contarParecidos(z.object({ padrao: padraoRegra }).parse(req.query).padrao));
/** Cria a regra; se o texto já tem regra (maiúsculas não contam), troca a categoria dela: é o Paulo corrigindo. */
app.post("/api/regras", async (req) => {
  const d = z.object({ padrao: padraoRegra, categoria_id: z.number().int(), descricao: z.string().trim().max(200).optional(), prioridade: z.number().int().min(0).max(100).optional() }).parse(req.body);
  return transacao(() => {
    const atual = db.prepare("SELECT id FROM regras WHERE padrao = ? COLLATE NOCASE").get(d.padrao) as { id: number } | undefined;
    const r = atual
      ? db.prepare("UPDATE regras SET categoria_id = ?, descricao = COALESCE(?, descricao), prioridade = COALESCE(?, prioridade) WHERE id = ? RETURNING *")
        .get(d.categoria_id, d.descricao ?? null, d.prioridade ?? null, atual.id)
      : db.prepare("INSERT INTO regras (padrao, categoria_id, descricao, prioridade) VALUES (?,?,?,?) RETURNING *")
        .get(d.padrao, d.categoria_id, d.descricao ?? null, d.prioridade ?? 50);
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
