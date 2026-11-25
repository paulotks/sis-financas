// Verificação com uma Pluggy falsa e base temporária: nunca usa as credenciais nem a base reais.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ITEM = "11111111-1111-4111-8111-111111111111";
const ITEM2 = "22222222-2222-4222-8222-222222222222";
const CARTAO = "33333333-3333-4333-8333-333333333333";
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const tx = (id: string, d: number, extra: object = {}) => ({
  id, accountId: CARTAO, date: `${dia(d)}T03:00:00.000Z`, description: `compra ${id}`, amount: 10, type: "DEBIT", status: "POSTED", ...extra,
});

let paginas: object[][] = [];
let urls: string[] = [];
let proximoForcado: string | null = null;
const falsa = http.createServer((req, res) => {
  const u = new URL(req.url!, "http://x");
  const ok = (d: unknown) => res.setHeader("content-type", "application/json").end(JSON.stringify(d));
  if (u.pathname === "/auth") return ok({ apiKey: "falsa" });
  if (u.pathname.startsWith("/items/")) {
    const id = u.pathname.split("/")[2];
    return void setTimeout(() => ok({ id, connector: { id: 1, name: `Banco ${id[0]}` } }), 20);
  }
  if (u.pathname === "/accounts") return ok({ results: u.searchParams.get("itemId") === ITEM ? [{ id: CARTAO, type: "CREDIT", name: "Cartão" }] : [] });
  if (u.pathname === "/v2/transactions") {
    urls.push(req.url!);
    const n = Number(u.searchParams.get("after") ?? 0);
    if (!paginas[n]) return res.writeHead(400).end("{}"); // cursor inválido
    const next = n + 1 < paginas.length ? `?accountId=${CARTAO}&after=${n + 1}` : null; // formato da documentação
    return ok({ results: paginas[n], next: proximoForcado ?? next });
  }
  return ok({ results: [] });
});
await new Promise<void>((r) => falsa.listen(0, "127.0.0.1", r));

const PORTA = 39333;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sis-financas-"));
Object.assign(process.env, {
  PLUGGY_API_URL: `http://127.0.0.1:${(falsa.address() as { port: number }).port}`,
  PLUGGY_CLIENT_ID: "x",
  PLUGGY_CLIENT_SECRET: "x",
  DB_PATH: path.join(dir, "t.db"),
  PORT: String(PORTA),
  SYNC_DIAS_INICIAIS: "365",
});
const { app } = await import("../src/server.js");
const { db, MIGRACOES } = await import("../src/db.js");
const { sincronizar } = await import("../src/sync.js");
const { reaplicarRegras, sugerirCategoria } = await import("../src/categorizar.js");
const { detectarRecorrentes, mesSeguinte, chaveDe } = await import("../src/recorrentes.js");
const { criarServidor } = await import("../src/mcp.js");
const { inicioDaAnalise, mediana, nivelDo, projetar, somarMes } = await import("../src/ritmo.js");
const { lerDinheiro, sugerirPadrao } = await import("../../web/src/lib/api.js"); // funções puras do front

after(async () => {
  await app.close();
  falsa.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ids = () => (db.prepare("SELECT id FROM lancamentos ORDER BY id").all() as { id: string }[]).map((r) => r.id);
const mov = (descricao_original: string, categoria_pluggy: string) => ({ descricao_original, categoria_pluggy, valor_centavos: -100, conta_id: CARTAO });
const lanc = (id: string) => db.prepare("SELECT * FROM lancamentos WHERE id = ?").get(id) as Record<string, unknown>;
const sync = async () => {
  const [r] = await sincronizar(ITEM);
  assert.equal(r.erro, undefined);
  return r;
};
const chamar = (metodo: string, url: string, corpo?: unknown, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; d: any }>((ok, falha) => {
    const r = http.request({ host: "127.0.0.1", port: PORTA, method: metodo, path: url, headers: { ...(corpo === undefined ? {} : { "content-type": "application/json" }), ...headers } }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c)).on("end", () => ok({ status: res.statusCode!, d: t ? JSON.parse(t) : null }));
    });
    r.on("error", falha).end(corpo === undefined ? undefined : JSON.stringify(corpo));
  });

test("segue o cursor `next` até a última página", async () => {
  paginas = [[tx("a", -3)], [tx("b", -20)], [tx("c", -100)]];
  assert.equal((await sync()).novos, 3);
  assert.deepEqual(ids(), ["a", "b", "c"]);
});

test("parcela futura não esconde compra nova, nem lançamento que chega atrasado", async () => {
  paginas = [[tx("futura", 200, { status: "PENDING" }), tx("a", -3), tx("b", -20), tx("c", -100)]];
  await sync();
  urls = [];
  await sync();
  assert.ok(new URL(urls[0], "http://x").searchParams.get("dateFrom")! <= dia(-300));
});

test("falha no meio da paginação não grava metade do histórico", async () => {
  const antes = ids();
  paginas = [[tx("z", -1)]];
  proximoForcado = `?accountId=${CARTAO}&after=9`; // página que não existe
  const [r] = await sincronizar(ITEM);
  proximoForcado = null;
  assert.match(r.erro ?? "", /HTTP 400/);
  assert.deepEqual(ids(), antes);
});

test("a chave da Pluggy nunca vai para outro host", async () => {
  proximoForcado = "http://exemplo.invalid/v2/transactions?after=1";
  const [r] = await sincronizar(ITEM);
  proximoForcado = null;
  assert.match(r.erro ?? "", /fora da Pluggy/);
});

test("lançamento recriado com outro id não conta em dobro e herda a edição", async () => {
  db.prepare("UPDATE lancamentos SET categoria_id = 3, categoria_manual = 1, notas = 'minha nota' WHERE id = 'a'").run();
  db.prepare("UPDATE lancamentos SET notas = 'sem par' WHERE id = 'b'").run();
  // 'a' virou 'a2' (mesma descrição e valor, outra data). Sumiram: 'b' (editado, sem substituto), 'c' (antigo) e 'futura' (sem edição).
  paginas = [[tx("a2", -2, { description: "compra a" }), tx("velho", -200)]];
  await sync();
  assert.deepEqual(ids(), ["a2", "b", "c", "velho"]);
  assert.deepEqual([lanc("a2").categoria_id, lanc("a2").categoria_manual, lanc("a2").notas], [3, 1, "minha nota"]);
});

test("editado que some sem substituto fica guardado, não soma e volta se o banco devolver", async () => {
  const saidas = async (mes: string) => (await chamar("GET", `/api/resumo?mes=${mes}`)).d.saidas as number;
  assert.equal(lanc("b").status, "REMOVIDO");
  const mes = dia(-20).slice(0, 7);
  const sem = await saidas(mes);
  paginas = [[tx("a2", -2, { description: "compra a" }), tx("velho", -200), tx("b", -20)]];
  await sync();
  assert.deepEqual([lanc("b").status, lanc("b").notas], ["POSTED", "sem par"]);
  assert.equal(await saidas(mes), sem + 1000);
});

test("substituto com valor ajustado (IOF, câmbio) não conta em dobro", async () => {
  paginas = [[...paginas[0], tx("p", -5, { status: "PENDING", description: "dolar" })]];
  await sync();
  db.prepare("UPDATE lancamentos SET categoria_id = 11, categoria_manual = 1 WHERE id = 'p'").run();
  paginas = [[...paginas[0].slice(0, -1), tx("p2", -5, { description: "dolar", amount: 11 })]];
  await sync();
  assert.ok(!ids().includes("p"));
  assert.deepEqual([lanc("p2").categoria_id, lanc("p2").valor_centavos], [11, -1100]);
  assert.equal((await sync()).atualizados, 0); // nada mudou
  paginas = [paginas[0].slice(0, -1)];
  await sync();
});

test("resposta vazia do banco não apaga nada", async () => {
  const antes = ids();
  paginas = [[]];
  await sync();
  assert.deepEqual(ids(), antes);
});

test("sincronizações simultâneas devolvem cada uma o seu resultado", async () => {
  const [r1, r2] = await Promise.all([sincronizar(ITEM), sincronizar(ITEM2)]);
  assert.equal(r1[0].item_id, ITEM);
  assert.equal(r2[0].item_id, ITEM2);
});

test("categorias da Pluggy caem no lugar certo", () => {
  const nome = (c: string) => {
    const id = sugerirCategoria(mov("", c), []).categoria_id;
    return id && (db.prepare("SELECT nome FROM categorias WHERE id = ?").get(id) as { nome: string }).nome;
  };
  for (const [pluggy, nossa] of [
    ["Income taxes", "Impostos e taxas"],
    ["Taxes on investments", "Impostos e taxas"],
    ["Fixed income", "Investimentos"],
    ["Variable income", "Investimentos"],
    ["Proceeds interests and dividends", "Renda"],
    ["Non-recurring income", "Renda"],
    ["Car rental", "Transporte"],
    ["Rent", "Moradia"],
    ["Traffic tickets", "Transporte"],
    ["Vehicle Financing", "Juros e dívidas"],
    ["Interests charged", "Juros e dívidas"],
    ["Sports goods", "Compras"],
    ["Credit card payment", "Pagamento de fatura"],
    ["Houseware", "Compras"],
    ["Bookstore", "Compras"],
    ["Office supplies", "Compras"],
    ["Kids and toys", "Compras"],
    ["Tax on financial operations", "Impostos e taxas"],
    ["Account fees", "Impostos e taxas"],
    ["Food and drinks", "Alimentação fora"],
    ["Accomodation", "Lazer"],
    ["Accommodation", "Lazer"],
    ["Lottery", "Lazer"],
    ["Gambling", "Lazer"],
    ["Cinema, theater and concerts", "Lazer"],
    ["Automotive", "Transporte"],
    // ficam pendentes de propósito: genéricas, transferência (Pix no crédito tem três pernas) e crédito que passaria a abater
    ["Transfer - PIX", null],
    ["Transfers", null],
    ["Transfer - Internal", null],
    ["Transfer - Foreign Exchange", null],
    ["Services", null],
    ["Insurance", null],
    ["Entrepreneurial activities", null],
    ["Cashback", null],
  ])
    assert.equal(nome(pluggy!), nossa, pluggy!);
});

test("as duas pernas do cofrinho e da fatura saem juntas do resumo, seja qual for a categoria da Pluggy", () => {
  const grupo = (descricao: string, cp: string) => {
    const id = sugerirCategoria(mov(descricao, cp), []).categoria_id;
    return id && (db.prepare("SELECT grupo FROM categorias WHERE id = ?").get(id) as { grupo: string }).grupo;
  };
  for (const [descricao, cp] of [
    ["Dinheiro reservado Férias", "Transfer - Internal"],
    ["Dinheiro reservado Férias", "Investments"],
    ["Dinheiro retirado", "Same person transfer - CASH"],
    ["Dinheiro retirado PLR", "Salary"],
    ["Débito automático Fatura do cartão", "Transfer - Internal"],
    ["Débito automático total", "Transfer - Internal"],
  ])
    assert.equal(grupo(descricao, cp), "transferencia", `${descricao} / ${cp}`);
  // Pix no crédito: sozinha não sai (tirar só esta perna contaria o gasto em dobro); o teste das três pernas está adiante
  assert.equal(grupo("Valor adicionado na conta por cartão de crédito", "Transfer - Internal"), null);
  // regra do Paulo continua mandando
  const pet = { id: 1, padrao: "reservado pet", sentido: null, conta_id: null, categoria_id: 8, descricao: null };
  assert.equal(sugerirCategoria(mov("Dinheiro reservado Pet", "Transfer - Internal"), [pet]).categoria_id, 8);
});

