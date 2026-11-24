import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { db, migrar, transacao } from "./db.js";
import { env } from "./env.js";
import { patrimonio, registrarSaldos } from "./patrimonio.js";
import { ErroPluggy, pluggy } from "./pluggy.js";
import { detectarRecorrentes, type Gasto } from "./recorrentes.js";
import { salvarConexao, sincronizar } from "./sync.js";
import { contarParecidos, limparCacheCategorias, NOMES_FIXOS, reaplicarRegras } from "./categorizar.js";

migrar();
reaplicarRegras(); // mudança no mapa de categorias passa a valer também para o que já está na base

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
  if (errcode === 787) return reply.code(400).send({ erro: "categoria não encontrada" }); // FOREIGN KEY
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  return reply.code(status).send({ erro: err.message });
});

const uuid = z.string().uuid();
const pessoaPFPJ = z.enum(["PF", "PJ"]);
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

/** O que conta no mês. Resumo e orçamento usam este mesmo trecho: se um mudar, o outro muda junto. */
const BASE_RESUMO = `FROM lancamentos l JOIN contas ct ON ct.id = l.conta_id LEFT JOIN categorias cat ON cat.id = l.categoria_id
  WHERE l.data BETWEEN ? AND ? AND ct.pessoa = ? AND ct.oculta = 0 AND l.ignorado = 0 AND l.status IS NOT 'REMOVIDO'
    AND COALESCE(cat.grupo, '') <> 'transferencia'`;
/**
 * Gasto em centavos positivos; NULL = é entrada. Crédito no cartão já categorizado é estorno e abate a categoria.
 * Sem categoria não abate: pode ser um pagamento de fatura que ainda não foi marcado como transferência.
 */
const GASTO = `CASE WHEN l.valor_centavos < 0 OR (ct.tipo = 'CREDIT' AND cat.grupo <> 'renda') THEN -l.valor_centavos END`;
const periodo = (mes: string, pessoa: string) => [`${mes}-01`, fimDoMes(mes), pessoa];

interface GastoCategoria { categoria_id: number | null; categoria: string; cor: string | null; grupo: string | null; total: number; qtd: number }
const gastosPorCategoria = (mes: string, pessoa: string) =>
  db.prepare(
    `SELECT l.categoria_id, COALESCE(cat.nome,'Sem categoria') AS categoria, cat.cor, cat.grupo, SUM(${GASTO}) AS total, COUNT(${GASTO}) AS qtd
     ${BASE_RESUMO} GROUP BY l.categoria_id HAVING COUNT(${GASTO}) > 0 ORDER BY total DESC`,
  ).all(...periodo(mes, pessoa)) as unknown as GastoCategoria[];

app.get("/api/resumo", async (req) => {
  const { mes, pessoa } = z
    .object({ mes: z.string().regex(mesRe), pessoa: z.enum(["PF", "PJ"]).default("PF") })
    .parse(req.query);
  const tot = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN ${GASTO} IS NULL THEN l.valor_centavos END),0) AS entradas,
            COALESCE(SUM(${GASTO}),0) AS saidas,
            SUM(l.categoria_id IS NULL) AS pendentes ${BASE_RESUMO}`,
  ).get(...periodo(mes, pessoa)) as { entradas: number; saidas: number; pendentes: number | null };
  return { mes, pessoa, ...tot, pendentes: tot.pendentes ?? 0, porCategoria: gastosPorCategoria(mes, pessoa) };
});

// ---------------- orçamento (só PF: a empresa não entra no orçamento da casa) ----------------

app.get("/api/orcamento", async (req) => {
  const { mes } = z.object({ mes: z.string().regex(mesRe) }).parse(req.query);
  const gastos = gastosPorCategoria(mes, "PF");
  const cats = db.prepare(
    `SELECT c.id AS categoria_id, c.nome AS categoria, c.cor, c.grupo,
            (SELECT valor_centavos FROM orcamentos WHERE categoria_id = c.id AND mes <= ? ORDER BY mes DESC LIMIT 1) AS planejado
     FROM categorias c WHERE c.grupo <> 'transferencia' ORDER BY c.nome`,
  ).all(mes) as { categoria_id: number; categoria: string; cor: string | null; grupo: string; planejado: number | null }[];
  const linhas = cats
    .map((c) => ({ ...c, realizado: gastos.find((g) => g.categoria_id === c.categoria_id)?.total ?? 0 }))
    .filter((c) => c.grupo !== "renda" || c.realizado); // renda só aparece se teve saída (para o total bater com o Resumo)
  return { mes, linhas, sem_categoria: gastos.find((g) => g.categoria_id === null)?.total ?? 0 };
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

// ---------------- recorrentes ----------------

app.get("/api/recorrentes", async (req) => {
  const { pessoa } = z.object({ pessoa: pessoaPFPJ.default("PF") }).parse(req.query);
  const { hoje } = db.prepare("SELECT date('now','localtime') AS hoje").get() as { hoje: string };
  const gastos = db.prepare(
    `SELECT l.data, l.descricao, l.descricao_original, -l.valor_centavos AS valor, cat.nome AS categoria, cat.cor, COALESCE(ct.apelido, ct.nome) AS conta
     ${BASE_RESUMO} AND l.valor_centavos < 0 AND COALESCE(l.total_parcelas, 0) <= 1 ORDER BY l.data`,
  ).all("0000-01-01", hoje, pessoa) as unknown as Gasto[];
  const status = new Map(
    (db.prepare("SELECT chave, status FROM recorrencias").all() as { chave: string; status: string }[]).map((r) => [r.chave, r.status]),
  );
  return detectarRecorrentes(gastos, hoje)
    .map((r) => ({ ...r, status: status.get(r.chave) ?? null }))
    .filter((r) => r.status || r.situacao !== "parada"); // o que já acabou só aparece se o Paulo decidiu algo sobre ele
});

app.put("/api/recorrentes", async (req) => {
  const d = z.object({ chave: z.string().min(1).max(300), status: z.enum(["confirmada", "ignorada"]).nullable() }).parse(req.body);
  if (d.status === null) db.prepare("DELETE FROM recorrencias WHERE chave = ?").run(d.chave);
  else
    db.prepare("INSERT INTO recorrencias (chave, status) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET status = excluded.status")
      .run(d.chave, d.status);
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
