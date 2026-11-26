import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { candidatosPara, compromissosDoAno, compromissosDoMes, lerCadastros, MINIMO_LETRAS_DO_TEXTO, normalizarTexto } from "./compromissos.js";
import { copiaDoDia, db, migrar, simplificar, transacao } from "./db.js";
import { env } from "./env.js";
import { faltasDosCartoes } from "./faltas.js";
import { GRUPOS } from "./grupos.js";
import { lerMetas, listarMetas, mesmaPosicao, metasDoMes } from "./metas.js";
import { INVESTIMENTOS, patrimonio, posicoes, registrarSaldos } from "./patrimonio.js";
import { ErroPluggy, pluggy } from "./pluggy.js";
import { chaveDe, deveCobrar } from "./recorrentes.js";
import { diasDoMes, faltaParaMetas, fechadosAntes, mediana, MESES_ACUMULADO, nivelDo, projetar, somarMes } from "./ritmo.js";
import { salvarConexao, sincronizar } from "./sync.js";
import {
  BASE_RESUMO, diasComDado, ENTRADA, ESTORNO, fimDoMes, GASTO, gastosPorCategoria, historicoPF, LANCAMENTOS, listarRecorrentes, naoApareceuPF,
  NO_RESUMO, normalPorCategoria, periodo, previstasPF, reguaDoMes, SOMA, somar, totaisDoMes, totaisPorMes, ultimoDiaComDado,
} from "./totais.js";
import { carregarRegras, limparCacheCategorias, NOMES_FIXOS, previaDaRegra, PRIORIDADE_PADRAO, reaplicarRegras, regraIgual } from "./categorizar.js";
import type {
  Analises, Bem, CandidatosAPagamento, Categoria, CategoriaComUsos, CompromissoCadastrado, Compromissos, CompromissosDoAno, Conexao, Conta, ContaLinha, Contas, Grupo, Investimento, Lancamento, LancamentoEditado, ListaLancamentos, Meta,
  MetaLinha, Metas, Ok, Orcamento, Patrimonio, PreviaRegra, Recorrente, Regra, RegraCriada, RegraLinha, ResultadoSync, Resumo, Ritmo, Sincronizacao,
  TotaisLancamentos,
} from "./tipos.js";

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
const diaDeHoje = () => (db.prepare("SELECT date('now','localtime') AS hoje").get() as { hoje: string }).hoje;

const conflito = (mensagem: string) => Object.assign(new Error(mensagem), { statusCode: 409 });
const erro400 = (mensagem: string) => Object.assign(new Error(mensagem), { statusCode: 400 });
function ouNaoEncontrado<T>(registro: T | undefined, oQue: string): T {
  if (registro === undefined) throw Object.assign(new Error(`${oQue}: não encontrado(a)`), { statusCode: 404 });
  return registro;
}

// ---------------- Pluggy / conexões ----------------

app.post("/api/pluggy/connect-token", async (req): Promise<{ accessToken: string }> => {
  const { itemId } = z.object({ itemId: uuid.optional() }).parse(req.body ?? {});
  return { accessToken: await pluggy.connectToken("paulo", itemId) };
});

app.get("/api/conexoes", async (): Promise<Conexao[]> =>
  db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM contas WHERE item_id = c.item_id) AS contas,
       (SELECT group_concat(COALESCE(apelido, nome), ' · ') FROM contas WHERE item_id = c.item_id) AS nomes_contas
     FROM conexoes c ORDER BY c.criado_em`,
  ).all() as unknown as Conexao[],
);

/** Recebe o itemId do onSuccess do widget, confirma na Pluggy, grava e já sincroniza. */
app.post("/api/conexoes", async (req): Promise<ResultadoSync> => {
  const { itemId } = z.object({ itemId: uuid }).parse(req.body);
  salvarConexao(await pluggy.item(itemId));
  const [resultado] = await sincronizar(itemId);
  return resultado;
});

app.post("/api/sync", async (req): Promise<Sincronizacao> => {
  const { itemId, desde } = z
    .object({ itemId: uuid.optional(), desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .parse(req.body ?? {});
  return { resultados: await sincronizar(itemId, desde) };
});

app.get("/api/sync/historico", async () =>
  db.prepare("SELECT * FROM sincronizacoes ORDER BY id DESC LIMIT 30").all(),
);

// ---------------- contas ----------------

app.get("/api/contas", async (): Promise<Contas> => {
  const faltas = faltasDosCartoes(diaDeHoje());
  return {
    contas: (db.prepare(
      `SELECT ct.*, cx.conector, cx.imagem_url, cx.ultimo_sync
       FROM contas ct JOIN conexoes cx ON cx.item_id = ct.item_id
       ORDER BY ct.pessoa, ct.tipo, COALESCE(ct.apelido, ct.nome)`,
    ).all() as unknown as Omit<Conta, "faltas">[]).map((c) => ({ ...c, faltas: faltas.get(c.id) ?? null })),
    investimentos: db.prepare(
      `SELECT i.*, cx.conector FROM (${INVESTIMENTOS}) i JOIN conexoes cx ON cx.item_id = i.item_id ORDER BY i.nome`,
    ).all() as unknown as Investimento[],
  };
});

app.patch("/api/contas/:id", async (req): Promise<ContaLinha> => {
  const { id } = z.object({ id: uuid }).parse(req.params);
  const d = z
    .object({ apelido: z.string().max(60).nullable().optional(), pessoa: z.enum(["PF", "PJ"]).optional(), oculta: z.boolean().optional(), usa_reservas: z.boolean().optional() })
    .parse(req.body);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (d.apelido !== undefined) (sets.push("apelido = ?"), vals.push(d.apelido?.trim() || null));
  if (d.pessoa) (sets.push("pessoa = ?"), vals.push(d.pessoa));
  if (d.oculta !== undefined) (sets.push("oculta = ?"), vals.push(d.oculta ? 1 : 0));
  if (d.usa_reservas !== undefined) (sets.push("usa_reservas = ?"), vals.push(d.usa_reservas ? 1 : 0));
  if (sets.length)
    transacao(() => {
      db.prepare(`UPDATE contas SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
      if (d.pessoa || d.oculta !== undefined) reaplicarRegras(); // o Pix no crédito só vale com o cartão visível e da mesma pessoa
    });
  if (d.usa_reservas !== undefined) registrarSaldos();
  return ouNaoEncontrado(db.prepare("SELECT * FROM contas WHERE id = ?").get(id) as unknown as ContaLinha | undefined, "conta");
});