test("categoria da Pluggy que passa a vir null (fim do trial) não descategoriza o que já estava", async () => {
  const base = paginas[0];
  paginas = [[...base, tx("trial", -4, { category: "Groceries" })]];
  await sync();
  const mercado = lanc("trial").categoria_id;
  assert.ok(mercado);
  paginas = [[...base, tx("trial", -4, { category: null })]];
  await sync();
  reaplicarRegras();
  assert.deepEqual([lanc("trial").categoria_pluggy, lanc("trial").categoria_id], ["Groceries", mercado]);
  paginas = [base];
  await sync();
});

test("regra aprende: a prévia bate com o aplicado, repetir o texto troca a categoria e o editado à mão não muda", async () => {
  const base = paginas[0];
  const uber = (id: string, extra = "") => tx(id, -6, { description: `UBER *TRIP ${id}${extra}` });
  paginas = [[...base, uber("u1"), uber("u2"), uber("u3", " 2/3"), tx("mao", -6, { description: "Uber *Trip mao" })]];
  await sync();
  const pat = await chamar("PATCH", "/api/lancamentos/mao", { categoria_id: 14 });
  assert.deepEqual([pat.status, pat.d.categoria_id, pat.d.categoria_manual], [200, 14, true]);

  const padrao = sugerirPadrao("UBER *TRIP 123 2/3");
  assert.equal(padrao, "UBER *TRIP");
  const previa = await chamar("GET", `/api/regras/previa?padrao=${encodeURIComponent(padrao)}`);
  assert.deepEqual([previa.d.total, previa.d.pendentes, previa.d.descricoes, previa.d.exemplos.length], [3, 3, 3, 3]); // o editado à mão não entra na conta
  const criada = await chamar("POST", "/api/regras", { padrao, categoria_id: 4 });
  assert.equal(criada.d.recategorizados, 3);
  assert.deepEqual(["u1", "u2", "u3", "mao"].map((i) => lanc(i).categoria_id), [4, 4, 4, 14]);

  const outra = await chamar("POST", "/api/regras", { padrao: "uber *trip", categoria_id: 13 });
  assert.equal(outra.d.regra.id, criada.d.regra.id);
  assert.deepEqual(["u1", "mao"].map((i) => lanc(i).categoria_id), [13, 14]);

  assert.equal((await chamar("POST", "/api/regras", { padrao: "ab", categoria_id: 4 })).status, 400);
  assert.equal((await chamar("DELETE", `/api/regras/${criada.d.regra.id}`)).status, 200);
  assert.equal(lanc("u1").categoria_id, null);
  db.prepare("DELETE FROM lancamentos WHERE id = 'mao'").run();
  paginas = [base];
  await sync();
});

test("texto sugerido para a regra é sempre um trecho do original", () => {
  for (const [original, esperado] of [
    ["Netflix.com", "Netflix.com"],
    ["SHOPEE *LOJA 3/10", "SHOPEE *LOJA"],
    ["PG *TON 12345678", "PG *TON"],
    ["99 *99", "99 *99"], // sobraria nada: fica o original
    ["  Pix enviado Fulano  ", "Pix enviado Fulano"],
  ]) {
    assert.equal(sugerirPadrao(original), esperado);
    assert.ok(original.includes(sugerirPadrao(original)));
  }
});

test("API: host e origem de fora são recusados; erro de dados não vira 500", async () => {
  assert.equal((await chamar("GET", "/api/saude")).status, 200);
  assert.equal((await chamar("GET", "/api/lancamentos", undefined, { host: `evil.com:${PORTA}` })).status, 403);
  assert.equal((await chamar("POST", "/api/sync", {}, { origin: "http://evil.com" })).status, 403);
  // o nome amigável entra; parecido com ele, não. Escrita com corpo inválido: 400 = passou pelo hook, 403 = barrada
  const nome = `meu-financeiro.localhost:${PORTA}`;
  assert.equal((await chamar("GET", "/api/saude", undefined, { host: nome })).status, 200);
  assert.equal((await chamar("POST", "/api/regras", {}, { host: nome, origin: `http://${nome}` })).status, 400);
  for (const host of [`evil.localhost:${PORTA}`, `meu-financeiro.localhost.evil.com:${PORTA}`, `x.meu-financeiro.localhost:${PORTA}`, "meu-financeiro.localhost:1"]) {
    assert.equal((await chamar("GET", "/api/saude", undefined, { host })).status, 403, host);
    assert.equal((await chamar("POST", "/api/regras", {}, { origin: `http://${host}` })).status, 403, host);
  }
  assert.equal((await chamar("POST", "/api/regras", {}, { origin: `https://${nome}` })).status, 403);
  assert.equal((await chamar("POST", "/api/categorias", { nome: "Pet", grupo: "essencial" })).status, 409);
  assert.equal((await chamar("PATCH", "/api/lancamentos/a2", { categoria_id: 9999 })).status, 400);
  assert.equal((await chamar("PATCH", `/api/contas/${ITEM2}`, { pessoa: "PJ" })).status, 404);
  assert.equal((await chamar("PATCH", "/api/categorias/9999", { nome: "x" })).status, 404);
  assert.equal((await chamar("GET", "/api/lancamentos?mes=2026-13")).status, 400);
  assert.equal((await chamar("GET", "/api/lancamentos")).d.total, ids().length);
});

// daqui em diante: contas e lançamentos inseridos direto, em meses que nenhum teste acima usa
let nConta = 0;
const novaConta = (tipo: "BANK" | "CREDIT", extra: { pessoa?: string; oculta?: number; saldo?: number; item?: string } = {}) => {
  const id = `00000000-0000-4000-8000-${String(++nConta).padStart(12, "0")}`;
  db.prepare("INSERT INTO contas (id, item_id, tipo, nome, pessoa, oculta, saldo_centavos) VALUES (?,?,?,?,?,?,?)")
    .run(id, extra.item ?? ITEM, tipo, `conta ${nConta}`, extra.pessoa ?? "PF", extra.oculta ?? 0, extra.saldo ?? 0);
  return id;
};
let nLanc = 0;
const novoLanc = (conta: string, data: string, valor: number, categoria: number | null, extra: Record<string, string | number> = {}) => {
  const cols = { id: `m${++nLanc}`, conta_id: conta, data, valor_centavos: valor, categoria_id: categoria, status: "POSTED", ...extra };
  db.prepare(`INSERT INTO lancamentos (${Object.keys(cols).join(",")}) VALUES (${Object.keys(cols).map(() => "?").join(",")})`).run(...Object.values(cols));
};
const MERCADO = 3, RENDA = 18, TRANSFERENCIA = 19;

test("orçamento e Resumo contam o mesmo: sem removido, ignorado, transferência, PJ e oculta; estorno e reembolso abatem", async () => {
  const banco = novaConta("BANK"), cartao = novaConta("CREDIT");
  novoLanc(banco, "2020-03-05", -10000, MERCADO);
  novoLanc(cartao, "2020-03-06", -5000, MERCADO, { status: "PENDING" });
  novoLanc(cartao, "2020-03-07", 2000, MERCADO); // estorno: abate
  novoLanc(banco, "2020-03-08", 2500, MERCADO); // Pix de alguém rachando a conta: abate
  novoLanc(banco, "2020-03-08", 400, null); // entrada sem categoria: não abate
  novoLanc(cartao, "2020-03-09", 3000, null); // crédito no cartão sem categoria: não abate
  novoLanc(banco, "2020-03-10", 50000, RENDA);
  novoLanc(banco, "2020-03-11", -700, null);
  novoLanc(banco, "2020-03-12", -999, MERCADO, { status: "REMOVIDO" });
  novoLanc(banco, "2020-03-12", -999, MERCADO, { ignorado: 1 });
  novoLanc(banco, "2020-03-12", -999, TRANSFERENCIA);
  novoLanc(novaConta("BANK", { pessoa: "PJ" }), "2020-03-12", -999, MERCADO);
  novoLanc(novaConta("BANK", { oculta: 1 }), "2020-03-12", -999, MERCADO);
  novoLanc(banco, "2020-04-01", -999, MERCADO);

  const r = (await chamar("GET", "/api/resumo?mes=2020-03")).d;
  assert.deepEqual([r.entradas, r.saidas, r.pendentes], [53400, 11200, 3]);
  assert.deepEqual(r.porCategoria.map((c: any) => [c.categoria, c.total]), [["Mercado", 10500], ["Sem categoria", 700]]);
  const o = (await chamar("GET", "/api/orcamento?mes=2020-03")).d;
  assert.equal(o.linhas.find((l: any) => l.categoria_id === MERCADO).realizado, 10500);
  assert.equal(o.sem_categoria, 700);
  assert.equal(o.linhas.reduce((s: number, l: any) => s + l.realizado, 0) + o.sem_categoria, r.saidas);
  assert.ok(!o.linhas.some((l: any) => ["transferencia", "renda"].includes(l.grupo)));
});

test("categoria: apaga só se estiver vazia; em uso ou com nome do mapa dá 409 e nada some", async () => {
  const conta = novaConta("BANK");
  const criar = async (nome: string) => (await chamar("POST", "/api/categorias", { nome, grupo: "financeiro" })).d.id as number;
  const apagar = (id: number) => chamar("DELETE", `/api/categorias/${id}`);
  const uma = async (id: number) => (await chamar("GET", "/api/categorias")).d.find((c: any) => c.id === id);
  const n = (tabela: string, id: number) => (db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE categoria_id = ?`).get(id) as { n: number }).n;

  const vazia = await criar("Engano");
  assert.deepEqual([(await uma(vazia)).usos, (await uma(vazia)).fixa], [0, false]);
  assert.equal((await apagar(vazia)).status, 200);
  assert.equal(await uma(vazia), undefined);
  assert.equal((await apagar(vazia)).status, 404);

  const comRegra = await criar("Com regra"), comOrcamento = await criar("Com orçamento"), comLanc = await criar("Com lançamento");
  const regra = (await chamar("POST", "/api/regras", { padrao: "texto que não existe", categoria_id: comRegra })).d.regra.id;
  await chamar("PUT", "/api/orcamento", { mes: "2018-01", categoria_id: comOrcamento, valor_centavos: 100 });
  novoLanc(conta, "2018-01-01", -100, comLanc, { status: "REMOVIDO", categoria_manual: 1 }); // não soma, mas aponta para ela
  for (const [id, tabela] of [[comRegra, "regras"], [comOrcamento, "orcamentos"], [comLanc, "lancamentos"]] as const) {
    const r = await apagar(id);
    assert.deepEqual([r.status, n(tabela, id), (await uma(id)).usos], [409, 1, 1], tabela);
  }

  // o mapa da Pluggy e os movimentos internos acham estas pelo nome
  assert.equal((await uma(TRANSFERENCIA)).fixa, true);
  for (const id of [MERCADO, RENDA, TRANSFERENCIA]) {
    assert.equal((await apagar(id)).status, 409);
    assert.equal((await chamar("PATCH", `/api/categorias/${id}`, { nome: "Outro nome" })).status, 409);
  }
  const { nome } = await uma(MERCADO);
  assert.equal((await chamar("PATCH", `/api/categorias/${MERCADO}`, { nome, cor: "#4fd1a5" })).status, 200); // mesmo nome: só a cor muda
  assert.equal((await chamar("PATCH", `/api/categorias/${comRegra}`, { nome: "Renomeada" })).d.nome, "Renomeada");

  db.prepare("DELETE FROM lancamentos WHERE categoria_id = ?").run(comLanc);
  db.prepare("DELETE FROM orcamentos WHERE categoria_id = ?").run(comOrcamento);
  await chamar("DELETE", `/api/regras/${regra}`);
  for (const id of [comRegra, comOrcamento, comLanc]) assert.equal((await apagar(id)).status, 200);
});

test("mesclar categoria: leva lançamentos e regras, mantém a edição manual, o orçamento do destino e o total do mês", async () => {
  const conta = novaConta("BANK"), cartao = novaConta("CREDIT");
  const criar = async (nome: string, grupo: string) => (await chamar("POST", "/api/categorias", { nome, grupo })).d.id as number;
  const mesclar = (de: number, destino: number) => chamar("POST", `/api/categorias/${de}/mesclar`, { destino });
  const de = await criar("Origem", "financeiro"), para = await criar("Destino", "essencial"); // grupos diferentes, os dois são gasto
  const regra = (await chamar("POST", "/api/regras", { padrao: "quitanda", categoria_id: de })).d.regra.id;
  novoLanc(conta, "2018-02-01", -1000, de, { descricao_original: "Quitanda 1", regra_id: regra });
  novoLanc(conta, "2018-02-02", -300, de, { descricao_original: "feira", categoria_manual: 1 });
  novoLanc(cartao, "2018-02-03", 200, de, { descricao_original: "estorno", categoria_manual: 1 });
  novoLanc(conta, "2018-02-04", -50, para, { descricao_original: "já era do destino", categoria_manual: 1 });
  const orcar = (categoria_id: number, valor_centavos: number) => chamar("PUT", "/api/orcamento", { mes: "2018-02", categoria_id, valor_centavos });
  await orcar(de, 111);
  await orcar(para, 222);
  const totais = async () => (({ entradas, saidas, pendentes }) => [entradas, saidas, pendentes])((await chamar("GET", "/api/resumo?mes=2018-02")).d);
  const lancs = () => db.prepare("SELECT categoria_id AS c, categoria_manual AS m FROM lancamentos WHERE data LIKE '2018-02-%' ORDER BY data").all().map((l: any) => [l.c, l.m]);
  const antes = await totais();
  assert.deepEqual(antes, [0, 1150, 0]);

  // recusas: nada muda
  const recusadas = [await mesclar(de, RENDA), await mesclar(de, TRANSFERENCIA), await mesclar(MERCADO, para), await mesclar(de, de)];
  assert.deepEqual(recusadas.map((r) => r.status), [409, 409, 409, 409]);
  assert.deepEqual([(await mesclar(de, 9999)).status, (await mesclar(9999, para)).status, (await chamar("POST", `/api/categorias/${de}/mesclar`, {})).status], [404, 404, 400]);
  assert.deepEqual(lancs(), [[de, 0], [de, 1], [de, 1], [para, 1]]);

  const r = await mesclar(de, para);
  assert.deepEqual([r.status, r.d.lancamentos, r.d.regras], [200, 3, 1]);
  assert.deepEqual(lancs(), [[para, 0], [para, 1], [para, 1], [para, 1]]);
  assert.deepEqual(await totais(), antes);
  reaplicarRegras(); // a regra foi junto: reaplicar não desfaz
  assert.deepEqual(lancs(), [[para, 0], [para, 1], [para, 1], [para, 1]]);
  assert.ok(!(await chamar("GET", "/api/categorias")).d.some((c: any) => c.id === de));
  const linha = (await chamar("GET", "/api/orcamento?mes=2018-02")).d.linhas.find((l: any) => l.categoria_id === para);
  assert.deepEqual([linha.planejado, linha.realizado], [222, 1150]);
  await chamar("DELETE", `/api/regras/${regra}`);
});

test("regra por sentido e por conta: só pega o seu lado, convive com o mesmo texto e a prévia bate com o aplicado", async () => {
  const a = novaConta("BANK"), b = novaConta("BANK");
  for (const [conta, valor] of [[a, -100], [a, -200], [a, 300], [b, -400], [b, 500]] as const)
    novoLanc(conta, "2017-01-01", valor, null, { descricao_original: "Pix Fulana Loja" });
  const cats = () => db.prepare("SELECT categoria_id AS c FROM lancamentos WHERE data = '2017-01-01' ORDER BY abs(valor_centavos)").all().map((l: any) => l.c);
  /** Cria a regra conferindo que a prévia contou o mesmo que mudou (só vale quando nenhuma outra regra disputa os lançamentos). */
  const criar = async (padrao: string, categoria_id: number, extra: Record<string, string> = {}, confere = false) => {
    const previa = (await chamar("GET", `/api/regras/previa?${new URLSearchParams({ padrao, ...extra })}`)).d;
    const r = await chamar("POST", "/api/regras", { padrao, categoria_id, ...extra });
    assert.equal(r.status, 200);
    if (confere) assert.equal(r.d.recategorizados, previa.total);
    return { ...r.d.regra, total: previa.total } as { id: number; total: number; categoria_id: number };
  };

  const saida = await criar("pix fulana", 9, { sentido: "saida" }, true);
  assert.deepEqual([saida.total, cats()], [3, [9, 9, null, 9, null]]);
  const entrada = await criar("PIX FULANA", 18, { sentido: "entrada" }, true); // mesmo texto, outro sentido: convive
  assert.notEqual(entrada.id, saida.id);
  assert.deepEqual([entrada.total, cats()], [2, [9, 9, 18, 9, 18]]);

  // mesmo texto, para tudo: existe, mas perde para as que têm sentido; repetir troca a categoria em vez de duplicar
  const geral = await criar("pix fulana", 21);
  assert.deepEqual([geral.total, cats()], [5, [9, 9, 18, 9, 18]]);
  const repetida = await criar("Pix Fulana", 11);
  assert.deepEqual([repetida.id, repetida.categoria_id], [geral.id, 11]);
  assert.equal((await criar("pix fulana", 13, { sentido: "saida" })).id, saida.id);
  assert.deepEqual(cats(), [13, 13, 18, 13, 18]);

  // por conta: só a conta b; e com sentido e conta juntos
  const daB = await criar("pix fulana", 8, { conta_id: b });
  assert.deepEqual([daB.total, cats()], [2, [13, 13, 18, 8, 8]]);
  const daBsaida = await criar("pix fulana", 3, { conta_id: b, sentido: "saida" });
  assert.deepEqual([daBsaida.total, cats()], [1, [13, 13, 18, 3, 8]]);
  // texto mais longo vence, mesmo sem sentido: regra antiga e específica não perde para uma nova e curta
  const longa = await criar("pix fulana loja", 10);
  assert.deepEqual(cats(), [10, 10, 10, 10, 10]);

  assert.equal((await chamar("POST", "/api/regras", { padrao: "pix fulana", categoria_id: 3, sentido: "x" })).status, 400);
  assert.equal((await chamar("POST", "/api/regras", { padrao: "pix fulana", categoria_id: 3, conta_id: ITEM2 })).status, 400); // conta que não existe
  const lista = (await chamar("GET", "/api/regras")).d.filter((r: any) => /^pix fulana$/i.test(r.padrao));
  assert.equal(lista.length, 5);
  assert.match(lista.find((r: any) => r.id === daB.id).conta, /^conta /);
  for (const r of [...lista, longa]) await chamar("DELETE", `/api/regras/${r.id}`);
  assert.deepEqual(cats(), [null, null, null, null, null]);
  db.prepare("DELETE FROM lancamentos WHERE data = '2017-01-01'").run();
});

test("migração das regras: mesmas regras com os mesmos ids, valendo para tudo, e sem duplicar", () => {
  const m = new DatabaseSync(":memory:");
  m.exec("PRAGMA foreign_keys = ON");
  const ANTES = 4; // versão da base antes de sentido e conta
  MIGRACOES.slice(0, ANTES).forEach((sql) => m.exec(sql));
  m.exec(`INSERT INTO regras (id, padrao, categoria_id, descricao, prioridade, criado_em) VALUES
    (3, 'Uber', 4, NULL, 50, '2026-01-01'), (27, 'água', 2, 'Água', 90, '2026-02-02');
    INSERT INTO conexoes (item_id) VALUES ('i'); INSERT INTO contas (id, item_id) VALUES ('c', 'i');
    INSERT INTO lancamentos (id, conta_id, data, valor_centavos, regra_id) VALUES ('l', 'c', '2026-01-01', -1, 27)`);
  const colunas = "id, padrao, categoria_id, descricao, prioridade, criado_em";
  const ver = () => JSON.stringify(m.prepare(`SELECT ${colunas} FROM regras ORDER BY id`).all());
  const antes = ver();
  m.exec("BEGIN");
  m.exec(MIGRACOES[ANTES]);
  m.exec("COMMIT");
  assert.equal(ver(), antes);
  assert.equal((m.prepare("SELECT COUNT(*) AS n FROM regras WHERE sentido IS NULL AND conta_id IS NULL").get() as { n: number }).n, 2);
  assert.ok(m.prepare("SELECT 1 FROM lancamentos l JOIN regras r ON r.id = l.regra_id").get());
  assert.throws(() => m.exec("INSERT INTO regras (padrao, categoria_id) VALUES ('UBER', 4)"), /UNIQUE/);
  m.exec("INSERT INTO regras (padrao, categoria_id, sentido) VALUES ('UBER', 4, 'saida')");
  assert.throws(() => m.exec("INSERT INTO regras (padrao, categoria_id, sentido) VALUES ('uber', 4, 'saida')"), /UNIQUE/);
  assert.equal((m.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
  m.close();
});

test("Pix no crédito: o gasto é a cobrança no cartão; as duas pernas da conta saem juntas e o resultado do mês não muda", async () => {
  const conta = novaConta("BANK"), cartao = novaConta("CREDIT"), oculto = novaConta("CREDIT", { oculta: 1 }), outroBanco = novaConta("CREDIT", { item: ITEM2 });
  let n = 0;
  type Extra = Record<string, string | number>;
  /** Insere as três pernas com o horário real: o Pix 0,5 s antes do "Valor adicionado" e a cobrança 3 s depois. */
  const operacao = (hora: string, valor: number, o: { pix?: Extra; cobranca?: Extra | null; cartao?: string; tarifa?: number; parcelas?: number } = {}) => {
    const t = Date.parse(hora), id = `pix${++n}`;
    const perna = (sufixo: string, c: string, ms: number, v: number, extra: Extra, compra?: object) =>
      novoLanc(c, hora.slice(0, 10), v, null, { id: id + sufixo, bruto: JSON.stringify({ date: new Date(ms).toISOString(), ...compra }), ...extra });
    perna("e", conta, t, valor, { descricao_original: "Valor adicionado na conta por cartão de crédito | Valor adicionado para PIX no Crédito", categoria_pluggy: "Transfer - Internal" });
    perna("s", conta, t - 500, -valor, { descricao_original: "Transferência enviada|Fulano", categoria_pluggy: "Transfers", ...o.pix });
    if (o.cobranca !== null) {
      const total = o.parcelas ?? 1, compra = total > 1 ? { creditCardMetadata: { purchaseDate: new Date(t + 3000).toISOString() } } : undefined;
      for (let p = 1; p <= total; p++)
        perna(p > 1 ? `c${p}` : "c", o.cartao ?? cartao, t + 3000 + (p - 1) * 31 * 86_400_000, -Math.round((valor * (o.tarifa ?? 1.03)) / total),
          { descricao_original: "Pagamento de pix", categoria_pluggy: "Transfer - PIX", ...(total > 1 && { parcela: p, total_parcelas: total }), ...o.cobranca }, compra);
    }
    return id;
  };
  const nome = (id: string) => (db.prepare("SELECT c.nome FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id WHERE l.id = ?").get(id) as { nome: string | null }).nome;
  const pernas = (id: string) => ["e", "s", "c"].map((s) => nome(id + s));
  const mes = async (m: string) => (({ entradas, saidas }) => [entradas, saidas, entradas - saidas])((await chamar("GET", `/api/resumo?mes=${m}`)).d);
  const FORA = "Transferência entre contas", manual = (categoria_id: number) => ({ categoria_id, categoria_manual: 1 });

  const regra = (await chamar("POST", "/api/regras", { padrao: "beltrana xyz", categoria_id: 7 })).d.regra.id; // antes das operações: criar regra reaplica tudo
  // cada formato de cobrança num mês, para o total do mês mostrar só aquela operação
  const semNome = operacao("2016-01-10T12:00:00Z", 10000, { pix: { categoria_pluggy: "Groceries" } });
  const nomeSemCategoria = operacao("2016-02-10T23:59:59Z", 10000, { pix: { categoria_pluggy: "Healthcare" }, cobranca: { descricao_original: "Fulano", data: "2016-02-11" } });
  const nomeComCategoria = operacao("2016-03-10T12:00:00Z", 10000, { pix: { categoria_pluggy: "Internet" }, cobranca: { descricao_original: "Fulano", categoria_pluggy: "Digital services" } });
  const porRegra = operacao("2016-04-10T12:00:00Z", 10000, { pix: { descricao_original: "Transferência enviada|Beltrana XYZ" }, cobranca: { descricao_original: "Beltrana XYZ", categoria_pluggy: "Transfers" } });
  const parcelada = operacao("2016-05-10T12:00:00Z", 10000, { pix: { categoria_pluggy: "Groceries" }, parcelas: 2, tarifa: 1.1 });
  db.prepare("UPDATE lancamentos SET data = '2016-06-10' WHERE id = ?").run(`${parcelada}c2`);
  // mesmo valor, mesmo dia: cada cobrança herda do seu Pix
  const gemeas = [operacao("2016-07-10T10:00:00Z", 10000, { pix: { categoria_pluggy: "Healthcare" } }), operacao("2016-07-10T13:00:00Z", 10000, { pix: { categoria_pluggy: "Groceries" } })];
  const cobrancaManual = operacao("2016-08-10T12:00:00Z", 10000, { pix: { categoria_pluggy: "Groceries" }, cobranca: manual(13) });
  // não mexe: sem cobrança, em cartão oculto ou de outro banco, valor que não bate, perna editada, ignorada ou já fora do resumo
  const intocadas = [
    operacao("2016-09-01T12:00:00Z", 10000, { cobranca: null }),
    operacao("2016-09-02T12:00:00Z", 10000, { cartao: oculto }),
    operacao("2016-09-03T12:00:00Z", 10000, { cartao: outroBanco }),
    operacao("2016-09-04T12:00:00Z", 10000, { tarifa: 0.9 }),
    operacao("2016-09-05T12:00:00Z", 10000, { pix: manual(7) }),
    operacao("2016-09-06T12:00:00Z", 10000, { pix: { ignorado: 1 } }),
    operacao("2016-09-07T12:00:00Z", 10000, { cobranca: { ignorado: 1 } }),
    operacao("2016-09-08T12:00:00Z", 10000, { cobranca: manual(TRANSFERENCIA) }),
    operacao("2016-09-09T12:00:00Z", 10000, { pix: { categoria_pluggy: "Same person transfer", categoria_id: TRANSFERENCIA } }),
    operacao("2016-09-10T12:00:00Z", 10000, { cobranca: { status: "REMOVIDO" } }),
  ];
  const meses = ["2016-01", "2016-02", "2016-03", "2016-04", "2016-05", "2016-06", "2016-07", "2016-08", "2016-09"];
  const antes = await Promise.all(meses.map(mes)); // recém-inseridas: as três pernas contando

  await sincronizar(ITEM2); // a sincronização também resolve
  assert.deepEqual(pernas(semNome), [FORA, FORA, "Mercado"]);
  assert.deepEqual(pernas(nomeSemCategoria), [FORA, FORA, "Saúde"]);
  assert.deepEqual(pernas(nomeComCategoria), [FORA, FORA, "Assinaturas"]);
  assert.deepEqual(pernas(porRegra), [FORA, FORA, "Educação"]); // a regra pega o Pix e a cobrança: antes o gasto dobrava
  assert.deepEqual([lanc(`${porRegra}s`).regra_id, lanc(`${porRegra}c`).regra_id], [null, regra]);
  assert.deepEqual([...pernas(parcelada), nome(`${parcelada}c2`)], [FORA, FORA, "Mercado", "Mercado"]);
  assert.deepEqual(gemeas.map(pernas), [[FORA, FORA, "Saúde"], [FORA, FORA, "Mercado"]]);
  assert.deepEqual(pernas(cobrancaManual), [FORA, FORA, "Lazer"]);
  for (const id of intocadas) assert.equal(nome(`${id}e`), null, id);
  assert.deepEqual(pernas(intocadas[4]), [null, "Educação", null]);

  const depois = await Promise.all(meses.map(mes));
  assert.deepEqual(depois.map((m) => m[2]), antes.map((m) => m[2])); // resultado igual em todos os meses
  assert.deepEqual([antes[0], depois[0]], [[10000, 20300, -10300], [0, 10300, -10300]]);
  assert.deepEqual([depois[4], depois[5]], [[0, 5500, -5500], [0, 5500, -5500]]); // tarifa e parcela no mês de cada uma
  assert.equal(reaplicarRegras(), 0); // de novo: nada muda e nada conta
  await chamar("DELETE", `/api/regras/${regra}`);
  db.prepare("DELETE FROM lancamentos WHERE id LIKE 'pix%'").run();
});

test("filtro de conta: uma, só contas ou só cartões", async () => {
  const banco = novaConta("BANK"), cartao = novaConta("CREDIT");
  for (const [id, conta] of [["fc-banco", banco], ["fc-cartao", cartao]]) novoLanc(conta, "2014-02-10", -100, null, { id });
  const filtrados = async (conta: string) => {
    const { itens, total } = (await chamar("GET", `/api/lancamentos?mes=2014-02&conta=${conta}`)).d;
    assert.equal(total, itens.length);
    return itens.map((l: any) => l.id).sort();
  };
  assert.deepEqual(await filtrados("contas"), ["fc-banco"]);
  assert.deepEqual(await filtrados("cartoes"), ["fc-cartao"]);
  assert.deepEqual(await filtrados(banco), ["fc-banco"]);
  assert.equal((await chamar("GET", "/api/lancamentos?conta=xyz")).status, 400);
});

test("estorno: o filtro acha só os créditos de cartão e as compras candidatas vêm na ordem certa", async () => {
  const cartao = novaConta("CREDIT"), outro = novaConta("CREDIT"), banco = novaConta("BANK");
  const por = (id: string, conta: string, data: string, valor: number, categoria: number | null, texto: string, extra: Record<string, string | number> = {}) =>
    novoLanc(conta, data, valor, categoria, { id, descricao_original: texto, descricao: texto, categoria_manual: 1, ...extra });
  por("est", cartao, "2015-06-30", 5000, 11, "Estorno Loja Azul");
  por("est-transf", cartao, "2015-06-30", 5000, TRANSFERENCIA, "Pagamento recebido");
  por("est-ign", cartao, "2015-06-30", 5000, 11, "x", { ignorado: 1 });
  por("est-rem", cartao, "2015-06-30", 5000, 11, "x", { status: "REMOVIDO" });
  por("est-sem", cartao, "2015-06-29", 999900, null, "Crédito sem categoria");
  por("pix", banco, "2015-06-30", 5000, 11, "Pix recebido");
  const filtrados = async (q: string) => { const { itens, total } = (await chamar("GET", `/api/lancamentos?estornos=1${q}`)).d; assert.equal(total, itens.length); return itens.map((l: any) => l.id); };
  assert.deepEqual(await filtrados("&mes=2015-06"), ["est", "est-sem"]);
  assert.ok((await filtrados("")).includes("est")); // sem mês = todos

  por("parcial-velha", cartao, "2015-03-10", -9000, 10, "Loja Azul");
  por("parcial-nova", cartao, "2015-06-20", -8000, 13, "Padaria");
  por("parcial-azul", cartao, "2015-05-01", -9900, 10, "LOJA AZUL *123");
  por("igual", cartao, "2015-04-01", -5000, null, "Outra");
  por("igual-azul", cartao, "2015-03-20", -5000, 10, "Loja Azul");
  por("menor", cartao, "2015-06-25", -4999, 10, "Loja Azul");
  por("outro-cartao", outro, "2015-06-25", -5000, 10, "Loja Azul");
  por("antiga", cartao, "2015-03-01", -5000, 10, "Loja Azul"); // 121 dias antes
  por("no-prazo", cartao, "2015-03-02", -5001, 13, "Outra"); // 120 dias antes: entra, mas fica fora das 5
  por("depois", cartao, "2015-07-01", -5000, 10, "Loja Azul");
  por("removida", cartao, "2015-06-25", -5000, 10, "Loja Azul", { status: "REMOVIDO" });
  const compras = async (id: string) => (await chamar("GET", `/api/lancamentos/${id}/compras`)).d.map((l: any) => l.id);
  assert.deepEqual(await compras("est"), ["igual-azul", "igual", "parcial-azul", "parcial-velha", "parcial-nova"]);
  db.prepare("DELETE FROM lancamentos WHERE id IN ('parcial-nova', 'parcial-velha')").run();
  assert.deepEqual(await compras("est"), ["igual-azul", "igual", "parcial-azul", "no-prazo"]);
  assert.deepEqual(await compras("est-sem"), []);

  assert.equal((await chamar("GET", "/api/lancamentos/igual/compras")).status, 400); // compra
  assert.equal((await chamar("GET", "/api/lancamentos/pix/compras")).status, 400); // entrada em conta
  assert.equal((await chamar("GET", "/api/lancamentos/nao-existe/compras")).status, 404);
  db.prepare("DELETE FROM lancamentos WHERE data LIKE '2015-%'").run();
});

test("planejado vale dali em diante e não mexe no passado", async () => {
  const planejado = async (mes: string) =>
    (await chamar("GET", `/api/orcamento?mes=${mes}`)).d.linhas.find((l: any) => l.categoria_id === MERCADO).planejado;
  const por = (mes: string, valor_centavos: number, categoria_id = MERCADO) => chamar("PUT", "/api/orcamento", { mes, categoria_id, valor_centavos });
  await por("2020-02", 40000);
  assert.deepEqual([await planejado("2020-01"), await planejado("2020-02"), await planejado("2021-01")], [null, 40000, 40000]);
  await por("2020-04", 50000);
  assert.deepEqual([await planejado("2020-03"), await planejado("2020-04")], [40000, 50000]);
  await por("2020-04", 0); // apagar no campo = sem orçamento daqui em diante
  assert.deepEqual([await planejado("2020-03"), await planejado("2020-05")], [40000, 0]);
  assert.equal((await por("2020-04", -1)).status, 400);
  assert.equal((await por("2020-13", 1)).status, 400);
  assert.equal((await por("2020-04", 1, 9999)).status, 400);
});

test("patrimônio: contas + investimentos + bens − cartões e dívidas, sem oculta, resgatado nem a outra pessoa", async () => {
  const ver = async (pessoa = "PF") => (await chamar("GET", `/api/patrimonio?pessoa=${pessoa}`)).d;
  const ITEM3 = "44444444-4444-4444-8444-444444444444";
  db.prepare("INSERT INTO conexoes (item_id) VALUES (?)").run(ITEM3);
  const investir = (id: string, item: string, saldo: number, status: string) =>
    db.prepare("INSERT INTO investimentos (id, item_id, saldo_centavos, bruto) VALUES (?,?,?,?)").run(id, item, saldo, JSON.stringify({ status }));
  const corrente = novaConta("BANK", { saldo: 100000 });
  novaConta("BANK", { saldo: -20000 }); // cheque especial
  novaConta("CREDIT", { saldo: 30000 }); // limite usado: dívida
  const oculta = novaConta("BANK", { saldo: 999, oculta: 1 });
  novaConta("BANK", { saldo: 5000, pessoa: "PJ", item: ITEM3 });
  investir("cdb", ITEM, 70000, "ACTIVE");
  investir("resgatado", ITEM, 999, "TOTAL_WITHDRAWAL");
  investir("cdb-pj", ITEM3, 1000, "ACTIVE"); // banco só com conta PJ
  const carro = (await chamar("POST", "/api/bens", { nome: "Carro", valor_centavos: 500000, pessoa: "PF" })).d;
  await chamar("POST", "/api/bens", { nome: "Financiamento", valor_centavos: -200000, pessoa: "PF" });

  const p = await ver();
  assert.deepEqual([p.contas, p.investimentos, p.bens, p.dividas, p.total], [80000, 70000, 500000, 230000, 420000]);
  assert.equal((await ver("PJ")).total, 6000);

  const ed = await chamar("PATCH", `/api/bens/${carro.id}`, { valor_centavos: 450000 });
  assert.deepEqual([ed.d.nome, ed.d.valor_centavos], ["Carro", 450000]);
  assert.equal((await ver()).total, 370000);
  assert.equal((await chamar("PATCH", "/api/bens/9999", { nome: "x" })).status, 404);
  assert.equal((await chamar("POST", "/api/bens", { nome: " ", valor_centavos: 1, pessoa: "PF" })).status, 400);

  // uma foto por dia, a última vale; conta oculta é fotografada mas não soma
  await sincronizar(ITEM2);
  db.prepare("UPDATE contas SET saldo_centavos = 110000 WHERE id = ?").run(corrente);
  await sincronizar(ITEM2);
  const fotos = (ref: string) => db.prepare("SELECT saldo_centavos FROM saldos_diarios WHERE ref_id = ?").all(ref) as { saldo_centavos: number }[];
  assert.deepEqual(fotos(corrente).map((f) => f.saldo_centavos), [110000]);
  assert.equal(fotos(oculta).length, 1);
  assert.equal(fotos("resgatado").length, 0);

  const foto = db.prepare("INSERT INTO saldos_diarios (data, origem, ref_id, saldo_centavos) VALUES ('2020-01-01', ?, ?, ?)");
  foto.run("conta", corrente, 90000);
  foto.run("conta", oculta, 999);
  foto.run("investimento", "resgatado", 5000); // já valeu: continua no passado
  const { historico, total } = await ver();
  assert.deepEqual([historico.length, historico[0], historico[1].total], [2, { data: "2020-01-01", total: 95000 }, total]);

  await chamar("DELETE", `/api/bens/${carro.id}`);
  assert.equal((await ver()).lista_bens.length, 1);
  assert.equal(fotos(String(carro.id)).length, 0);
});

const g = (descricao_original: string, data: string, valor: number, status = "POSTED", conta = "c1") =>
  ({ data, valor, descricao_original, descricao: descricao_original, categoria: null, cor: null, conta, status });

test("recorrentes: mensal com aumento é achada; parcela, compra frequente e o que não se repete, não", () => {
  const netflix = [g("Netflix.com 01", "2026-01-10", 3990), g("NETFLIX.COM", "2026-02-10", 3990), g("Netflix.com", "2026-03-10", 4490), g("Netflix.com", "2026-04-11", 4490)];
  const outros = [
    ...["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"].map((d, i) => g(`Loja ${i + 1}/4`, d, 10000)),
    ...["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"].map((d) => g("Padaria", d, 2000)),
    ...["2026-01-02", "2026-02-02", "2026-03-02"].map((d, i) => g("Pix Fulano", d, 1000 * 3 ** i)), // valores bem diferentes
    g("Uma vez", "2026-04-01", 500),
  ];
  const ver = (hoje: string, decisoes: any[] = []) => detectarRecorrentes([...netflix, ...outros].sort((a, b) => (a.data < b.data ? -1 : 1)), hoje, decisoes);
  const [n, ...resto] = ver("2026-04-20");
  assert.equal(resto.length, 0);
  assert.deepEqual([n.chave, n.valor, n.vezes, n.ultima, n.proxima, n.situacao], ["netflix com", 4490, 4, "2026-04-11", "2026-05-11", "prevista"]);
  assert.equal(ver("2026-05-15")[0].situacao, "atrasada");
  assert.equal(ver("2026-07-01").length, 0); // parada só aparece se foi decidida
  assert.equal(ver("2026-07-01", [{ chave: "netflix com", valor: 0, status: "confirmada", proposta: null, decidido_em: "2026-04-20 10:00:00" }])[0].situacao, "parada");
  assert.deepEqual(["2026-01-31", "2026-12-15", "2028-01-30"].map(mesSeguinte), ["2026-02-28", "2027-01-15", "2028-02-29"]);
});

test("recorrentes: troca de nome, forma de pagamento, várias no mesmo lugar e mês pulado; compra repetida por acaso não", () => {
  const ver = (gs: ReturnType<typeof g>[], decisoes: any[] = [], hoje = "2026-06-20") =>
    detectarRecorrentes([...gs].sort((a, b) => (a.data < b.data ? -1 : 1)), hoje, decisoes);
  const linhas = (gs: ReturnType<typeof g>[], decisoes: any[] = [], hoje?: string) =>
    ver(gs, decisoes, hoje).map((r) => [r.valor, r.vezes, r.situacao, r.status]).sort((a, b) => Number(a[0]) - Number(b[0]));
  const todoDia = (nome: string, dia: string, valores: number[], mes = 1) => valores.map((v, i) => g(nome, `2026-0${mes + i}-${dia}`, v));
  const decisao = (nome: string, valor: number, status: string, decidido_em = "2026-06-01 10:00:00", proposta: string | null = null) =>
    ({ chave: chaveDe(nome), valor, status, proposta, decidido_em });

  // o lojista trocou o nome (um contém o outro): não fica atrasada, e a linha diz como era
  const nuvem = [...todoDia("Nuvem Um", "10", [2200, 2200, 2200, 2200, 2200]), g("Nuvem Brasil*Nuvem Um 7x", "2026-06-10", 2200, "PENDING")];
  const [n, ...outras] = ver(nuvem);
  assert.equal(outras.length, 0);
  assert.deepEqual([n.antes, n.vezes, n.situacao, n.proxima], ["Nuvem Um", 6, "prevista", "2026-07-10"]);
  // a chave vem da última lançada: a pendente pode voltar com outra descrição e a decisão continua valendo
  assert.deepEqual([n.chave, n.valor_chave], ["nuvem um", 2200]);
  const voltou = [...nuvem.slice(0, -1), g("Nuvem Um Brasil", "2026-06-10", 2200)];
  assert.equal(ver(voltou, [decisao("Nuvem Um", 2200, "cancelada")])[0].status, "cancelada");
  // outra conta, nome contido: não é a mesma
  assert.equal(ver([...nuvem.slice(0, -1), g("Nuvem Nuvem*Um", "2026-06-10", 2200, "POSTED", "c2")])[0].situacao, "atrasada");

  // boleto num mês, Pix no outro, e um mês pulado
  const luz = [g("Pagamento de conta LUZ FORTE S.A.", "2026-01-12", 10000), g("Pagamento com Pix LUZ FORTE SA", "2026-02-13", 14000),
    g("Pagamento de conta LUZ FORTE S.A.", "2026-04-13", 9000), g("Pix enviado Luz Forte", "2026-05-15", 9500), g("Pagamento com QR Pix LUZ FORTE SA", "2026-06-12", 9500)];
  assert.deepEqual(linhas(luz), [[9500, 5, "prevista", null]]);

  // três cobranças no mesmo lugar, uma linha para cada; a decisão antiga vale para todas, a nova só para a dela
  const plano = [...todoDia("Plano Pet", "06", [5000, 5000, 5000, 5000, 5000, 5000]), ...todoDia("Plano Pet", "13", [9100, 9100, 9100, 9100, 9100, 9100]),
    ...todoDia("Plano Pet", "25", [5300, 5300, 5300, 5300, 5300])];
  assert.deepEqual(linhas(plano), [[5000, 6, "prevista", null], [5300, 5, "prevista", null], [9100, 6, "prevista", null]]);
  assert.deepEqual(linhas(plano, [decisao("Plano Pet", 0, "confirmada"), decisao("Plano Pet", 5300, "cancelada")]).map((l) => l[3]), ["confirmada", "cancelada", "confirmada"]);
  // a cobrança que acabou não fica na lista por causa do nome, se outra do mesmo lugar continua; decidida, fica
  const acabou = [...plano.slice(0, 12), ...todoDia("Plano Pet", "25", [5300, 5300, 5300])];
  assert.deepEqual(linhas(acabou, [decisao("Plano Pet", 0, "confirmada")]).map((l) => l[0]), [5000, 9100]);
  assert.deepEqual(linhas(acabou, [decisao("Plano Pet", 5300, "cancelada")]).map((l) => l[0]), [5000, 5300, 9100]);

  // duas com o mesmo nome: uma troca de plano (aumento grande) e de nome, a outra para
  const treino = [...todoDia("Treino", "15", [10000, 10000, 10000]), g("Treino", "2026-01-16", 12000), ...todoDia("Treino Academias", "16", [12000, 12000, 18000, 18000], 2)];
  assert.deepEqual(linhas(treino, [], "2026-05-20").map((l) => [l[0], l[1]]), [[18000, 5]]);

  // compra repetida que forma série por acaso só aparece se foi confirmada
  const farmacia = [...todoDia("Farmacia", "05", [9000, 9000, 9000, 9000, 9000, 9000]),
    ...["01-09", "01-30", "02-02", "02-21", "03-29", "04-17", "05-03", "06-01", "06-03"].map((d, i) => g("Farmacia", `2026-${d}`, 900 * 3 ** (i % 3)))];
  assert.equal(ver(farmacia).length, 0);
  assert.equal(ver(farmacia, [decisao("Farmacia", 9000, "ignorada")]).length, 0);
  assert.deepEqual(linhas(farmacia, [decisao("Farmacia", 9000, "confirmada")]).map((l) => [l[0], l[3]]), [[9000, "confirmada"]]);

  // cobrou depois de cancelada: conta da data da decisão, pelo mesmo nome e valor parecido, fora das outras ativas, por 45 dias
  const clube = todoDia("Clube", "03", [3000, 3000, 3000, 3000, 3000, 3300]);
  const cobrou = (em: string, gs = clube, hoje?: string) => ver(gs, [decisao("Clube", 3000, "cancelada", `${em} 09:00:00`)], hoje)[0].cobrou_depois;
  assert.deepEqual(cobrou("2026-06-01"), { data: "2026-06-03", valor: 3300 });
  assert.equal(cobrou("2026-06-03"), null); // a do próprio dia já estava lá
  assert.equal(cobrou("2026-06-01", clube, "2026-07-30"), null);
  assert.deepEqual(cobrou("2026-05-20", [...clube.slice(0, 5), g("Clube", "2026-06-19", 3150)]), { data: "2026-06-19", valor: 3150 }); // fora da época
  assert.equal(cobrou("2026-05-20", [...clube.slice(0, 5), g("Clube", "2026-06-19", 15000)]), null); // outro valor: compra avulsa
  assert.equal(ver(plano, [decisao("Plano Pet", 5300, "cancelada", "2026-06-01 09:00:00")]).find((r) => r.valor === 5300)!.cobrou_depois, null); // as outras do lugar continuam
});

test("recorrentes: usa os filtros do resumo, ignora futuro e parcela, e guarda a decisão", async () => {
  const conta = novaConta("CREDIT");
  const serie = (nome: string, categoria: number | null, extra: Record<string, string | number> = {}) =>
    [95, 65, 35, 5].forEach((d) => novoLanc(conta, dia(-d), -1990, categoria, { descricao_original: nome, descricao: nome, ...extra }));
  serie("Spotify", 12);
  serie("Fatura", TRANSFERENCIA);
  serie("Sofa", 11, { total_parcelas: 10 });
  serie("Apagado", 12, { status: "REMOVIDO" });
  serie("Ignorado", 12, { ignorado: 1 });
  [10, 40, 70].forEach((d) => novoLanc(conta, dia(d), -500, 12, { descricao_original: "Futuro" }));
  const ver = async () => (await chamar("GET", "/api/recorrentes")).d as { chave: string; status: string | null; proposta: string | null; valor: number }[];
  assert.deepEqual((await ver()).map((r) => [r.chave, r.valor, r.status]), [["spotify", 1990, null]]);
  const spotify = { chave: "spotify", valor: 1990 };
  for (const status of ["confirmada", "ignorada", "cancelada", null]) {
    assert.equal((await chamar("PUT", "/api/recorrentes", { ...spotify, status })).status, 200);
    assert.equal((await ver())[0].status, status);
  }
  for (const ruim of [{ ...spotify, status: "x" }, { chave: "spotify", status: "ignorada" }, { ...spotify, valor: 0, status: "ignorada" }])
    assert.equal((await chamar("PUT", "/api/recorrentes", ruim)).status, 400);
  assert.equal((await chamar("PUT", "/api/recorrentes", { ...spotify, valor: 5, status: "ignorada" })).status, 404);

  // proposta não decide; aceitar ou recusar é o PUT da tela
  const propor = (status: string | null) => chamar("POST", "/api/recorrentes/propostas", { ...spotify, status });
  const agora = async () => (await ver()).map((r) => [r.status, r.proposta]);
  assert.equal((await propor("ignorada")).status, 200);
  assert.deepEqual(await agora(), [[null, "ignorada"]]);
  await chamar("PUT", "/api/recorrentes", { ...spotify, status: null }); // recusa
  assert.deepEqual(await agora(), [[null, null]]);
  await propor("confirmada");
  await chamar("PUT", "/api/recorrentes", { ...spotify, status: "confirmada" }); // aceita
  assert.deepEqual(await agora(), [["confirmada", null]]);
  assert.equal((await propor("confirmada")).status, 409);
  assert.equal((await propor("x")).status, 400);

  // a data da decisão é a da última mudança, não a da primeira: cobrança anterior ao cancelamento não vira aviso
  const decididaHa10Dias = () => db.prepare("UPDATE recorrencias SET decidido_em = ? WHERE chave = 'spotify'").run(`${dia(-10)} 10:00:00`);
  const linhaDe = () => db.prepare("SELECT * FROM recorrencias WHERE chave = 'spotify'").all() as { valor_centavos: number; status: string; decidido_em: string }[];
  const avisos = async () => (await chamar("GET", "/api/ritmo")).d.canceladas_cobradas;
  decididaHa10Dias(); // confirmada antes da cobrança de 5 dias atrás
  await chamar("PUT", "/api/recorrentes", { ...spotify, status: "cancelada" });
  assert.ok(linhaDe()[0].decidido_em > dia(-2));
  assert.deepEqual(await avisos(), []);
  // cancelada há 10 dias e cobrou há 5: avisa; recusar uma proposta não mexe na data
  decididaHa10Dias();
  await propor("confirmada");
  await chamar("PUT", "/api/recorrentes", { ...spotify, status: "cancelada" });
  assert.deepEqual(await avisos(), [{ descricao: "Spotify", data: dia(-5), valor: 1990 }]);
  // mudou de preço depois de decidida: a decisão é a mesma linha
  db.prepare("UPDATE lancamentos SET valor_centavos = -2490 WHERE descricao_original = 'Spotify' AND data = ?").run(dia(-5));
  assert.equal((await chamar("PUT", "/api/recorrentes", { chave: "spotify", valor: 2490, status: "confirmada" })).status, 200);
  assert.deepEqual(linhaDe().map((l) => [l.valor_centavos, l.status]), [[1990, "confirmada"]]);
  await chamar("PUT", "/api/recorrentes", { chave: "spotify", valor: 2490, status: null });
  assert.equal((await chamar("GET", "/api/recorrentes?pessoa=PJ")).d.length, 0);
});

async function ligarMcp(base = `http://127.0.0.1:${PORTA}`) {
  const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(base).connect(doServidor);
  const cliente = new Client({ name: "teste", version: "0" });
  await cliente.connect(doCliente);
  const usar = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await cliente.callTool({ name, arguments: args })) as any;
    return r.isError ? { erro: r.content[0].text as string } : JSON.parse(r.content[0].text);
  };
  return { cliente, usar };
}