// ---------------- lançamentos ----------------

const SELECT_LANC = `
  SELECT l.id, l.conta_id, l.data, l.descricao, l.descricao_original, l.valor_centavos, l.tipo, l.status,
         l.categoria_id, l.categoria_manual, l.categoria_pluggy, l.comerciante, l.parcela, l.total_parcelas,
         l.notas, l.tags, l.ignorado,
         COALESCE(ct.apelido, ct.nome) AS conta, ct.tipo AS conta_tipo, ct.pessoa,
         cat.nome AS categoria, cat.cor AS categoria_cor, cat.grupo AS categoria_grupo,
         ${SOMA} AS soma, ${ESTORNO} AS estorno
  ${LANCAMENTOS}`;

const formatarLanc = (r: Record<string, unknown>): Lancamento => ({
  ...r,
  tags: JSON.parse(String(r.tags ?? "[]")),
  ignorado: !!r.ignorado,
  soma: !!r.soma,
  estorno: !!r.estorno,
  categoria_manual: !!r.categoria_manual,
}) as unknown as Lancamento;

/** Os filtros da tela Lançamentos: a lista e os totais dela usam o mesmo trecho. */
function filtroDeLancamentos(query: unknown) {
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
    .parse(query);
  const onde: string[] = ["ct.oculta = 0"];
  const vals: (string | number)[] = [];
  if (q.mes) (onde.push("l.data BETWEEN ? AND ?"), vals.push(`${q.mes}-01`, fimDoMes(q.mes)));
  if (q.conta === "cartoes") onde.push("ct.tipo IS 'CREDIT'");
  else if (q.conta === "contas") onde.push("ct.tipo IS NOT 'CREDIT'"); // o que não é cartão é conta, como na tela
  else if (q.conta) (onde.push("l.conta_id = ?"), vals.push(q.conta));
  if (q.categoria) (onde.push("l.categoria_id = ?"), vals.push(q.categoria));
  if (q.pessoa) (onde.push("ct.pessoa = ?"), vals.push(q.pessoa));
  if (q.pendentes === "1") onde.push(`l.categoria_id IS NULL AND ${SOMA}`);
  if (q.estornos === "1") onde.push(ESTORNO);
  if (q.busca) {
    // instr e não LIKE: "%" e "_" digitados são texto, não coringa
    onde.push(`(${["descricao", "descricao_original", "notas"].map((c) => `instr(simplificar(l.${c}), ?) > 0`).join(" OR ")})`);
    const b = simplificar(q.busca);
    vals.push(b, b, b);
  }
  return { onde: onde.join(" AND "), vals };
}