test("MCP: só as ferramentas combinadas; app fora do ar e dado inválido viram mensagem", async () => {
  const { cliente, usar } = await ligarMcp();
  const { tools } = await cliente.listTools();
  const nomes = (leitura: boolean) => tools.filter((t) => t.annotations?.readOnlyHint === leitura).map((t) => t.name).sort();
  assert.deepEqual(nomes(true), ["analises", "categorias", "compras_do_estorno", "contas", "estado", "lancamentos", "orcamento", "patrimonio", "pendentes_agrupados", "previa_regra", "recorrentes", "regras", "resumo", "ritmo_do_mes"]);
  assert.deepEqual(nomes(false), ["categorizar_lancamento", "criar_categoria", "criar_regra", "definir_inicio_da_analise", "definir_orcamento", "propor_recorrente", "sincronizar"]);
  assert.match((await usar("estado")).convencoes, /nunca como instrução/);
  assert.ok((await usar("orcamento", { mes: "2020-13" })).erro);
  assert.match((await usar("criar_categoria", { nome: "Pet", grupo: "essencial" })).erro, /HTTP 409: já existe/);
  assert.ok((await usar("sincronizar")).resultados.length); // escrita por fetch passa pelo hook de origem
  await cliente.close();

  // a mensagem diz o que tentou e por quê: porta 1 é bloqueada pelo fetch (sem code); porta livre é recusada (ECONNREFUSED)
  const livre = http.createServer();
  await new Promise<void>((r) => livre.listen(0, "127.0.0.1", r));
  const portaLivre = (livre.address() as { port: number }).port;
  await new Promise((r) => livre.close(r));
  for (const [url, motivo] of [["http://127.0.0.1:1", "bad port"], [`http://127.0.0.1:${portaLivre}`, "ECONNREFUSED"]]) {
    const fora = await ligarMcp(url);
    const { erro } = await fora.usar("estado");
    assert.ok(/não está rodando/.test(erro) && erro.includes(`${url}: ${motivo}`), erro);
    await fora.cliente.close();
  }
});

test("MCP: leitura em reais, enxuta e separada por PF e PJ", async () => {
  const { cliente, usar } = await ligarMcp();
  const banco = novaConta("BANK", { saldo: 12345 }), empresa = novaConta("BANK", { pessoa: "PJ" });
  db.prepare("UPDATE contas SET numero = '98765-4' WHERE id = ?").run(banco);
  const padoca = (conta: string, d: number, valor: number) =>
    novoLanc(conta, `2019-05-0${d}`, valor, null, { descricao_original: `PADOCA ${d}`, descricao: `PADOCA ${d}` });
  padoca(banco, 1, -1000);
  padoca(banco, 2, -2050);
  padoca(banco, 3, 300);
  padoca(empresa, 4, -9900);

  const contas = await usar("contas");
  assert.equal(contas.contas.find((c: any) => c.id === banco).saldo, 123.45);
  assert.ok(!JSON.stringify(contas).includes("98765-4") && !JSON.stringify(contas).includes("bruto"));
  assert.ok(!contas.contas.some((c: any) => c.id === empresa));
  const saldos = async (p: string) => (await usar("contas", { pessoa: p })).investimentos.map((i: any) => [i.saldo, i.resgatado]).sort();
  assert.deepEqual(await saldos("PF"), [[700, false], [9.99, true]]);
  assert.deepEqual(await saldos("PJ"), [[10, false]]);

  const { grupos, lancamentos_pendentes } = await usar("pendentes_agrupados", { mes: "2019-05" });
  assert.equal(lancamentos_pendentes, 3);
  assert.deepEqual(
    grupos.map((g: any) => [g.tipo, g.qtd, g.total, g.de, g.ate]),
    [["saida", 2, -30.5, "2019-05-01", "2019-05-02"], ["entrada", 1, 3, "2019-05-03", "2019-05-03"]],
  );
  const pagina = await usar("lancamentos", { mes: "2019-05", limite: 1, pular: 1 });
  assert.deepEqual([pagina.total, pagina.itens.length, pagina.itens[0].valor], [3, 1, -20.5]);
  assert.equal((await usar("lancamentos", { mes: "2019-05", pessoa: "PJ" })).total, 1);
  const cartao = novaConta("CREDIT");
  novoLanc(cartao, "2019-05-02", -7000, MERCADO, { descricao_original: "LOJA X", descricao: "LOJA X" });
  novoLanc(cartao, "2019-05-06", 7000, null, { id: "estorno-mcp", descricao_original: "LOJA X", descricao: "LOJA X" });
  assert.equal((await usar("lancamentos", { mes: "2019-05", tipo_conta: "cartoes" })).total, 2);
  assert.deepEqual((await usar("lancamentos", { mes: "2019-05", estornos: true })).itens.map((l: any) => l.id), ["estorno-mcp"]);
  assert.deepEqual((await usar("compras_do_estorno", { id: "estorno-mcp" })).map((l: any) => [l.descricao, l.valor]), [["LOJA X", -70]]);
  db.prepare("DELETE FROM lancamentos WHERE conta_id = ?").run(cartao);
  const [maio, junho] = await usar("resumo", { meses: ["2019-05", "2019-06"] });
  assert.deepEqual([maio.entradas, maio.saidas, maio.sobra, junho.saidas], [3, 30.5, -27.5, 0]);
  await cliente.close();
});