app.get("/api/lancamentos", async (req): Promise<ListaLancamentos> => {
  const { onde, vals } = filtroDeLancamentos(req.query);
  const itens = (db.prepare(`${SELECT_LANC} WHERE ${onde} ORDER BY l.data DESC, l.rowid DESC LIMIT 2000`).all(...vals) as Record<string, unknown>[]).map(formatarLanc);
  // total de verdade: a lista para em 2000 e a tela precisa saber que foi cortada
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${LANCAMENTOS} WHERE ${onde}`).get(...vals) as { total: number };
  return { itens, total };
});

/**
 * Soma da lista inteira (sem o corte), pela regra do Resumo: o mês sem outro filtro dá os mesmos números de lá. O que é transferência vem à
 * parte, para não parecer que sumiu.
 */
app.get("/api/lancamentos/totais", async (req): Promise<TotaisLancamentos> => {
  const { onde, vals } = filtroDeLancamentos(req.query);
  const soma = (valor: string, se: string) => `COALESCE(SUM(${valor}) FILTER (WHERE ${se}), 0)`;
  const fora = `${SOMA} AND cat.grupo = 'transferencia'`;
  return db.prepare(
    `SELECT ${soma(ENTRADA, NO_RESUMO)} AS entradas, ${soma(GASTO, NO_RESUMO)} AS gastos,
       ${soma("l.valor_centavos", `${fora} AND l.valor_centavos > 0`)} AS fora_entrou, ${soma("-l.valor_centavos", `${fora} AND l.valor_centavos < 0`)} AS fora_saiu
     ${LANCAMENTOS} WHERE ${onde}`,
  ).get(...vals) as unknown as TotaisLancamentos;
});

/**
 * Categoria e "ignorar" reaplicam as regras na hora: o Pix no crédito depende das três pernas, e desfazer a edição à mão volta ao automático.
 * `tambem_mudaram` = os outros que isso mudou.
 */
app.patch("/api/lancamentos/:id", async (req): Promise<LancamentoEditado> => {
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
  return transacao(() => {
    db.prepare(`UPDATE lancamentos SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    const mudaram = d.categoria_id !== undefined || d.ignorado !== undefined ? reaplicarRegras().filter((x) => x !== id) : [];
    const outros = db.prepare(`${SELECT_LANC} WHERE l.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(mudaram)) as Record<string, unknown>[];
    const editado = ouNaoEncontrado(db.prepare(`${SELECT_LANC} WHERE l.id = ?`).get(id), "lançamento") as Record<string, unknown>;
    return { ...formatarLanc(editado), tambem_mudaram: outros.map(formatarLanc) };
  });
});

/** De qual compra veio um crédito no cartão: até 5 candidatas do mesmo cartão. Só mostra; quem escolhe é o Paulo. */
app.get("/api/lancamentos/:id/compras", async (req): Promise<Lancamento[]> => {
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

app.get("/api/meses", async (): Promise<string[]> =>
  (db.prepare("SELECT DISTINCT substr(data,1,7) AS mes FROM lancamentos ORDER BY mes DESC").all() as { mes: string }[]).map((r) => r.mes),
);

// ---------------- resumo do mês ----------------

app.get("/api/resumo", async (req): Promise<Resumo> => {
  const { mes, pessoa } = z
    .object({ mes: z.string().regex(mesRe), pessoa: z.enum(["PF", "PJ"]).default("PF") })
    .parse(req.query);
  return { mes, pessoa, ...totaisDoMes(mes, pessoa), porCategoria: gastosPorCategoria(mes, pessoa) };
});

// ---------------- orçamento (só PF: a empresa não entra no orçamento da casa) ----------------

app.get("/api/orcamento", async (req): Promise<Orcamento> => {
  const { mes } = z.object({ mes: z.string().regex(mesRe) }).parse(req.query);
  const gastos = gastosPorCategoria(mes, "PF");
  const { cats, anteriores, orcado, esperada, origem, metas } = reguaDoMes(mes, diaDeHoje().slice(0, 7));
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
    mes, planejado: orcado, gasto: somar(gastos.map((g) => g.total)), linhas, sem_categoria: gastos.find((g) => g.categoria_id === null)?.total ?? 0,
    renda, renda_esperada: esperada, renda_origem: origem, metas, entradas_sem_categoria: doMes.find((e) => e.categoria_id === null)?.total ?? 0,
  };
});

app.put("/api/orcamento", async (req): Promise<Ok> => {
  const d = z
    .object({ mes: z.string().regex(mesRe), categoria_id: z.number().int(), valor_centavos: z.number().int().min(0).max(1e11) })
    .parse(req.body);
  db.prepare(
    `INSERT INTO orcamentos (categoria_id, mes, valor_centavos) VALUES (?,?,?)
     ON CONFLICT(categoria_id, mes) DO UPDATE SET valor_centavos = excluded.valor_centavos`,
  ).run(d.categoria_id, d.mes, d.valor_centavos);
  return { ok: true };
});

// ---------------- contas do mês: o que sai da conta, pelo vencimento (só PF, só leitura; as contas ficam em compromissos.ts) ----------------

app.get("/api/compromissos", async (req): Promise<Compromissos> => {
  const hoje = diaDeHoje();
  const { mes } = z.object({ mes: z.string().regex(mesRe).default(hoje.slice(0, 7)) }).parse(req.query);
  return compromissosDoMes(mes, hoje);
});
app.get("/api/compromissos/ano", async (req): Promise<CompromissosDoAno> => {
  const hoje = diaDeHoje();
  const { ano } = z.object({ ano: z.string().regex(/^\d{4}$/).default(hoje.slice(0, 4)) }).parse(req.query);
  return compromissosDoAno(ano, hoje);
});

// conta à mão: o que o detector não pega. Só muda a página Contas do mês; o texto acha o pagamento e não é regra de categoria
const camposDoCompromisso = z.object({
  nome: z.string().trim().min(1).max(60),
  valor: z.number().int().positive().max(1e11),
  dia: z.number().int().min(1).max(31),
  texto: z.string().max(100).nullable(),
  inicio: z.string().regex(mesRe),
  fim: z.string().regex(mesRe).nullable(),
  parcelas: z.number().int().min(1).max(600), // "em N parcelas": fim = início + N − 1
}).partial();
const compromissoOu404 = (id: number) => ouNaoEncontrado(lerCadastros().find((k) => k.id === id), "conta à mão");
const idDoCompromisso = (params: unknown) => z.object({ id: z.coerce.number().int() }).parse(params).id;

function gravarCompromisso(atual: CompromissoCadastrado | undefined, d: z.infer<typeof camposDoCompromisso>): CompromissoCadastrado {
  if (d.parcelas !== undefined && d.fim !== undefined) throw erro400("diga até quando (fim) ou em quantas parcelas, não os dois");
  const inicio = d.inicio ?? atual?.inicio ?? diaDeHoje().slice(0, 7);
  const k = {
    nome: d.nome ?? atual?.nome, valor: d.valor ?? atual?.valor, dia: d.dia ?? atual?.dia, inicio,
    texto: d.texto === undefined ? (atual?.texto ?? null) : d.texto === null || !d.texto.trim() ? null : normalizarTexto(d.texto),
    fim: d.parcelas !== undefined ? somarMes(inicio, d.parcelas - 1) : d.fim !== undefined ? d.fim : (atual?.fim ?? null),
  };
  if (!k.nome || !k.valor || !k.dia) throw erro400("faltam nome, valor e dia");
  if (k.texto !== null && k.texto.length < MINIMO_LETRAS_DO_TEXTO) throw erro400(`o texto precisa de pelo menos ${MINIMO_LETRAS_DO_TEXTO} letras (números, símbolos e acentos não contam)`);
  if (k.fim !== null && k.fim < k.inicio) throw erro400("o fim vem antes do início");
  const vals = [k.nome, k.valor, k.dia, k.texto, k.inicio, k.fim];
  const { id } = (atual
    ? db.prepare("UPDATE compromissos SET nome = ?, valor_centavos = ?, dia = ?, texto = ?, inicio = ?, fim = ? WHERE id = ? RETURNING id").get(...vals, atual.id)
    : db.prepare("INSERT INTO compromissos (nome, valor_centavos, dia, texto, inicio, fim) VALUES (?,?,?,?,?,?) RETURNING id").get(...vals)) as { id: number };
  return compromissoOu404(id);
}

app.post("/api/compromissos/manuais", async (req): Promise<CompromissoCadastrado> =>
  gravarCompromisso(undefined, camposDoCompromisso.required({ nome: true, valor: true, dia: true }).parse(req.body)));
app.patch("/api/compromissos/manuais/:id", async (req): Promise<CompromissoCadastrado> =>
  gravarCompromisso(compromissoOu404(idDoCompromisso(req.params)), camposDoCompromisso.parse(req.body)));
/** Leva as marcas de pago junto (ON DELETE CASCADE). */
app.delete("/api/compromissos/manuais/:id", async (req): Promise<Ok> => {
  db.prepare("DELETE FROM compromissos WHERE id = ?").run(compromissoOu404(idDoCompromisso(req.params)).id);
  return { ok: true };
});
/** A marca à mão, para o que não passa por conta conectada. Guarda o esperado de hoje; o lançamento que casar depois vale mais que ela. */
app.put("/api/compromissos/manuais/:id/pago", async (req): Promise<Ok> => {
  const k = compromissoOu404(idDoCompromisso(req.params));
  const { mes, pago } = z.object({ mes: z.string().regex(mesRe), pago: z.boolean() }).parse(req.body);
  if (mes < k.inicio || (k.fim !== null && mes > k.fim)) throw erro400("a conta não vale nesse mês");
  if (pago) db.prepare("INSERT INTO compromissos_pagos (compromisso_id, mes, valor_centavos) VALUES (?,?,?) ON CONFLICT (compromisso_id, mes) DO UPDATE SET valor_centavos = excluded.valor_centavos").run(k.id, mes, k.valor);
  else db.prepare("DELETE FROM compromissos_pagos WHERE compromisso_id = ? AND mes = ?").run(k.id, mes);
  return { ok: true };
});
app.get("/api/compromissos/manuais/:id/candidatos", async (req): Promise<CandidatosAPagamento> => {
  const hoje = diaDeHoje(), k = compromissoOu404(idDoCompromisso(req.params));
  const { mes } = z.object({ mes: z.string().regex(mesRe).default(hoje.slice(0, 7)) }).parse(req.query);
  return candidatosPara(k, mes, hoje);
});

// ---------------- ritmo: a renda aguenta o mês? (só PF) ----------------

app.get("/api/ritmo", async (req): Promise<Ritmo> => {
  const hoje = diaDeHoje(), mesAtual = hoje.slice(0, 7);
  const { mes } = z.object({ mes: z.string().regex(mesRe).default(mesAtual) }).parse(req.query);
  const situacao = mes === mesAtual ? "aberto" : mes < mesAtual ? "fechado" : "futuro";
  const historico = historicoPF(mesAtual);
  const { totais, inicio, anteriores, cats, orcado, esperada, origem, metas, teto } = reguaDoMes(mes, mesAtual, historico);
  const { entradas, saidas } = totaisDoMes(mes, "PF");
  const analisado = inicio !== null && mes >= inicio;

  const lista = situacao === "aberto" ? listarRecorrentes("PF", hoje) : [];
  // a atrasada do mês passado ainda vem: também desconta
  const recorrentes = somar(lista.filter((r) => deveCobrar(r) && r.a_lancar.slice(0, 7) <= mes).map((r) => r.valor));
  const gastoEntre = (de: string, ate: string) =>
    (db.prepare(`SELECT COALESCE(SUM(${GASTO}),0) AS total ${BASE_RESUMO}`).get(de, ate, "PF") as { total: number }).total;
  const diasNoMes = diasDoMes(mes), dados_ate = ultimoDiaComDado(hoje), dia = diasComDado(mes, dados_ate);
  const projecao = situacao === "aberto"
    ? projetar({
        gastoAteODia: gastoEntre(`${mes}-01`, dados_ate), dia, diasNoMes, jaLancado: saidas,
        depoisDoDia: anteriores.map((t) => gastoEntre(`${t.mes}-${String(dia + 1).padStart(2, "0")}`, fimDoMes(t.mes))),
      })
    : null;
  const dias = diasNoMes - Number(hoje.slice(8)) + 1; // contando hoje
  const livre = (teto ?? 0) - saidas - recorrentes;

  const noFim = fechadosAntes(totais, situacao === "fechado" ? somarMes(mes, 1) : mesAtual, MESES_ACUMULADO, inicio);
  const ganho = somar(noFim.map((t) => t.entradas)), gasto = somar(noFim.map((t) => t.gasto));

  const normalDe = normalPorCategoria(anteriores);
  const acima = situacao === "futuro" ? [] : gastosPorCategoria(mes, "PF")
    .flatMap(({ categoria_id, categoria, cor, total }) => {
      const normal = normalDe(categoria_id);
      return categoria_id === null || normal === null ? [] : [{ categoria_id, categoria, cor, gasto: total, normal, acima: total - normal }];
    })
    // dentro do próprio orçado não é culpado, mesmo acima do normal (o normal pode estar baixo por causa de reembolso)
    .filter((c) => c.acima > 0 && c.gasto > (cats.find((x) => x.categoria_id === c.categoria_id)?.planejado ?? 0))
    .sort((a, b) => b.acima - a.acima)
    .slice(0, 3);

  // contra a renda, não contra o teto: sem renda conhecida, passar do orçado é amarelo, não "estourando a renda"
  const contra = situacao === "aberto" ? { gasto: projecao?.media ?? saidas, renda: esperada } : situacao === "fechado" && analisado ? { gasto: saidas, renda: entradas } : null;

  return {
    mes, situacao, hoje, dados_ate, inicio, inicio_antes: historico.inicio_antes, analisado,
    renda: { esperada, origem, recebida: entradas, extra: esperada === null ? 0 : Math.max(0, entradas - esperada) },
    orcado, gasto: saidas, sobra: entradas - saidas, metas, teto, projecao,
    nao_apareceu: situacao === "aberto" ? naoApareceuPF(hoje) : [],
    parcelas_previstas: situacao === "futuro" ? (previstasPF(hoje).get(mes) ?? 0) : 0, // fora do gasto
    nivel: contra && nivelDo(contra.gasto, orcado, contra.renda, metas),
    falta_metas: contra ? faltaParaMetas(contra.gasto, contra.renda, metas) : 0,
    por_dia: situacao === "aberto" && teto !== null ? { valor: Math.trunc(livre / dias), no_ritmo: projecao && Math.round((projecao.media - saidas) / dias), livre, dias, recorrentes } : null,
    acumulado: noFim.length ? { de: noFim[0].mes, ate: noFim.at(-1)!.mes, meses: noFim.length, entradas: ganho, gasto, sobra: ganho - gasto } : null,
    acima,
    canceladas_cobradas: lista.flatMap((r) => (r.cobrou_depois ? [{ descricao: r.descricao, ...r.cobrou_depois }] : [])),
  };
});

// ---------------- análises (só PF; mesmos totais do Resumo) ----------------

const MESES_A_FRENTE = 12;

app.get("/api/analises", async (req): Promise<Analises> => {
  const hoje = diaDeHoje(), mesAtual = hoje.slice(0, 7);
  const { mes } = z.object({ mes: z.string().regex(mesRe).default(mesAtual) }).parse(req.query);
  const historico = historicoPF(mesAtual), { inicio } = historico;
  const naAnalise = (m: string) => inicio !== null && m >= inicio && m <= mesAtual;

  // mês a mês: o atual entra como "aberto" e fica fora do acumulado, porque a sobra dele ainda engana
  const orcado_hoje = reguaDoMes(mesAtual, mesAtual, historico).orcado;
  let acumulado = 0;
  const atual = historico.totais.filter((t) => t.mes === mesAtual && naAnalise(t.mes));
  const meses = [...fechadosAntes(historico.totais, mesAtual, MESES_ACUMULADO, inicio), ...atual].map((t) => {
    const aberto = t.mes === mesAtual, sobra = t.entradas - t.gasto, { orcado, metas } = reguaDoMes(t.mes, mesAtual, historico);
    if (!aberto) acumulado += sobra;
    return { mes: t.mes, aberto, entradas: t.entradas, gasto: t.gasto, orcado: orcado || null, metas: metas || null, sobra, acumulado: aberto ? null : acumulado };
  });

  // dia a dia: gasto acumulado do mês (no aberto, até o último dia com dado do banco) contra o mês anterior
  const regua = reguaDoMes(mes, mesAtual, historico), dados_ate = ultimoDiaComDado(hoje);
  const porDia = (m: string) => {
    const dias = db.prepare(`SELECT l.data AS data, SUM(${GASTO}) AS total ${BASE_RESUMO} GROUP BY 1`).all(...periodo(m, "PF")) as { data: string; total: number | null }[];
    let soma = 0;
    return Array.from({ length: m === mesAtual ? diasComDado(m, dados_ate) : diasDoMes(m) }, (_, i) =>
      (soma += dias.find((d) => Number(d.data.slice(8)) === i + 1)?.total ?? 0));
  };
  const mes_anterior = somarMes(mes, -1);

  // quem estourou: toda categoria com gasto, normal, mês passado ou orçado
  const gastoPor = (m: string) => new Map(gastosPorCategoria(m, "PF").map((g) => [g.categoria_id, g]));
  const doMes = gastoPor(mes), passado = naAnalise(mes_anterior) ? gastoPor(mes_anterior) : null;
  const normalDe = normalPorCategoria(regua.anteriores);
  const categorias = !naAnalise(mes) ? [] : regua.cats.filter((c) => c.grupo !== "renda").map(({ categoria_id, categoria, cor, grupo, planejado }) => ({
    categoria_id, categoria, cor, grupo,
    gasto: doMes.get(categoria_id)?.total ?? 0,
    normal: normalDe(categoria_id),
    mes_passado: passado ? (passado.get(categoria_id)?.total ?? 0) : null,
    orcado: planejado || null,
  })).filter((c) => c.gasto || c.normal || c.mes_passado || c.orcado);

  // já comprometido: o que já está lançado nos próximos meses (parcelas), as parcelas que o banco não mandou e as recorrentes, se continuarem
  const todos = totaisPorMes(somarMes(mesAtual, MESES_A_FRENTE));
  const naoMandadas = previstasPF(hoje);
  const recorrentes = listarRecorrentes("PF", hoje).filter(deveCobrar);
  const comprometido = Array.from({ length: MESES_A_FRENTE }, (_, i) => somarMes(mesAtual, i + 1)).map((m) => ({
    mes: m, parcelas: Math.max(0, todos.find((t) => t.mes === m)?.gasto ?? 0), previstas: naoMandadas.get(m) ?? 0,
    recorrentes: somar(recorrentes.filter((r) => r.a_lancar.slice(0, 7) <= m).map((r) => r.valor)), esperada: reguaDoMes(m, mesAtual, historico).esperada,
  }));

  return {
    mes, mes_atual: mesAtual, inicio, inicio_automatico: historico.inicio_automatico, inicio_definido: historico.inicio_definido, inicio_antes: historico.inicio_antes,
    meses, orcado_hoje: orcado_hoje || null,
    dia_a_dia: {
      dados_ate,
      dias: naAnalise(mes) ? porDia(mes) : [], anterior: naAnalise(mes_anterior) ? porDia(mes_anterior) : null, mes_anterior,
      ja_lancado: totaisDoMes(mes, "PF").saidas, // com as parcelas de data futura: é o gasto do Resumo e do Orçamento
      orcado: regua.orcado || null, esperada: regua.esperada, metas: regua.metas,
    },
    categorias, comprometido,
  };
});

/** Primeiro mês da análise (alarme e gráficos). null = volta ao automático. */
app.put("/api/analises/inicio", async (req): Promise<Ok> => {
  const { mes } = z.object({ mes: z.string().regex(mesRe).nullable() }).parse(req.body);
  if (mes === null) db.prepare("DELETE FROM config WHERE chave = 'inicio_analise'").run();
  else if (mes > diaDeHoje().slice(0, 7)) throw Object.assign(new Error("o mês inicial não pode ser no futuro"), { statusCode: 400 });
  else
    db.prepare("INSERT INTO config (chave, valor) VALUES ('inicio_analise', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(mes);
  return { ok: true };
});

// ---------------- recorrentes ----------------

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

app.get("/api/recorrentes", async (req): Promise<Recorrente[]> => {
  const { pessoa } = z.object({ pessoa: pessoaPFPJ.default("PF") }).parse(req.query);
  return listarRecorrentes(pessoa, diaDeHoje());
});

app.put("/api/recorrentes", async (req): Promise<Ok> => {
  const d = decisaoRecorrente.parse(req.body), { linha } = acharRecorrente(d);
  // a data só muda se a decisão mudou: é dela que conta o "cobrou depois de cancelada"
  db.prepare(
    `INSERT INTO recorrencias (chave, valor_centavos, status) VALUES (?,?,?) ON CONFLICT(chave, valor_centavos) DO UPDATE SET
       proposta = NULL, status = excluded.status, decidido_em = CASE WHEN status = excluded.status THEN decidido_em ELSE excluded.decidido_em END`,
  ).run(linha.chave, linha.valor, d.status ?? "sugerida");
  return { ok: true };
});

/** O MCP só propõe: nada muda nos números até alguém aceitar (ou recusar) na tela, pelo PUT acima. */
app.post("/api/recorrentes/propostas", async (req): Promise<Ok> => {
  const d = decisaoRecorrente.parse(req.body), { r, linha } = acharRecorrente(d);
  if (r.status === d.status) throw Object.assign(new Error("a recorrente já está assim"), { statusCode: 409 });
  db.prepare(
    `INSERT INTO recorrencias (chave, valor_centavos, status, proposta) VALUES (?,?,?,?)
     ON CONFLICT(chave, valor_centavos) DO UPDATE SET proposta = excluded.proposta`,
  ).run(linha.chave, linha.valor, r.status ?? "sugerida", d.status ?? "sugerida");
  return { ok: true };
});

// ---------------- patrimônio ----------------

app.get("/api/patrimonio", async (req): Promise<Patrimonio> => patrimonio(z.object({ pessoa: pessoaPFPJ.default("PF") }).parse(req.query).pessoa));

const bem = z.object({ nome: z.string().trim().min(1).max(60), valor_centavos: z.number().int().min(-1e12).max(1e12) });
app.post("/api/bens", async (req): Promise<Bem> => {
  const d = bem.extend({ pessoa: pessoaPFPJ }).parse(req.body);
  const r = db.prepare("INSERT INTO bens (nome, valor_centavos, pessoa) VALUES (?,?,?) RETURNING *").get(d.nome, d.valor_centavos, d.pessoa) as unknown as Bem;
  registrarSaldos();
  return r;
});
app.patch("/api/bens/:id", async (req): Promise<Bem> => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  const d = bem.partial().parse(req.body);
  const r = db.prepare("UPDATE bens SET nome = COALESCE(?, nome), valor_centavos = COALESCE(?, valor_centavos) WHERE id = ? RETURNING *")
    .get(d.nome ?? null, d.valor_centavos ?? null, id) as unknown as Bem | undefined;
  registrarSaldos();
  return ouNaoEncontrado(r, "bem");
});
app.delete("/api/bens/:id", async (req): Promise<Ok> => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  return transacao(() => {
    // o id pode ser reaproveitado: nem a evolução nem a meta podem passar para outra linha
    db.prepare("DELETE FROM saldos_diarios WHERE origem = 'bem' AND ref_id = ?").run(String(id));
    db.prepare("UPDATE metas SET origem = NULL, ref_id = NULL WHERE origem = 'bem' AND ref_id = ?").run(String(id));
    db.prepare("DELETE FROM bens WHERE id = ?").run(id);
    return { ok: true };
  });
});

// ---------------- metas (só PF; as contas ficam em metas.ts) ----------------

const camposDaMeta = z.object({
  nome: z.string().trim().min(1).max(60),
  alvo: z.number().int().positive().max(1e12).nullable(),
  prazo: z.string().regex(mesRe).nullable(),
  medida: z.object({ origem: z.enum(["conta", "investimento", "bem"]), ref_id: z.string().min(1).max(200) }).nullable(),
  por_mes: z.number().int().min(0).max(1e11),
  mes: z.string().regex(mesRe), // o por_mes vale deste mês em diante
}).partial();

/** Confere a meta como ela vai ficar e grava. Meta encerrada não volta a pedir nada sem ser reaberta. */
function gravarMeta(atual: MetaLinha | undefined, tipo: MetaLinha["tipo"], d: z.infer<typeof camposDaMeta> & { encerrada?: boolean }): Meta {
  const hoje = diaDeHoje(), mesAtual = hoje.slice(0, 7);
  const m = {
    nome: d.nome ?? atual?.nome ?? "", alvo: d.alvo !== undefined ? d.alvo : (atual?.alvo ?? null), prazo: d.prazo !== undefined ? d.prazo : (atual?.prazo ?? null),
    ...(d.medida !== undefined ? { origem: d.medida?.origem ?? null, ref_id: d.medida?.ref_id ?? null } : { origem: atual?.origem ?? null, ref_id: atual?.ref_id ?? null }),
    encerrada_em: d.encerrada === undefined ? (atual?.encerrada_em ?? null) : d.encerrada ? (atual?.encerrada_em ?? mesAtual) : null,
  };
  if (tipo === "guardar" && (m.alvo ?? m.prazo ?? m.origem) !== null) throw erro400("meta de guardar por mês não tem alvo, prazo nem posição ligada");
  if (d.medida) {
    const p = posicoes("PF").find((x) => mesmaPosicao(x, m));
    // só na escolha: a dívida que já estava ligada pode ter chegado a zero
    if (p?.serve !== tipo) throw erro400(tipo === "quitar" ? "escolha um cartão ou dívida com saldo a pagar" : "escolha uma conta, investimento, cofrinho ou bem com saldo");
    if (tipo === "quitar" && d.alvo === undefined && (m.alvo === null || atual?.origem)) m.alvo = -p.valor; // sem tamanho digitado, ou dívida trocada: o de hoje
  }
  if (tipo === "juntar" && m.alvo === null) throw erro400("falta o alvo: quanto juntar");
  if (d.por_mes && m.encerrada_em) throw conflito("a meta está encerrada: reabra antes de definir o valor por mês");
  return transacao(() => {
    if (!m.encerrada_em && lerMetas(mesAtual).some((x) => x.id !== atual?.id && !x.encerrada_em && mesmaPosicao(x, m))) throw conflito("essa posição já mede outra meta: contaria o mesmo dinheiro duas vezes");
    const vals = [m.nome, m.alvo, m.prazo, m.origem, m.ref_id, m.encerrada_em];
    const { id } = (atual
      ? db.prepare("UPDATE metas SET nome = ?, alvo_centavos = ?, prazo = ?, origem = ?, ref_id = ?, encerrada_em = ? WHERE id = ? RETURNING id").get(...vals, atual.id)
      : db.prepare("INSERT INTO metas (nome, alvo_centavos, prazo, origem, ref_id, encerrada_em, tipo) VALUES (?,?,?,?,?,?,?) RETURNING id").get(...vals, tipo)) as { id: number };
    const pedir = (mes: string, valor: number) =>
      db.prepare("INSERT INTO metas_mensais (meta_id, mes, valor_centavos) VALUES (?,?,?) ON CONFLICT(meta_id, mes) DO UPDATE SET valor_centavos = excluded.valor_centavos").run(id, mes, valor);
    if (d.por_mes !== undefined) pedir(d.mes ?? mesAtual, d.por_mes);
    if (d.encerrada) {
      db.prepare("DELETE FROM metas_mensais WHERE meta_id = ? AND mes > ?").run(id, mesAtual);
      pedir(mesAtual, 0);
    }
    return listarMetas(d.mes ?? mesAtual, hoje).find((x) => x.id === id)!; // acabou de gravar
  });
}

app.get("/api/metas", async (req): Promise<Metas> => {
  const hoje = diaDeHoje(), todas = posicoes("PF");
  const { mes } = z.object({ mes: z.string().regex(mesRe).default(hoje.slice(0, 7)) }).parse(req.query);
  return { mes, total: metasDoMes(mes), metas: listarMetas(mes, hoje, todas), posicoes: todas.filter((p) => p.serve) };
});
app.post("/api/metas", async (req): Promise<Meta> => {
  const { tipo, ...d } = camposDaMeta.required({ nome: true }).extend({ tipo: z.enum(["guardar", "juntar", "quitar"]) }).parse(req.body);
  return gravarMeta(undefined, tipo, d);
});
const metaOu404 = (id: number) => ouNaoEncontrado(lerMetas(diaDeHoje().slice(0, 7)).find((m) => m.id === id), "meta");
app.patch("/api/metas/:id", async (req): Promise<Meta> => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  const d = camposDaMeta.extend({ encerrada: z.boolean().optional() }).parse(req.body), atual = metaOu404(id);
  return gravarMeta(atual, atual.tipo, d);
});
/** Muda o veredito dos meses em que ela pedia algo: a tela só oferece para as encerradas. */
app.delete("/api/metas/:id", async (req): Promise<Ok> => {
  const { id } = metaOu404(z.object({ id: z.coerce.number().int() }).parse(req.params).id);
  db.prepare("DELETE FROM metas WHERE id = ?").run(id);
  return { ok: true };
});

// ---------------- categorias e regras ----------------

/** Gasto, renda ou transferência: é o que decide como a categoria entra no resumo (os três grupos de gasto contam igual). */
const tipoDoGrupo = (grupo: Grupo) => (grupo === "renda" || grupo === "transferencia" ? grupo : "gasto");

/** Com a contagem de tudo que aponta para a categoria, inclusive lançamento ignorado ou REMOVIDO. */
const listarCategorias = (): CategoriaComUsos[] =>
  (db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM lancamentos WHERE categoria_id = c.id) AS lancamentos,
       (SELECT COUNT(*) FROM regras WHERE categoria_id = c.id) AS regras,
       (SELECT COUNT(*) FROM orcamentos WHERE categoria_id = c.id) AS orcamentos
     FROM categorias c ORDER BY grupo, nome`,
  ).all() as unknown as Omit<CategoriaComUsos, "tipo" | "usos" | "fixa">[])
    .map((c) => ({ ...c, tipo: tipoDoGrupo(c.grupo), usos: c.lancamentos + c.regras + c.orcamentos, fixa: NOMES_FIXOS.has(c.nome) }));
const categoriaOu404 = (id: number) => ouNaoEncontrado(listarCategorias().find((c) => c.id === id), "categoria");
const recusarNomeFixo = (nome: string) => {
  if (NOMES_FIXOS.has(nome)) throw conflito(`"${nome}" é usada pela categorização automática: não dá para apagar, renomear nem mudar de grupo`);
};

app.get("/api/categorias", async (): Promise<CategoriaComUsos[]> => listarCategorias());

const grupos = z.enum(GRUPOS);
app.post("/api/categorias", async (req): Promise<Categoria> => {
  const d = z.object({ nome: z.string().trim().min(1).max(40), grupo: grupos, cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(req.body);
  const r = db.prepare("INSERT INTO categorias (nome, grupo, cor) VALUES (?,?,?) RETURNING *").get(d.nome, d.grupo, d.cor ?? "#95a5a6") as unknown as Categoria;
  limparCacheCategorias();
  return r;
});
app.patch("/api/categorias/:id", async (req): Promise<Categoria> => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  const d = z.object({ nome: z.string().trim().min(1).max(40).optional(), grupo: grupos.optional(), cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(req.body);
  const atual = categoriaOu404(id);
  if ((d.nome ?? atual.nome) !== atual.nome || (d.grupo ?? atual.grupo) !== atual.grupo) recusarNomeFixo(atual.nome);
  db.prepare("UPDATE categorias SET nome = COALESCE(?, nome), grupo = COALESCE(?, grupo), cor = COALESCE(?, cor) WHERE id = ?")
    .run(d.nome ?? null, d.grupo ?? null, d.cor ?? null, id);
  limparCacheCategorias();
  return db.prepare("SELECT * FROM categorias WHERE id = ?").get(id) as unknown as Categoria;
});
/** Só apaga categoria sem uso: regras e orçamentos têm ON DELETE CASCADE e sumiriam junto, em silêncio. */
app.delete("/api/categorias/:id", async (req): Promise<Ok> => {
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
/**
 * Leva lançamentos (a edição manual continua manual) e regras para o destino e apaga a origem. Só entre categorias do mesmo
 * tipo, para o total do mês não mudar. O orçamento da origem é perdido (cascade): fica o do destino.
 */
app.post("/api/categorias/:id/mesclar", async (req): Promise<Ok & { lancamentos: number; regras: number }> => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  const { destino } = z.object({ destino: z.number().int() }).parse(req.body);
  return transacao(() => {
    const de = categoriaOu404(id), para = categoriaOu404(destino);
    if (de.id === para.id) throw conflito("escolha duas categorias diferentes");
    recusarNomeFixo(de.nome);
    if (de.tipo !== para.tipo) throw conflito("só dá para mesclar categorias do mesmo tipo: gasto, renda ou transferência");
    db.prepare("UPDATE lancamentos SET categoria_id = ?, atualizado_em = datetime('now','localtime') WHERE categoria_id = ?").run(para.id, de.id);
    db.prepare("UPDATE regras SET categoria_id = ? WHERE categoria_id = ?").run(para.id, de.id);
    db.prepare("DELETE FROM categorias WHERE id = ?").run(de.id);
    limparCacheCategorias();
    return { ok: true, lancamentos: de.lancamentos, regras: de.regras };
  });
});

app.get("/api/regras", async (): Promise<Regra[]> =>
  db.prepare(
    `SELECT r.*, c.nome AS categoria, COALESCE(ct.apelido, ct.nome) AS conta, (SELECT COUNT(*) FROM lancamentos WHERE regra_id = r.id) AS usos
     FROM regras r JOIN categorias c ON c.id = r.categoria_id LEFT JOIN contas ct ON ct.id = r.conta_id ORDER BY r.prioridade DESC, r.padrao`,
  ).all() as unknown as Regra[],
);
const alcanceRegra = z.object({
  padrao: z.string().trim().min(3).max(120), // texto curto demais pegaria quase tudo
  sentido: z.enum(["saida", "entrada"]).nullable().default(null), // nulo = os dois
  conta_id: uuid.nullable().default(null), // nulo = todas
});
app.get("/api/regras/previa", async (req): Promise<PreviaRegra> => {
  const { categoria_id, ...alcance } = alcanceRegra.extend({ categoria_id: z.coerce.number().int().optional() }).parse(req.query);
  return previaDaRegra(alcance, categoria_id);
});
/** Cria a regra; se já existe uma com o mesmo texto (maiúsculas não contam), sentido e conta, troca a categoria dela: é o Paulo corrigindo. */
app.post("/api/regras", async (req): Promise<RegraCriada> => {
  const d = alcanceRegra.extend({ categoria_id: z.number().int(), descricao: z.string().trim().max(200).optional(), prioridade: z.number().int().min(0).max(100).optional() }).parse(req.body);
  return transacao(() => {
    const atual = regraIgual(carregarRegras(), d); // em JS: o NOCASE do SQLite não vale para letra com acento
    const r = atual
      ? db.prepare("UPDATE regras SET categoria_id = ?, descricao = COALESCE(?, descricao), prioridade = COALESCE(?, prioridade) WHERE id = ? RETURNING *")
        .get(d.categoria_id, d.descricao ?? null, d.prioridade ?? null, atual.id)
      : db.prepare("INSERT INTO regras (padrao, sentido, conta_id, categoria_id, descricao, prioridade) VALUES (?,?,?,?,?,?) RETURNING *")
        .get(d.padrao, d.sentido, d.conta_id, d.categoria_id, d.descricao ?? null, d.prioridade ?? PRIORIDADE_PADRAO);
    return { regra: r as unknown as RegraLinha, recategorizados: reaplicarRegras().length };
  });
});
app.delete("/api/regras/:id", async (req): Promise<Ok & { recategorizados: number }> => {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  return transacao(() => {
    db.prepare("DELETE FROM regras WHERE id = ?").run(id);
    return { ok: true, recategorizados: reaplicarRegras().length }; // também limpa o regra_id de quem usava a regra
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