test("MCP: regra só grava com a prévia certa, não troca outra sem querer e respeita o editado à mão", async () => {
  const { cliente, usar } = await ligarMcp();
  const cats = () =>
    (db.prepare("SELECT categoria_id AS c FROM lancamentos WHERE descricao_original LIKE 'PADOCA%' ORDER BY data").all() as { c: number | null }[]).map((l) => l.c);
  const { itens } = await usar("lancamentos", { mes: "2019-05", busca: "PADOCA 1" });
  assert.equal((await usar("categorizar_lancamento", { id: itens[0].id, categoria_id: MERCADO })).editado_a_mao, true);
  assert.match((await usar("categorizar_lancamento", { id: itens[0].id })).erro, /Nada para mudar/);
  assert.match((await usar("categorizar_lancamento", { id: "nao-existe", categoria_id: MERCADO })).erro, /não encontrado/);

  reaplicarRegras(); // como na subida da API: limpa a categoria que os testes acima puseram direto na base, sem regra

  const previa = await usar("previa_regra", { padrao: "padoca" });
  assert.deepEqual([previa.total, previa.sem_categoria, previa.ja_categorizados], [3, 3, 0]);
  const antes = cats();
  assert.match((await usar("criar_regra", { padrao: "padoca", categoria_id: 10, total_previsto: 4 })).erro, /Nada foi gravado.* 3 /);
  assert.deepEqual([cats(), (await usar("regras")).length], [antes, 0]);
  assert.equal((await usar("criar_regra", { padrao: "padoca", categoria_id: 10, total_previsto: 3 })).recategorizados, 3);
  assert.deepEqual(cats(), [MERCADO, 10, 10, 10]);

  const outra = await usar("previa_regra", { padrao: "PADOCA" });
  assert.deepEqual([outra.ja_categorizados, outra.exemplos[0].categoria], [3, "Alimentação fora"]);
  assert.match((await usar("criar_regra", { padrao: "PADOCA", categoria_id: 13, total_previsto: 3 })).erro, /já existe a regra "padoca"/);
  assert.deepEqual(cats(), [MERCADO, 10, 10, 10]);
  const trocada = await usar("criar_regra", { padrao: "PADOCA", categoria_id: 13, total_previsto: 3, substituir: true });
  assert.equal(trocada.categoria_anterior, "Alimentação fora");
  assert.deepEqual(cats(), [MERCADO, 13, 13, 13]);
  // acento: para a API "ÁGUA" e "água" são textos diferentes; o MCP não pode criar a segunda regra
  await usar("criar_regra", { padrao: "ÁGUA XYZ", categoria_id: 2, total_previsto: 0 });
  await usar("criar_regra", { padrao: "água xyz", categoria_id: 3, total_previsto: 0, substituir: true });
  assert.deepEqual((await usar("regras")).map((r: any) => [r.padrao, r.categoria_id]).sort(), [["padoca", 13], ["ÁGUA XYZ", 3]]);

  // sentido: a prévia conta só aquele lado; texto que já tem regra (mesmo de outro alcance) continua pedindo substituir
  const entra = { padrao: "padoca", sentido: "entrada" };
  assert.equal((await usar("previa_regra", entra)).total, 1);
  assert.match((await usar("criar_regra", { ...entra, categoria_id: RENDA, total_previsto: 3 })).erro, /Nada foi gravado.* 1 /);
  assert.match((await usar("criar_regra", { ...entra, categoria_id: RENDA, total_previsto: 1 })).erro, /já existe a regra "padoca" → /);
  assert.equal((await usar("criar_regra", { ...entra, categoria_id: RENDA, total_previsto: 1, substituir: true })).recategorizados, 1);
  assert.deepEqual(cats(), [MERCADO, 13, RENDA, 13]);
  assert.match((await usar("criar_regra", { ...entra, categoria_id: 10, total_previsto: 1 })).erro, /"padoca" \(só entrada\) → Renda/);
  const daConta = { padrao: "padoca", conta_id: (lanc(itens[0].id) as any).conta_id };
  assert.equal((await usar("previa_regra", daConta)).total, 2);
  // saída e entrada não se cruzam, mas a regra geral cruza com as duas
  assert.match((await usar("criar_regra", { padrao: "padoca", sentido: "saida", categoria_id: 10, total_previsto: 2 })).erro, /"padoca" → Lazer/);
  assert.deepEqual((await usar("regras")).filter((r: any) => r.padrao === "padoca").map((r: any) => r.sentido), [undefined, "entrada"]);

  assert.equal((await usar("definir_orcamento", { mes: "2019-05", categoria_id: 13, valor: 850.55 })).planejado, 850.55);
  assert.equal((db.prepare("SELECT valor_centavos AS v FROM orcamentos WHERE categoria_id = 13").get() as { v: number }).v, 85055);
  assert.match((await usar("propor_recorrente", { chave: "inventada", valor_chave: 24.9, status: "ignorada" })).erro, /não encontrad/);
  assert.equal((await usar("propor_recorrente", { chave: "spotify", valor_chave: 24.9, status: "ignorada" })).proposta, "ignorada");
  const proposta = (await usar("recorrentes")).find((r: any) => r.chave === "spotify");
  assert.deepEqual([proposta.valor_chave, proposta.status, proposta.proposta_esperando_o_paulo, "cor" in proposta], [24.9, null, "ignorada", false]);
  await cliente.close();
});

test("migração: as decisões antigas de recorrentes valem para todas as cobranças com o nome", () => {
  const m = new DatabaseSync(":memory:");
  const ANTES = 7;
  MIGRACOES.slice(0, ANTES).forEach((sql) => m.exec(sql));
  m.exec("INSERT INTO recorrencias (chave, status, criado_em) VALUES ('a', 'confirmada', '2026-01-02 03:04:05'), ('b', 'ignorada', '2026-01-03 03:04:05')");
  m.exec(MIGRACOES[ANTES]);
  assert.deepEqual((m.prepare("SELECT * FROM recorrencias ORDER BY chave").all() as object[]).map((r) => Object.values(r)), [
    ["a", 0, "confirmada", null, "2026-01-02 03:04:05"], ["b", 0, "ignorada", null, "2026-01-03 03:04:05"],
  ]);
  m.close();
});

test("migração: Investimentos sai do resumo e nenhuma outra categoria muda de grupo", () => {
  const m = new DatabaseSync(":memory:");
  const ANTES = 5;
  MIGRACOES.slice(0, ANTES).forEach((sql) => m.exec(sql));
  const grupos = () => Object.fromEntries((m.prepare("SELECT nome, grupo FROM categorias").all() as { nome: string; grupo: string }[]).map((c) => [c.nome, c.grupo]));
  const antes = grupos();
  m.exec(MIGRACOES[ANTES]);
  assert.deepEqual(grupos(), { ...antes, Investimentos: "transferencia" });
  m.close();
});

test("ritmo: contas puras", () => {
  assert.deepEqual([mediana([]), mediana([3, 1, 2]), mediana([4, 1])], [null, 2, 3]);
  assert.deepEqual([somarMes("2026-01", -1), somarMes("2026-12", 1)], ["2025-12", "2027-01"]);

  const base = { gastoAteHoje: 1000, dia: 10, diasNoMes: 30, depoisDoDia: [500, 900, 700], jaLancado: 1000 };
  assert.deepEqual(projetar(base), { min: 1700, max: 3000, media: 2350 });
  assert.equal(projetar({ ...base, dia: 4 }), null); // cedo demais
  assert.deepEqual(projetar({ ...base, depoisDoDia: [] }), { min: 3000, max: 3000, media: 3000 }); // sem histórico
  assert.deepEqual(projetar({ ...base, jaLancado: 2500 }), { min: 2500, max: 3000, media: 2750 }); // parcela futura é piso

  assert.deepEqual([nivelDo(90, 100, 120), nivelDo(100, 100, 120), nivelDo(110, 100, 120), nivelDo(121, 100, 120)], ["verde", "verde", "amarelo", "vermelho"]);
  assert.deepEqual([nivelDo(130, 140, 120), nivelDo(110, 0, 120), nivelDo(110, 100, null), nivelDo(1, 0, null)], ["vermelho", "verde", "amarelo", null]);

  // rendimento de centavos e mês com metade da renda faltando não abrem a análise
  const t = (mes: string, renda: number) => ({ mes, renda, entradas: renda, gasto: 0 });
  const totais = [t("2026-01", 3), t("2026-02", 499), t("2026-03", 600), t("2026-04", 1000), t("2026-05", 1000), t("2026-06", 2000), t("2026-07", 0)];
  assert.equal(inicioDaAnalise(totais, "2026-07"), "2026-03");
  assert.equal(inicioDaAnalise([t("2026-07", 800)], "2026-07"), "2026-07"); // instalação nova
  assert.equal(inicioDaAnalise([t("2026-06", 0)], "2026-07"), null);
});

test("ritmo: bate com o Resumo, a renda esperada é a régua e o que não é PF do resumo fica fora", async () => {
  const banco = novaConta("BANK"), INVESTIMENTOS = 17;
  const { mes } = (await chamar("GET", "/api/ritmo")).d, [m1, m2, m3] = [1, 2, 3].map((k) => somarMes(mes, -k));
  const ritmo = async (m = mes) => (await chamar("GET", `/api/ritmo?mes=${m}`)).d;
  assert.deepEqual([(await ritmo()).renda.esperada, (await ritmo()).acumulado, (await ritmo()).analisado], [null, null, false]); // sem renda não inventa régua
  await chamar("PUT", "/api/orcamento", { mes, categoria_id: MERCADO, valor_centavos: 100 });
  novoLanc(banco, `${mes}-01`, -90000000, MERCADO, { id: "enorme" });
  const semRenda = await ritmo();
  assert.ok(semRenda.gasto > semRenda.orcado);
  assert.equal(semRenda.nivel, "amarelo"); // sem renda conhecida, passar do orçado não é "estourando a renda"
  db.prepare("DELETE FROM lancamentos WHERE id = 'enorme'").run();
  await chamar("PUT", "/api/orcamento", { mes, categoria_id: MERCADO, valor_centavos: 0 });

  for (const [m, renda] of [[m1, 1000000], [m2, 1200000], [m3, 900000]] as const) {
    novoLanc(banco, `${m}-05`, renda, RENDA);
    novoLanc(banco, `${m}-28`, -5000, MERCADO, { descricao_original: "Academia", descricao: "Academia" });
  }
  novoLanc(banco, `${mes}-01`, -20000, MERCADO);
  novoLanc(banco, `${mes}-01`, 1500000, RENDA);
  const r = await ritmo(), resumo = (await chamar("GET", `/api/resumo?mes=${mes}`)).d;
  assert.deepEqual([r.situacao, r.inicio, r.analisado], ["aberto", m3, true]);
  assert.deepEqual([r.gasto, r.renda.recebida, r.sobra], [resumo.saidas, resumo.entradas, resumo.entradas - resumo.saidas]);
  assert.deepEqual([r.renda.esperada, r.renda.origem, r.renda.extra], [1000000, "mediana", resumo.entradas - 1000000]);
  assert.equal(r.por_dia.livre, 1000000 - r.gasto - r.por_dia.recorrentes); // a renda extra não alivia
  assert.equal(r.por_dia.no_ritmo, r.projecao && Math.round((r.projecao.media - r.gasto) / r.por_dia.dias));
  const fechados = await Promise.all([m1, m2, m3].map(async (m) => (await chamar("GET", `/api/resumo?mes=${m}`)).d));
  assert.deepEqual([r.acumulado.de, r.acumulado.ate, r.acumulado.meses], [m3, m1, 3]);
  assert.equal(r.acumulado.sobra, fechados.reduce((s, x) => s + x.entradas - x.saidas, 0));

  // recorrente prevista para este mês desconta do "por dia"; ignorada, não
  await chamar("PUT", "/api/recorrentes", { chave: "academia", valor: 5000, status: "ignorada" });
  assert.equal((await ritmo()).por_dia.recorrentes, r.por_dia.recorrentes - 5000);
  await chamar("PUT", "/api/recorrentes", { chave: "academia", valor: 5000, status: null });

  // digitada no orçamento, a renda esperada manda e não vira gasto planejado
  await chamar("PUT", "/api/orcamento", { mes, categoria_id: RENDA, valor_centavos: 1300000 });
  const com = await ritmo(), orc = (await chamar("GET", `/api/orcamento?mes=${mes}`)).d;
  assert.deepEqual([com.renda.esperada, com.renda.origem, com.orcado], [1300000, "definida", r.orcado]);
  assert.ok(orc.linhas.every((l: any) => l.grupo !== "renda" || l.planejado === null));
  const linha = orc.renda.find((l: any) => l.categoria_id === RENDA);
  assert.deepEqual([linha.planejado, linha.sugerido, orc.renda_esperada], [1300000, 1000000, 1300000]);
  assert.equal(orc.renda.reduce((s: number, l: any) => s + l.recebido, 0) + orc.entradas_sem_categoria, resumo.entradas);
  assert.equal(orc.linhas.reduce((s: number, l: any) => s + l.realizado, 0) + orc.sem_categoria, resumo.saidas);
  await chamar("PUT", "/api/orcamento", { mes, categoria_id: RENDA, valor_centavos: 0 });
  assert.equal((await ritmo()).renda.origem, "mediana");

  // investir, empresa e conta oculta não mexem no ritmo
  novoLanc(banco, `${mes}-01`, -777700, INVESTIMENTOS);
  novoLanc(banco, `${mes}-01`, 888800, INVESTIMENTOS);
  novoLanc(novaConta("BANK", { pessoa: "PJ" }), `${mes}-01`, -999900, MERCADO);
  novoLanc(novaConta("BANK", { oculta: 1 }), `${mes}-01`, -999900, MERCADO);
  assert.deepEqual(await ritmo(), r);

  // mês fechado: vermelho é gastar mais do que entrou; antes do início da análise não há veredito
  assert.equal((await ritmo(m1)).nivel, "verde");
  novoLanc(banco, `${m1}-10`, -2000000, MERCADO);
  const ruim = await ritmo(m1);
  assert.deepEqual([ruim.situacao, ruim.nivel, ruim.projecao, ruim.por_dia, ruim.acima[0].categoria], ["fechado", "vermelho", null, null, "Mercado"]);
  assert.ok(ruim.sobra < 0);
  await chamar("PUT", "/api/orcamento", { mes: m1, categoria_id: MERCADO, valor_centavos: 90000000 });
  assert.ok(!(await ritmo(m1)).acima.some((c: any) => c.categoria === "Mercado")); // dentro do orçado não é culpado
  db.prepare("DELETE FROM orcamentos WHERE categoria_id = ? AND mes = ?").run(MERCADO, m1);
  const antes = await ritmo(somarMes(m3, -1));
  assert.deepEqual([antes.analisado, antes.nivel], [false, null]);
  const futuro = await ritmo(somarMes(mes, 1));
  assert.deepEqual([futuro.situacao, futuro.nivel, futuro.por_dia], ["futuro", null, null]);
  assert.equal((await chamar("GET", "/api/ritmo?mes=2026-13")).status, 400);

  const { cliente, usar } = await ligarMcp();
  const pelo = await usar("ritmo_do_mes");
  assert.deepEqual([pelo.mes, pelo.renda_esperada, pelo.gasto, pelo.ultimos_meses_fechados.meses], [mes, 10000, r.gasto / 100, 3]);
  assert.equal((await usar("ritmo_do_mes", { mes: m1 })).nivel, "vermelho");
  assert.equal((await usar("estado")).mes_atual.mes, mes);
  const orcMcp = await usar("orcamento", { mes });
  assert.deepEqual([orcMcp.renda_esperada, orcMcp.renda_esperada_vem_de, orcMcp.gasto_total], [10000, "mediana", r.gasto / 100]);
  assert.equal((await usar("definir_orcamento", { mes, categoria_id: RENDA, valor: 12000 })).renda_esperada, 12000);
  await usar("definir_orcamento", { mes, categoria_id: RENDA, valor: 0 });
  await cliente.close();
});

test("análises: batem com o Resumo, o mês aberto fica fora do acumulado e o início é editável", async () => {
  // usa a renda e os gastos que o teste do ritmo pôs nos 3 meses fechados e no atual
  const { mes } = (await chamar("GET", "/api/ritmo")).d, [m1, m2, m3] = [1, 2, 3].map((k) => somarMes(mes, -k));
  const analises = async (m = mes) => (await chamar("GET", `/api/analises?mes=${m}`)).d;
  const resumo = async (m: string) => (await chamar("GET", `/api/resumo?mes=${m}`)).d;
  const d = await analises(), [r, r1, r2, r3] = await Promise.all([mes, m1, m2, m3].map(resumo));

  assert.deepEqual(d.meses.map((m: any) => [m.mes, m.aberto, m.entradas, m.gasto]), [
    [m3, false, r3.entradas, r3.saidas], [m2, false, r2.entradas, r2.saidas], [m1, false, r1.entradas, r1.saidas], [mes, true, r.entradas, r.saidas],
  ]);
  const sobras = [r3, r2, r1].map((x) => x.entradas - x.saidas);
  assert.deepEqual(d.meses.map((m: any) => m.acumulado), [sobras[0], sobras[0] + sobras[1], sobras[0] + sobras[1] + sobras[2], null]);

  // dia a dia: o mês fechado termina no total do Resumo; o aberto para em hoje
  const fechado = await analises(m1);
  assert.equal(fechado.dia_a_dia.dias.at(-1), r1.saidas);
  assert.equal(fechado.dia_a_dia.anterior.at(-1), r2.saidas);
  assert.equal(d.dia_a_dia.dias.length, Number((await chamar("GET", "/api/ritmo")).d.hoje.slice(8)));
  novoLanc(novaConta("CREDIT"), `${somarMes(mes, 1)}-01`, -1, MERCADO); // mês seguinte não entra no já lançado
  assert.equal(d.dia_a_dia.ja_lancado, r.saidas);
  assert.equal((await analises()).dia_a_dia.ja_lancado, r.saidas);
  assert.equal((await analises(m3)).dia_a_dia.anterior, null); // o mês antes do início não entra

  const mercado = fechado.categorias.find((c: any) => c.categoria_id === MERCADO);
  const doMercado = (x: any) => x.porCategoria.find((c: any) => c.categoria_id === MERCADO)?.total ?? 0;
  assert.deepEqual([mercado.gasto, mercado.mes_passado, mercado.normal], [doMercado(r1), doMercado(r2), mediana([doMercado(r2), doMercado(r3)])]);
  assert.ok(!fechado.categorias.some((c: any) => ["renda", "transferencia"].includes(c.grupo)));

  // futuro: o que já está lançado, e as recorrentes menos as ignoradas
  const futuro = somarMes(mes, 2);
  novoLanc(novaConta("CREDIT"), `${futuro}-10`, -30000, MERCADO, { total_parcelas: 5, parcela: 3 });
  const antes = d.comprometido.find((m: any) => m.mes === futuro), depois = (await analises()).comprometido.find((m: any) => m.mes === futuro);
  assert.equal(depois.parcelas - antes.parcelas, 30000);
  assert.deepEqual([d.comprometido.length, d.comprometido[0].mes], [12, somarMes(mes, 1)]);
  await chamar("PUT", "/api/recorrentes", { chave: "academia", valor: 5000, status: "ignorada" });
  assert.equal((await analises()).comprometido[0].recorrentes, d.comprometido[0].recorrentes - 5000);
  await chamar("PUT", "/api/recorrentes", { chave: "academia", valor: 5000, status: null });

  // início escolhido vale para o alarme também; futuro é recusado; null volta ao automático
  const inicio = (m: string | null) => chamar("PUT", "/api/analises/inicio", { mes: m });
  assert.equal((await inicio(m1)).status, 200);
  const curto = await analises();
  assert.deepEqual([curto.inicio, curto.inicio_automatico, curto.inicio_definido, curto.meses.length], [m1, m3, true, 2]);
  assert.deepEqual([(await chamar("GET", `/api/ritmo?mes=${m2}`)).d.analisado, (await chamar("GET", "/api/ritmo")).d.acumulado.meses], [false, 1]);
  assert.deepEqual([(await analises(m2)).categorias, (await analises(m2)).dia_a_dia.dias], [[], []]);
  assert.equal((await inicio(somarMes(mes, 1))).status, 400);
  assert.equal((await inicio("2026-13")).status, 400);
  assert.equal((await chamar("PUT", "/api/analises/inicio", {})).status, 400);

  const { cliente, usar } = await ligarMcp();
  assert.equal((await usar("definir_inicio_da_analise", { mes: null })).analise_desde, m3);
  const pelo = await usar("analises", { mes: m1 });
  assert.deepEqual([pelo.mes_a_mes.length, pelo.mes_a_mes[2].gasto, pelo.gasto_acumulado_por_dia.dias.at(-1)], [4, r1.saidas / 100, r1.saidas / 100]);
  await cliente.close();
});

test("dinheiro digitado no jeito brasileiro vira centavos", () => {
  for (const [texto, centavos] of [
    ["1.234,56", 123456], ["R$ 1.234,56", 123456], ["1234", 123400], ["1.234", 123400], ["12,5", 1250], ["12.50", 1250],
    ["0,1", 10], ["", 0], ["-50", -5000], ["abc", null], ["1,2,3", null],
  ] as const)
    assert.equal(lerDinheiro(texto), centavos, texto);
});
