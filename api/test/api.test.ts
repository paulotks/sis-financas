// Verificação com uma Pluggy falsa e base temporária: nunca usa as credenciais nem a base reais.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
let contasFalsas: object[] = [{ id: CARTAO, type: "CREDIT", name: "Cartão" }];
let porPagina: Record<string, object[][]> = {}; // "/bills" e "/investments", uma lista por página
let falhas: Record<string, number> = {}; // caminho -> HTTP de erro
const EM_DIA = { status: "UPDATED", executionStatus: "SUCCESS", statusDetail: null };
let situacao: object = EM_DIA; // o que o item diz da última atualização do banco
const falsa = http.createServer((req, res) => {
  const u = new URL(req.url!, "http://x");
  const ok = (d: unknown) => res.setHeader("content-type", "application/json").end(JSON.stringify(d));
  if (u.pathname === "/auth") return ok({ apiKey: "falsa" });
  if (falhas[u.pathname]) return res.writeHead(falhas[u.pathname]).end("{}");
  if (u.pathname.startsWith("/items/")) {
    const id = u.pathname.split("/")[2];
    return void setTimeout(() => ok({ id, connector: { id: 1, name: `Banco ${id[0]}` }, ...situacao }), 20);
  }
  const lista = u.pathname === "/accounts" ? [u.searchParams.get("itemId") === ITEM ? contasFalsas : []] : porPagina[u.pathname];
  if (lista) {
    const page = Number(u.searchParams.get("page") ?? 1);
    return ok({ page, totalPages: lista.length, results: lista[page - 1] ?? [] });
  }
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
  COPIAS_DIR: path.join(dir, "copias"), // sem isto, um .env com a pasta real faria o teste girar as cópias de verdade
  PORT: String(PORTA),
  SYNC_DIAS_INICIAIS: "365",
});
const { app } = await import("../src/server.js");
const { copiaDoDia, db, migrar, MIGRACOES, transacao } = await import("../src/db.js");
const { env } = await import("../src/env.js");
const { sincronizar } = await import("../src/sync.js");
const { reaplicarRegras, sugerirCategoria } = await import("../src/categorizar.js");
const { detectarRecorrentes, mesSeguinte, chaveDe } = await import("../src/recorrentes.js");
const { criarServidor } = await import("../src/mcp.js");
const { totalDaFatura } = await import("../src/adaptadores.js");
const { faturasQueNaoFecham, naoApareceu, pagamentosSemFatura, parcelasPrevistas } = await import("../src/faltas.js");
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

test("saldo, limite e total de fatura que vêm nulos mantêm o último conhecido, e dá para saber de quando é o saldo", async () => {
  const cartao = (balance: number | null, creditLimit: number | null) => [{ id: CARTAO, type: "CREDIT", name: "Cartão", balance, creditData: { creditLimit, availableCreditLimit: creditLimit } }];
  const ler = () => {
    const c = db.prepare("SELECT * FROM contas WHERE id = ?").get(CARTAO) as any;
    const f = db.prepare("SELECT total_centavos AS t FROM faturas WHERE id = 'fx'").get() as any;
    const i = db.prepare("SELECT saldo_centavos AS s FROM investimentos WHERE id = 'ix'").get() as any;
    return { valores: [c.saldo_centavos, c.limite_centavos, c.limite_disponivel_centavos, f.t, i.s], lidoEm: c.atualizado_em };
  };
  contasFalsas = cartao(150, 1000);
  porPagina = { "/bills": [[{ id: "fx", totalAmount: 80 }]], "/investments": [[{ id: "ix", balance: 50 }]] };
  await sync();
  assert.deepEqual(ler().valores, [15000, 100000, 100000, 8000, 5000]);
  db.prepare("UPDATE contas SET atualizado_em = '2026-01-01' WHERE id = ?").run(CARTAO);
  contasFalsas = cartao(null, null);
  porPagina = { "/bills": [[{ id: "fx", totalAmount: null }]], "/investments": [[{ id: "ix", balance: null, amount: null }]] };
  await sync();
  assert.deepEqual(ler(), { valores: [15000, 100000, 100000, 8000, 5000], lidoEm: "2026-01-01" });
  contasFalsas = cartao(0, 0); // zero é valor, não falta
  await sync();
  assert.deepEqual(ler().valores.slice(0, 3), [0, 0, 0]);
  assert.notEqual(ler().lidoEm, "2026-01-01");
});

test("contas, faturas e investimentos são lidos até a última página", async () => {
  porPagina = {
    "/bills": [[{ id: "f1", totalAmount: 1 }], [{ id: "f2", totalAmount: 2 }], [{ id: "f3", totalAmount: 3 }]],
    "/investments": [[{ id: "i1", balance: 1 }], [{ id: "i2", balance: 2 }]],
  };
  assert.equal((await sync()).investimentos, 2);
  const n = (tabela: string, ids: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE id IN (${ids})`).get() as { n: number }).n;
  assert.deepEqual([n("faturas", "'f1','f2','f3'"), n("investimentos", "'i1','i2'")], [3, 2]);
});

test("falha ao ler faturas ou investimentos aparece como erro, sem custar os lançamentos; 404 é banco sem o produto", async () => {
  const erroSalvo = () => (db.prepare("SELECT erro FROM conexoes WHERE item_id = ?").get(ITEM) as { erro: string | null }).erro;
  const base = [tx("a2", -2, { description: "compra a" })];
  for (const [caminho, oQue] of [["/bills", /^Faturas não lidas: .*HTTP 429/], ["/investments", /^Investimentos não lidos: .*HTTP 429/]] as const) {
    falhas = { [caminho]: 429 };
    paginas = [[...base, tx("mesmo-assim", -1)]];
    const [r] = await sincronizar(ITEM);
    assert.match(r.erro ?? "", oQue);
    assert.equal(erroSalvo(), r.erro);
    assert.equal(r.novos, 1);
    paginas = [base];
    falhas = {};
    await sync(); // volta ao normal: o erro sai
    assert.equal(erroSalvo(), null);
  }
  falhas = { "/bills": 500, "/investments": 400 }; // 400 é pedido nosso recusado: também não se esconde
  assert.match((await sincronizar(ITEM))[0].erro ?? "", /HTTP 500.* · .*HTTP 400/);
  falhas = { "/bills": 404, "/investments": 404 };
  await sync();
  falhas = {};
  porPagina = {};
  paginas = [[]];
  contasFalsas = [{ id: CARTAO, type: "CREDIT", name: "Cartão" }];
  db.exec("DELETE FROM faturas; DELETE FROM investimentos");
});

test("tipo ou valor desconhecido não vira entrada nem apaga o que já estava: é recusado, avisa e o resto entra", async () => {
  const base = [tx("a2", -2, { description: "compra a" })];
  paginas = [[...base, tx("certo", -1)]];
  await sync();
  for (const estranho of [{ type: "ADJUSTMENT" }, { type: undefined }, { type: "credit" }, { amount: null }, { amount: "x" }]) {
    paginas = [[...base, tx("certo", -1, { ...estranho, description: "mudou" }), tx("nunca-visto", -1, estranho), tx("normal", -1)]];
    const [r] = await sincronizar(ITEM);
    assert.match(r.erro ?? "", /^2 lançamentos recusados/, JSON.stringify(estranho));
    assert.deepEqual([lanc("certo").valor_centavos, lanc("certo").descricao_original, lanc("nunca-visto"), lanc("normal").valor_centavos], [-1000, "compra certo", undefined, -1000]);
  }
  paginas = [[...base, tx("credito", -1, { type: "CREDIT", amount: -10 })]]; // o sinal vem do tipo, não do valor
  await sync();
  assert.equal(lanc("credito").valor_centavos, 1000);
  paginas = [base];
  await sync();
  paginas = [[]];
});

test("só apaga o que sumiu quando o banco entregou a lista completa; nos outros casos só acrescenta", async () => {
  const base = [tx("a2", -2, { description: "compra a" })];
  const parcial = (d: object) => ({ status: "UPDATED", executionStatus: "PARTIAL_SUCCESS", statusDetail: d });
  const sim = { isUpdated: true }, nao = { isUpdated: false };
  const casos: [object, boolean][] = [
    [EM_DIA, true],
    [parcial({ transactions: sim, creditCards: sim, investments: nao }), true], // falhou outro produto: a limpeza não pode parar
    [{ ...parcial({ transactions: sim, creditCards: sim }), status: "PARTIAL_SUCCESS" }, true], // a documentação mostra dos dois jeitos
    [parcial({ transactions: nao, creditCards: sim }), false],
    [parcial({ transactions: sim, creditCards: nao }), false], // a conta é cartão
    [parcial({ transactions: sim, creditCards: null }), false],
    [{ status: "PARTIAL_SUCCESS", executionStatus: "SUCCESS", statusDetail: null }, false],
    [{ status: "UPDATED", executionStatus: "PARTIAL_SUCCESS", statusDetail: null }, false],
    [{ status: "OUTDATED", executionStatus: "ERROR" }, false],
    [{ status: "OUTDATED", executionStatus: "SUCCESS" }, false],
    [{ ...parcial({ transactions: sim, creditCards: sim }), status: "OUTDATED" }, false],
    [{ status: "LOGIN_ERROR", executionStatus: "USER_AUTHORIZATION_REVOKED" }, false],
    [{ status: "UPDATING", executionStatus: "TRANSACTIONS_IN_PROGRESS" }, false],
    [{}, false],
  ];
  for (const [s, apaga] of casos) {
    situacao = EM_DIA;
    paginas = [[...base, tx("some", -1), tx("editado", -1, { amount: 77 })]];
    await sync();
    db.prepare("UPDATE lancamentos SET notas = 'minha' WHERE id = 'editado'").run();
    situacao = s;
    paginas = [[...base, tx("chegou", -1, { amount: 33 })]];
    await sync(); // sem erro: status ruim não impede de ler
    assert.deepEqual(
      [!lanc("some"), lanc("editado").status === "REMOVIDO", !!lanc("chegou")], [apaga, apaga, true], JSON.stringify(s));
    situacao = EM_DIA;
    paginas = [base];
    db.exec("DELETE FROM lancamentos WHERE id = 'editado'");
    await sync(); // com o banco em dia, a limpeza volta
    assert.deepEqual([lanc("some"), lanc("chegou")], [undefined, undefined]);
  }
  paginas = [[]];
});

test("substituto que chegou com a limpeza parada ainda herda a edição quando ela volta", async () => {
  const base = [tx("a2", -2, { description: "compra a" })];
  paginas = [[...base, tx("velho-id", -1, { status: "PENDING", description: "loja" })]];
  await sync();
  db.prepare("UPDATE lancamentos SET categoria_id = 3, categoria_manual = 1, notas = 'minha', atualizado_em = datetime('now','localtime','-2 days') WHERE id = 'velho-id'").run();
  situacao = { status: "OUTDATED", executionStatus: "ERROR" };
  paginas = [[...base, tx("novo-id", -1, { description: "loja" }), tx("outro", -1, { amount: 55 })]];
  await sync();
  assert.ok(lanc("velho-id") && lanc("novo-id"));
  situacao = EM_DIA;
  await sync();
  assert.deepEqual([lanc("velho-id"), lanc("novo-id").categoria_id, lanc("novo-id").notas, lanc("outro").notas], [undefined, 3, "minha", null]);

  // o que o Paulo já editou no substituto não é trocado: o antigo fica como removido
  paginas = [[...base, tx("v2", -1, { description: "feira" })]];
  await sync();
  db.prepare("UPDATE lancamentos SET notas = 'antiga', atualizado_em = datetime('now','localtime','-2 days') WHERE id = 'v2'").run();
  situacao = { status: "OUTDATED", executionStatus: "ERROR" };
  paginas = [[...base, tx("n2", -1, { description: "feira" })]];
  await sync();
  db.prepare("UPDATE lancamentos SET notas = 'nova' WHERE id = 'n2'").run();
  situacao = EM_DIA;
  await sync();
  assert.deepEqual([lanc("v2").status, lanc("n2").notas], ["REMOVIDO", "nova"]);
  db.exec("DELETE FROM lancamentos WHERE id IN ('v2','n2')");
  paginas = [base];
  await sync();
  paginas = [[]];
});

test("nenhuma conta de um banco que já tinha contas é erro, e nada muda; banco novo sem contas não é", async () => {
  const antes = [ids(), db.prepare("SELECT * FROM contas").all()];
  contasFalsas = [];
  const [r] = await sincronizar(ITEM);
  contasFalsas = [{ id: CARTAO, type: "CREDIT", name: "Cartão" }];
  assert.match(r.erro ?? "", /nenhuma conta/);
  assert.deepEqual([ids(), db.prepare("SELECT * FROM contas").all()], antes);
  assert.match((db.prepare("SELECT erro FROM conexoes WHERE item_id = ?").get(ITEM) as { erro: string }).erro, /nenhuma conta/);
  await sync();
  assert.equal((await sincronizar(ITEM2))[0].erro, undefined); // ainda sem contas na base
});

test("sincronizações simultâneas devolvem cada uma o seu resultado", async () => {
  const [r1, r2] = await Promise.all([sincronizar(ITEM), sincronizar(ITEM2)]);
  assert.equal(r1[0].item_id, ITEM);
  assert.equal(r2[0].item_id, ITEM2);
});

test("categorias da Pluggy caem no lugar certo", () => {
  const nome = (c: string) => {
    const id = sugerirCategoria(mov("", c), [], null).categoria_id;
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
  const grupo = (descricao: string, cp: string, banco: string | null = "323") => {
    const id = sugerirCategoria(mov(descricao, cp), [], banco).categoria_id;
    return id && (db.prepare("SELECT grupo FROM categorias WHERE id = ?").get(id) as { grupo: string }).grupo;
  };
  for (const [descricao, cp] of [
    ["Dinheiro reservado Férias", "Transfer - Internal"],
    ["Dinheiro reservado Férias", "Investments"],
    ["Dinheiro retirado", "Same person transfer - CASH"],
    ["Dinheiro retirado PLR", "Salary"],
    ["Débito automático Fatura do cartão", "Transfer - Internal"],
    ["Débito automático total", "Transfer - Internal"],
  ]) {
    assert.equal(grupo(descricao, cp), "transferencia", `${descricao} / ${cp}`);
    assert.equal(grupo(descricao, cp, null), "transferencia"); // ainda não se sabe o banco: como antes
    // em outro banco, com ou sem adaptador, o mesmo texto não é movimento interno
    for (const outro of ["260", "999"]) assert.equal(grupo(descricao, cp, outro), grupo("outra coisa", cp), `${descricao} no ${outro}`);
  }
  // Pix no crédito: sozinha não sai (tirar só esta perna contaria o gasto em dobro); o teste das três pernas está adiante
  assert.equal(grupo("Valor adicionado na conta por cartão de crédito", "Transfer - Internal"), null);
  // regra do Paulo continua mandando
  const pet = { id: 1, padrao: "reservado pet", sentido: null, conta_id: null, categoria_id: 8, descricao: null };
  assert.equal(sugerirCategoria(mov("Dinheiro reservado Pet", "Transfer - Internal"), [pet], "323").categoria_id, 8);
});

test("banco da conexão: vem do código da conta; sem código ou com mais de um, fica o que já se sabia", async () => {
  const antes = { paginas, contasFalsas };
  const sincronizarCom = async (...numeros: (string | null)[]) => {
    paginas = [[tx("interno", -2, { description: "Dinheiro reservado Férias", category: "Groceries" }), ...antes.paginas[0]]];
    contasFalsas = [antes.contasFalsas[0], ...numeros.map((transferNumber, n) => ({ id: `66666666-6666-4666-8666-66666666666${n}`, type: "BANK", name: "Conta", bankData: { transferNumber } }))];
    await sync();
    const { banco } = db.prepare("SELECT banco FROM conexoes WHERE item_id = ?").get(ITEM) as { banco: string | null };
    return [banco, lanc("interno").categoria_id]; // o lançamento é do cartão: herda o banco da conexão
  };
  const FORA = 19, MERCADO = 3;
  const semCodigo = [[], [null], ["0001/12345-0"], ["001/12345-0"], ["260/0001/1", "999/0001/1"]];
  for (const numeros of semCodigo) assert.deepEqual(await sincronizarCom(...numeros), [null, FORA], String(numeros)); // ainda não se sabe: como antes
  assert.deepEqual(await sincronizarCom("260/0001/12345-6"), ["260", MERCADO]);
  assert.deepEqual(await sincronizarCom("323/0001/12345-6", "323/0001/99999-9"), ["323", FORA]);
  for (const numeros of semCodigo) assert.deepEqual(await sincronizarCom(...numeros), ["323", FORA], String(numeros));
  assert.deepEqual(await sincronizarCom("999/0001/12345-6"), ["999", MERCADO]); // banco sem adaptador: o padrão

  ({ paginas, contasFalsas } = antes);
  db.exec("DELETE FROM lancamentos WHERE id = 'interno'; DELETE FROM contas WHERE id LIKE '66666666%'; UPDATE conexoes SET banco = NULL");
});

test("total da fatura: só no banco que carrega a anterior, o que veio dela sai; pago inteiro, em parte ou nada", () => {
  for (const [pagamentos, total] of [[-5000 + 5000, 10000], [-5000 + 4000, 9000], [-5000, 5000], [0, 10000]]) assert.equal(totalDaFatura("104", 10000, pagamentos), total);
  for (const outro of ["260", "999", null]) assert.equal(totalDaFatura(outro, 10000, -5000), 10000); // peça nova não vale sem saber o banco
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
  assert.deepEqual([previa.d.parecidos, previa.d.total, previa.d.pendentes, previa.d.descricoes, previa.d.exemplos.length], [3, 3, 3, 3, 3]); // o editado à mão não entra na conta
  const criada = await chamar("POST", "/api/regras", { padrao, categoria_id: 4 });
  assert.equal(criada.d.recategorizados, 3);
  assert.deepEqual(["u1", "u2", "u3", "mao"].map((i) => lanc(i).categoria_id), [4, 4, 4, 14]);

  const outra = await chamar("POST", "/api/regras", { padrao: "uber *trip", categoria_id: 13 });
  assert.equal(outra.d.regra.id, criada.d.regra.id);
  assert.deepEqual(["u1", "mao"].map((i) => lanc(i).categoria_id), [13, 14]);

  assert.equal((await chamar("POST", "/api/regras", { padrao: "ab", categoria_id: 4 })).status, 400);
  // letra com acento em outra caixa é o mesmo texto: corrige a regra que existe (e a lista não ganha a segunda); outro sentido é outra regra
  const acento = (await chamar("POST", "/api/regras", { padrao: "ÁGUA XYZ", categoria_id: 2 })).d.regra;
  const repetida = (await chamar("POST", "/api/regras", { padrao: "água xyz", categoria_id: 3 })).d.regra;
  assert.deepEqual([repetida.id, repetida.padrao, repetida.categoria_id], [acento.id, "ÁGUA XYZ", 3]);
  const soSaida = (await chamar("POST", "/api/regras", { padrao: "água xyz", sentido: "saida", categoria_id: 3 })).d.regra;
  assert.notEqual(soSaida.id, acento.id);
  for (const r of [acento, soSaida]) await chamar("DELETE", `/api/regras/${r.id}`);

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
  assert.equal(o.gasto, r.saidas);
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
  // nem de grupo: Transferência como gasto entraria nos totais de todos os meses
  for (const [id, grupo] of [[MERCADO, "estilo_de_vida"], [RENDA, "transferencia"], [TRANSFERENCIA, "essencial"]] as const) {
    const antes = await uma(id);
    assert.equal((await chamar("PATCH", `/api/categorias/${id}`, { grupo, cor: "#000000" })).status, 409);
    assert.deepEqual(await uma(id), antes); // recusa inteira: a cor também não muda
    assert.equal((await chamar("PATCH", `/api/categorias/${id}`, { grupo: antes.grupo })).status, 200); // mesmo grupo: nada a recusar
  }
  assert.equal((await chamar("PATCH", `/api/categorias/${comRegra}`, { grupo: "essencial" })).d.grupo, "essencial");
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
  assert.equal((await chamar("GET", "/api/orcamento?mes=2018-02")).d.planejado, 222);
  assert.deepEqual(
    Object.fromEntries((await chamar("GET", "/api/categorias")).d.map((c: any) => [c.grupo, c.tipo])),
    { essencial: "gasto", estilo_de_vida: "gasto", financeiro: "gasto", renda: "renda", transferencia: "transferencia" },
  );
  await chamar("DELETE", `/api/regras/${regra}`);
});

test("regra por sentido e por conta: só pega o seu lado, convive com o mesmo texto e a prévia bate com o aplicado", async () => {
  const a = novaConta("BANK"), b = novaConta("BANK");
  for (const [conta, valor] of [[a, -100], [a, -200], [a, 300], [b, -400], [b, 500]] as const)
    novoLanc(conta, "2017-01-01", valor, null, { descricao_original: "Pix Fulana Loja" });
  const cats = () => db.prepare("SELECT categoria_id AS c FROM lancamentos WHERE data = '2017-01-01' ORDER BY abs(valor_centavos)").all().map((l: any) => l.c);
  /** Cria a regra conferindo que a prévia contou o mesmo que mudou, com ou sem outra regra disputando. */
  const criar = async (padrao: string, categoria_id: number, extra: Record<string, string> = {}) => {
    const previa = (await chamar("GET", `/api/regras/previa?${new URLSearchParams({ padrao, categoria_id: String(categoria_id), ...extra })}`)).d;
    const r = await chamar("POST", "/api/regras", { padrao, categoria_id, ...extra });
    assert.equal(r.status, 200);
    assert.equal(r.d.recategorizados, previa.total);
    return { ...r.d.regra, conta: [previa.parecidos, previa.total] } as { id: number; conta: [number, number]; categoria_id: number };
  };

  const saida = await criar("pix fulana", 9, { sentido: "saida" });
  assert.deepEqual([saida.conta, cats()], [[3, 3], [9, 9, null, 9, null]]);
  const entrada = await criar("PIX FULANA", 18, { sentido: "entrada" }); // mesmo texto, outro sentido: convive
  assert.notEqual(entrada.id, saida.id);
  assert.deepEqual([entrada.conta, cats()], [[2, 2], [9, 9, 18, 9, 18]]);

  // mesmo texto, para tudo: existe, mas perde para as que têm sentido; repetir troca a categoria em vez de duplicar
  const geral = await criar("pix fulana", 21);
  assert.deepEqual([geral.conta, cats()], [[5, 0], [9, 9, 18, 9, 18]]);
  const repetida = await criar("Pix Fulana", 11);
  assert.deepEqual([repetida.id, repetida.categoria_id], [geral.id, 11]);
  assert.equal((await criar("pix fulana", 13, { sentido: "saida" })).id, saida.id);
  assert.deepEqual(cats(), [13, 13, 18, 13, 18]);

  // por conta: só a conta b; e com sentido e conta juntos
  const daB = await criar("pix fulana", 8, { conta_id: b });
  assert.deepEqual([daB.conta, cats()], [[2, 2], [13, 13, 18, 8, 8]]);
  const daBsaida = await criar("pix fulana", 3, { conta_id: b, sentido: "saida" });
  assert.deepEqual([daBsaida.conta, cats()], [[1, 1], [13, 13, 18, 3, 8]]);
  // texto mais longo vence, mesmo sem sentido: regra antiga e específica não perde para uma nova e curta
  const longa = await criar("pix fulana loja", 10);
  assert.deepEqual([longa.conta, cats()], [[5, 5], [10, 10, 10, 10, 10]]);
  // sem escolher a categoria (a tela mostra a prévia antes): conta o que a regra ganharia
  const semCategoria = async (padrao: string) => (await chamar("GET", `/api/regras/previa?${new URLSearchParams({ padrao })}`)).d;
  assert.deepEqual([await semCategoria("pix fulana"), await semCategoria("PIX FULANA LOJA")].map((p) => [p.parecidos, p.total, p.pendentes]), [[5, 0, 0], [5, 5, 0]]);
  assert.deepEqual((await semCategoria("pix fulana loja")).exemplos, [{ descricao: "Pix Fulana Loja", categoria: "Alimentação fora", qtd: 5 }]);

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

/** Base na versão atual, com uma conta, um lançamento categorizado, uma fatura, uma regra e um orçamento. */
function baseComDados(caminho = ":memory:") {
  const m = new DatabaseSync(caminho);
  MIGRACOES.forEach((sql) => m.exec(sql));
  m.exec(`PRAGMA user_version = ${MIGRACOES.length};
    INSERT INTO conexoes (item_id) VALUES ('i'); INSERT INTO contas (id, item_id, apelido) VALUES ('c', 'i', 'minha conta');
    INSERT INTO lancamentos (id, conta_id, data, valor_centavos, categoria_id, notas) VALUES ('l', 'c', '2026-01-01', -1, 3, 'minha nota');
    INSERT INTO faturas (id, conta_id) VALUES ('f', 'c');
    INSERT INTO regras (padrao, categoria_id, conta_id) VALUES ('mercado', 3, 'c');
    INSERT INTO orcamentos (categoria_id, mes, valor_centavos) VALUES (3, '2026-01', 100)`);
  return m;
}
const pragma = (m: DatabaseSync, nome: string) => Object.values(m.prepare(`PRAGMA ${nome}`).get() as object)[0];
const conteudo = (m: DatabaseSync) =>
  JSON.stringify((m.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map(({ name }) => [name, m.prepare(`SELECT * FROM ${name}`).all()]));

test("migração que recria tabela não apaga nada em cascata e as referências continuam valendo", () => {
  for (const tabela of ["contas", "categorias"]) {
    const m = baseComDados();
    const antes = conteudo(m);
    const { sql } = m.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(tabela) as { sql: string };
    migrar(m, [...MIGRACOES, `${sql.replace(tabela, `${tabela}_nova`)}; INSERT INTO ${tabela}_nova SELECT * FROM ${tabela};
      DROP TABLE ${tabela}; ALTER TABLE ${tabela}_nova RENAME TO ${tabela};`]);
    assert.equal(conteudo(m), antes, tabela);
    assert.deepEqual([pragma(m, "user_version"), pragma(m, "foreign_keys")], [MIGRACOES.length + 1, 1]);
    assert.throws(() => m.exec("INSERT INTO lancamentos (id, conta_id, data, valor_centavos) VALUES ('x', 'não existe', '2026-01-01', -1)"), /FOREIGN KEY/);
    assert.throws(() => m.exec("DELETE FROM categorias WHERE id = 3"), /FOREIGN KEY/);
    m.close();
  }
});

test("migração que deixa registro órfão ou dá erro é desfeita inteira, e as chaves estrangeiras voltam a valer", () => {
  for (const [ruim, erro] of [["DELETE FROM contas", /migração \d+.*(faturas|lancamentos|regras)/], ["DELETE FROM faturas; SELECT * FROM nao_existe", /no such table/]] as const) {
    const m = baseComDados();
    const antes = conteudo(m);
    assert.throws(() => migrar(m, [...MIGRACOES, "CREATE TABLE boa (x)", ruim, "CREATE TABLE depois (x)"]), erro);
    assert.equal(pragma(m, "user_version"), MIGRACOES.length + 1); // a anterior fica; a ruim e a seguinte, não
    m.exec("DROP TABLE boa");
    assert.equal(conteudo(m), antes);
    assert.equal(pragma(m, "foreign_keys"), 1);
    m.close();
  }
});

const copias = (tipo: string) => fs.readdirSync(path.join(dir, "copias")).filter((n) => n.startsWith(`t-${tipo}-`)).sort();
const abrirCopia = (nome: string) => new DatabaseSync(path.join(dir, "copias", nome), { readOnly: true });

test("cópia: feita antes da migração, com o que ainda está só no -wal; sem migração pendente ou em base nova, nenhuma", () => {
  const arquivo = path.join(dir, "m.db");
  const m = baseComDados(arquivo);
  m.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; UPDATE lancamentos SET notas = 'só no wal'");
  for (const n of copias("migracao")) fs.rmSync(path.join(dir, "copias", n)); // dos testes acima, talvez no mesmo segundo
  migrar(m);
  migrar(new DatabaseSync(":memory:"));
  assert.deepEqual(copias("migracao"), []);
  migrar(m, [...MIGRACOES, "UPDATE lancamentos SET notas = 'estragou'", "CREATE TABLE nova (x)"]);
  const novas = copias("migracao");
  assert.equal(novas.length, 1); // uma por início, antes da primeira pendente
  assert.match(novas[0], /^t-migracao-\d{4}-\d{2}-\d{2}-\d{6}-v\d+\.db$/);
  assert.ok(novas[0].endsWith(`-v${MIGRACOES.length}.db`));
  const c = abrirCopia(novas[0]);
  assert.deepEqual([pragma(c, "user_version"), pragma(c, "integrity_check")], [MIGRACOES.length, "ok"]);
  assert.equal((c.prepare("SELECT notas FROM lancamentos").get() as { notas: string }).notas, "só no wal");
  c.close();
  m.close();
});

test("cópia: se não deu para copiar, não migra; a do dia só avisa e o app segue", () => {
  const m = baseComDados();
  const pasta = env.copiasDir;
  env.copiasDir = path.join(dir, "t.db", "impossivel"); // dentro de um arquivo
  try {
    assert.throws(() => migrar(m, [...MIGRACOES, "DELETE FROM lancamentos"]), /cópia.*não foi migrada/);
    assert.deepEqual([pragma(m, "user_version"), pragma(m, "foreign_keys")], [MIGRACOES.length, 1]);
    assert.ok(m.prepare("SELECT 1 FROM lancamentos").get());
    assert.doesNotThrow(copiaDoDia);
  } finally {
    env.copiasDir = pasta;
    m.close();
  }
});

test("cópia do dia: feita ao subir, uma por dia, 14 de cada tipo, sem tocar nos outros arquivos nem deixar resto", () => {
  const { hoje } = db.prepare("SELECT date('now','localtime') AS hoje").get() as { hoje: string };
  assert.deepEqual(copias("diaria"), [`t-diaria-${hoje}.db`]); // o início do servidor fez
  const daqui = path.join(dir, "copias");
  const falso = (nome: string) => fs.writeFileSync(path.join(daqui, nome), "x");
  for (let d = 10; d < 26; d++) falso(`t-diaria-2020-01-${d}.db`);
  const outros = ["outra.db", "t-diaria-2020-01-01.db.123.tmp", "financas-diaria-2020-01-01.db", "t-migracao-2020-01-01-000000-v1.db"];
  outros.forEach(falso);
  copiaDoDia(); // a de hoje já existe: não refaz nem gira
  assert.equal(copias("diaria").filter((n) => n.endsWith(".db")).length, 17);
  fs.rmSync(path.join(daqui, `t-diaria-${hoje}.db`));
  copiaDoDia();
  const ficaram = copias("diaria").filter((n) => n.endsWith(".db"));
  assert.deepEqual([ficaram.length, ficaram[0], ficaram.at(-1)], [14, "t-diaria-2020-01-13.db", `t-diaria-${hoje}.db`]);
  for (const nome of outros) assert.ok(fs.existsSync(path.join(daqui, nome)), nome);
  const c = abrirCopia(`t-diaria-${hoje}.db`);
  const contar = (b: DatabaseSync) => (b.prepare("SELECT COUNT(*) AS n FROM lancamentos").get() as { n: number }).n;
  assert.equal(contar(c), contar(db));
  c.close();
  assert.deepEqual(fs.readdirSync(daqui).filter((n) => n.endsWith(".tmp")), ["t-diaria-2020-01-01.db.123.tmp"]);
});

test("transação que lê e depois grava não é derrubada por outro processo na mesma base", () => {
  const outro = new DatabaseSync(env.dbPath);
  const gravar = (b: DatabaseSync, valor: string) => b.exec(`INSERT INTO config VALUES ('trava', '${valor}') ON CONFLICT DO UPDATE SET valor = excluded.valor`);
  try {
    transacao(() => {
      db.prepare("SELECT COUNT(*) FROM config").get();
      assert.throws(() => gravar(outro, "outro"), /locked/); // quem chega depois é que espera
      gravar(db, "nosso");
    });
    assert.equal((outro.prepare("SELECT valor FROM config WHERE chave = 'trava'").get() as { valor: string }).valor, "nosso");
    outro.exec("BEGIN IMMEDIATE");
    db.exec("PRAGMA busy_timeout = 0");
    let entrou = false;
    assert.throws(() => transacao(() => (entrou = true)), /locked/); // com o outro gravando, nem começa
    assert.equal(entrou, false);
    outro.exec("ROLLBACK");
  } finally {
    db.exec("PRAGMA busy_timeout = 5000; DELETE FROM config WHERE chave = 'trava'");
    outro.close();
  }
});

test("base mais nova que o código é recusada, sem mexer nela", () => {
  const m = baseComDados();
  const antes = conteudo(m);
  m.exec(`PRAGMA user_version = ${MIGRACOES.length + 1}`);
  assert.throws(() => migrar(m), /mais nova/);
  assert.equal(conteudo(m), antes);
  assert.deepEqual([pragma(m, "user_version"), pragma(m, "foreign_keys")], [MIGRACOES.length + 1, 1]);
  m.close();
});

test("dois processos subindo juntos: a migração que o outro já fez não roda de novo", () => {
  const arquivo = path.join(dir, "dois.db");
  const m = baseComDados(arquivo), outro = new DatabaseSync(arquivo);
  const lista = [...MIGRACOES, "CREATE TABLE nova (x)", "INSERT INTO nova VALUES (1)"];
  const exec = m.exec.bind(m);
  let passou = false;
  m.exec = (sql: string) => {
    if (sql.startsWith("BEGIN") && !passou) (passou = true, migrar(outro, lista)); // entre ler a versão e começar
    exec(sql);
  };
  migrar(m, lista);
  assert.deepEqual([pragma(m, "user_version"), (m.prepare("SELECT COUNT(*) AS n FROM nova").get() as { n: number }).n], [lista.length, 1]);
  outro.close();
  m.close();
});

test("ao subir, as regras são reaplicadas por inteiro ou nada", () => {
  const arquivo = path.join(dir, "subir.db");
  const m = baseComDados(arquivo);
  // os dois perderiam a categoria (nenhuma regra nem categoria da Pluggy); o segundo falha no meio
  m.exec(`INSERT INTO lancamentos (id, conta_id, data, valor_centavos, categoria_id) VALUES ('z', 'c', '2026-01-02', -1, 3);
    CREATE TRIGGER falha BEFORE UPDATE ON lancamentos WHEN OLD.id = 'z' BEGIN SELECT RAISE(ABORT, 'falha no meio'); END`);
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/server.ts"], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, DB_PATH: arquivo, PORT: String(PORTA + 1) },
  });
  assert.match(r.stderr, /falha no meio/);
  assert.deepEqual((m.prepare("SELECT categoria_id AS c FROM lancamentos ORDER BY id").all() as { c: number }[]).map((l) => l.c), [3, 3]);
  m.close();
});

test("contar usos de categoria e de regra não varre todos os lançamentos", () => {
  for (const coluna of ["categoria_id", "regra_id"]) {
    const plano = db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM lancamentos WHERE ${coluna} = 1`).all() as { detail: string }[];
    assert.match(plano[0].detail, new RegExp(`^SEARCH lancamentos USING COVERING INDEX .*${coluna}=`));
  }
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
  assert.deepEqual(reaplicarRegras(), []); // de novo: nada muda e nada conta
  // até aqui sem saber o banco (nulo); no Nubank é igual, em outro o Pix no crédito não se aplica
  const tudo = () => db.prepare("SELECT id, categoria_id, regra_id FROM lancamentos WHERE id LIKE 'pix%' ORDER BY id").all();
  const resolvido = tudo();
  for (const [banco, vale] of [["260", true], ["323", false], ["999", false], [null, true]] as const) {
    db.prepare("UPDATE conexoes SET banco = ? WHERE item_id = ?").run(banco, ITEM);
    reaplicarRegras();
    if (vale) assert.deepEqual(tudo(), resolvido, `banco ${banco}`);
    else assert.deepEqual(pernas(semNome), [null, "Mercado", null], `banco ${banco}`);
  }
  await chamar("DELETE", `/api/regras/${regra}`);

  // editar uma perna ajusta as outras na hora, sem esperar a sincronização, e diz quais mudaram
  const editar = async (perna: string, d: object) => {
    const r = await chamar("PATCH", `/api/lancamentos/${perna}`, d);
    assert.equal(r.status, 200);
    return [r.d.categoria, r.d.tambem_mudaram.map((l: any) => l.id).sort()];
  };
  const op = operacao("2031-04-10T12:00:00Z", 10000, { pix: { categoria_pluggy: "Groceries" } });
  const resolvida = [FORA, FORA, "Mercado"], solta = [null, "Mercado", null];
  reaplicarRegras();
  assert.deepEqual([pernas(op), await mes("2031-04")], [resolvida, [0, 10300, -10300]]);
  assert.deepEqual(await editar(`${op}c`, { ignorado: true }), [null, [`${op}e`, `${op}s`]]);
  assert.deepEqual([pernas(op), await mes("2031-04")], [solta, [10000, 10000, 0]]); // sem a cobrança, o Pix e a entrada dele contam; o resultado é só a cobrança a menos
  assert.deepEqual(await editar(`${op}c`, { ignorado: false }), ["Mercado", [`${op}e`, `${op}s`]]);
  assert.deepEqual([pernas(op), await mes("2031-04")], [resolvida, [0, 10300, -10300]]);
  assert.deepEqual(await editar(`${op}s`, { categoria_id: 7 }), ["Educação", [`${op}c`, `${op}e`]]); // Pix editado à mão: a operação fica como o banco mandou
  assert.deepEqual(await editar(`${op}s`, { categoria_id: null }), [FORA, [`${op}c`, `${op}e`]]); // desfazer volta ao automático
  assert.deepEqual(pernas(op), resolvida);
  assert.deepEqual(await editar(`${op}c`, { categoria_id: 13 }), ["Lazer", []]); // categorizar a cobrança é o uso normal: o par continua fora
  assert.deepEqual(await editar(`${op}c`, { categoria_id: null }), ["Mercado", []]);
  assert.deepEqual(await editar(`${op}s`, { descricao: "Nome limpo", notas: "x", tags: ["y"] }), [FORA, []]);
  for (const [campo, sai, volta] of [["oculta", true, false], ["pessoa", "PJ", "PF"]] as const) {
    await chamar("PATCH", `/api/contas/${cartao}`, { [campo]: sai });
    assert.deepEqual(pernas(op), solta, campo);
    await chamar("PATCH", `/api/contas/${cartao}`, { [campo]: volta });
    assert.deepEqual(pernas(op), resolvida, campo);
  }
  // a edição recusada não fica pela metade nem trava a próxima
  assert.equal((await chamar("PATCH", "/api/lancamentos/nao-existe", { ignorado: true })).status, 404);
  assert.equal((await chamar("PATCH", `/api/lancamentos/${op}c`, { ignorado: true, categoria_id: 99999 })).status, 400);
  assert.deepEqual([pernas(op), lanc(`${op}c`).ignorado], [resolvida, 0]);

  // a prévia conta o que o Pix no crédito puxa: o texto só está no Pix, mas quem muda são as três parcelas da cobrança, que herdam dele
  const id = operacao("2031-05-10T12:00:00Z", 10000, { pix: { descricao_original: "Transferência enviada|Ciclana QWZ" }, parcelas: 3 });
  reaplicarRegras();
  assert.deepEqual(pernas(id), [FORA, FORA, null]);
  const criarRegra = async (categoria_id: number) => {
    const previa = (await chamar("GET", `/api/regras/previa?padrao=ciclana+qwz&categoria_id=${categoria_id}`)).d;
    const antes = tudo();
    assert.deepEqual((await chamar("GET", `/api/regras/previa?padrao=ciclana+qwz&categoria_id=${categoria_id}`)).d, previa);
    assert.deepEqual(tudo(), antes); // a prévia não grava
    const r = (await chamar("POST", "/api/regras", { padrao: "ciclana qwz", categoria_id })).d;
    assert.equal(r.recategorizados, previa.total);
    return { regra: r.regra.id, previa };
  };
  const gasto = await criarRegra(8);
  assert.deepEqual([gasto.previa.parecidos, gasto.previa.total, gasto.previa.pendentes], [1, 3, 3]);
  assert.deepEqual([gasto.previa.exemplos, pernas(id)], [[{ descricao: "Pagamento de pix", categoria: null, qtd: 3 }], [FORA, FORA, "Pet"]]);
  // para uma categoria de transferência, o Pix no crédito não mexe na operação: as outras pernas voltam ao que eram, e a prévia diz para onde vão
  const fora = await criarRegra(TRANSFERENCIA);
  assert.deepEqual([fora.previa.parecidos, fora.previa.total, pernas(id)], [1, 4, [null, FORA, null]]);
  assert.deepEqual(fora.previa.exemplos.map((x: any) => [x.categoria, x.vai_para, x.qtd]), [["Pet", null, 3], [FORA, null, 1]]);
  await chamar("DELETE", `/api/regras/${fora.regra}`);
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

test("busca: maiúsculas e acentos não contam, nos três campos, e % e _ são texto", async () => {
  const conta = novaConta("BANK");
  for (const [i, descricao_original, extra] of [[1, "LOJINHA ÉBANO", {}], [2, "loja 100% nova", {}], [3, "loja 1000 nova", {}], [4, "a_b cd", {}], [5, "axb cd", { descricao: "Ômega Zyx" }], [6, "outra", { notas: "Reforço da ÁREA" }]] as const)
    novoLanc(conta, "2031-03-01", -i, null, { descricao_original, ...extra });
  const achados = async (busca: string) => {
    const { d } = await chamar("GET", `/api/lancamentos?${new URLSearchParams({ mes: "2031-03", busca })}`);
    assert.equal(d.total, d.itens.length);
    return d.itens.map((l: any) => -l.valor_centavos).sort();
  };
  assert.deepEqual(await achados("lojinha ébano"), [1]);
  assert.deepEqual(await achados("Ébano"), [1]);
  assert.deepEqual(await achados("ebano"), [1]); // digitado sem acento acha o acentuado
  assert.deepEqual(await achados("lójinha"), [1]); // e o contrário
  assert.deepEqual(await achados("e\u0301bano"), [1]); // acento como caractere à parte
  assert.deepEqual(await achados("reforco da area"), [6]);
  assert.deepEqual(await achados("ÔMEGA"), [5]);
  assert.deepEqual(await achados("reforço da área"), [6]);
  assert.deepEqual(await achados("100%"), [2]);
  assert.deepEqual(await achados("a_b"), [4]);
  assert.deepEqual(await achados("NOVA"), [2, 3]);
  db.prepare("DELETE FROM lancamentos WHERE data = '2031-03-01'").run();
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
  const marcas = (await chamar("GET", "/api/lancamentos?mes=2015-06")).d.itens as { id: string; soma: boolean; estorno: boolean }[];
  assert.deepEqual(marcas.filter((l) => l.estorno).map((l) => l.id), ["est", "est-sem"]); // a tela e o filtro usam a mesma regra
  assert.deepEqual(marcas.filter((l) => !l.soma).map((l) => l.id).sort(), ["est-ign", "est-rem"]);
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

  // quitado ou vendido = valor 0: o passado fica; só apagar (engano) muda os dias anteriores
  const passado = async () => (await ver()).historico[0].total;
  foto.run("bem", String(carro.id), 500000);
  assert.equal(await passado(), 595000);
  await chamar("PATCH", `/api/bens/${carro.id}`, { valor_centavos: 0 });
  assert.deepEqual([await passado(), (await ver()).bens], [595000, 0]);
  await chamar("DELETE", `/api/bens/${carro.id}`);
  assert.equal(await passado(), 95000);
  assert.equal((await ver()).lista_bens.length, 1);
  assert.equal(fotos(String(carro.id)).length, 0);
});

test("cofrinho e caixinha: só somam com o sim do usuário; trocar de id, esvaziar ou vir sem dado não estraga o total", async () => {
  const antes = { paginas, contasFalsas, porPagina };
  const CONTA = "55555555-5555-4555-8555-555555555555";
  const fotosAntes = db.prepare("SELECT * FROM saldos_diarios ORDER BY 1,2,3").all();
  const reserva = (identification: string, ...faixas: (number | null)[]) => ({ identification, name: `Cofre ${identification}`, availableAmounts: faixas.map((amount) => ({ amount })) });
  const lerBanco = async (bankData: object | null, pessoa = "PF") => {
    paginas = [[]];
    contasFalsas = [antes.contasFalsas[0], { id: CONTA, type: "BANK", name: "Conta", balance: 10, bankData }];
    await sync();
    return (await chamar("GET", `/api/patrimonio?pessoa=${pessoa}`)).d;
  };
  const guardado = () =>
    Object.fromEntries((db.prepare("SELECT substr(id, 38) AS id, saldo_centavos AS s FROM investimentos WHERE tipo = 'RESERVA' ORDER BY id").all() as any[]).map((r) => [r.id, r.s]));
  const fotos = () => (db.prepare("SELECT COUNT(*) AS n FROM saldos_diarios WHERE ref_id LIKE ?").get(`${CONTA}:%`) as any).n;
  const responder = async (d: object) => {
    assert.equal((await chamar("PATCH", `/api/contas/${CONTA}`, d)).status, 200);
    return (await chamar("GET", "/api/patrimonio")).d;
  };

  const base = await lerBanco(null);
  const doBanco = { hasReservedBalance: true, reservedBalances: [reserva("a", 100, 20.5), { ...reserva("b", 30), name: undefined }] };
  // sem resposta: guarda, mas não soma nem entra na foto (o valor pode estar numa linha manual)
  let p = await lerBanco(doBanco);
  assert.deepEqual([p.total, guardado(), fotos()], [base.total, { a: 12050, b: 3000 }, 0]);
  const { investimentos, contas } = (await chamar("GET", "/api/contas")).d;
  assert.deepEqual(investimentos.filter((i: any) => i.conta_id === CONTA).map((i: any) => [i.nome, i.conta, i.ativo]), [["Cofre a", "Conta", 0], ["Reserva sem nome", "Conta", 0]]);
  assert.equal(contas.find((c: any) => c.id === CONTA).usa_reservas, null);
  // sim: soma em investimentos e entra na foto de hoje
  p = await responder({ usa_reservas: true });
  assert.deepEqual([p.investimentos, p.total, fotos()], [base.investimentos + 15050, base.total + 15050, 2]);
  const { cliente, usar } = await ligarMcp();
  const noMcp = async () => {
    const r = await usar("contas");
    return [r.contas.find((c: any) => c.id === CONTA).usa_cofrinho, r.investimentos.filter((i: any) => i.tipo === "RESERVA").map((i: any) => [i.saldo, i.conta, i.soma_no_patrimonio])];
  };
  assert.deepEqual(await noMcp(), [true, [[120.5, "Conta", true], [30, "Conta", true]]]);
  // a conta manda: oculta não soma; PJ vai para a empresa
  assert.equal((await responder({ oculta: true })).total, base.total - 1000);
  assert.equal((await responder({ oculta: false, pessoa: "PJ" })).investimentos, base.investimentos);
  assert.equal((await responder({ pessoa: "PF" })).total, base.total + 15050);
  // o banco trocou os ids: as linhas antigas zeram, o total e o passado não mudam
  db.prepare("INSERT INTO saldos_diarios VALUES ('2021-01-01', 'investimento', ?, 5000)").run(`${CONTA}:a`);
  const passado = (h: { data: string; total: number }[]) => h.find((x) => x.data === "2021-01-01")?.total;
  p = await lerBanco({ hasReservedBalance: true, reservedBalances: [reserva("a2", 100, 20.5), reserva("b2", 30)] });
  assert.deepEqual([p.total, passado(p.historico), guardado()], [base.total + 15050, 5000, { a: 0, a2: 12050, b: 0, b2: 3000 }]);
  // sem a lista, o banco não informou: fica o último. Uma faixa sem valor também
  for (const bd of [null, {}, { hasReservedBalance: null, reservedBalances: null }, { hasReservedBalance: true, reservedBalances: null }, { hasReservedBalance: true, reservedBalances: [] },
    { hasReservedBalance: true, reservedBalances: [reserva("a2", 1, null), reserva("b2", 30)] }])
    assert.equal((await lerBanco(bd)).total, base.total + 15050, JSON.stringify(bd));
  // esvaziou uma, depois todas (o campo some e o banco diz que não há reserva)
  assert.equal((await lerBanco({ hasReservedBalance: true, reservedBalances: [reserva("b2", 30)] })).total, base.total + 3000);
  p = await lerBanco({ hasReservedBalance: false });
  assert.deepEqual([p.total, passado(p.historico)], [base.total, 5000]);
  // investimento de verdade (outro tipo) nunca é zerado por isto, e o não tira da foto de hoje sem mexer no passado
  assert.equal(p.investimentos, base.investimentos);
  await lerBanco(doBanco);
  p = await responder({ usa_reservas: false });
  assert.deepEqual([p.total, passado(p.historico), fotos()], [base.total, 5000, 1]);
  assert.deepEqual(await noMcp(), [false, [[120.5, "Conta", false], [30, "Conta", false]]]); // zerada não aparece
  await cliente.close();

  ({ paginas, contasFalsas, porPagina } = antes);
  db.prepare("DELETE FROM contas WHERE id = ?").run(CONTA);
  db.exec("DELETE FROM investimentos WHERE tipo = 'RESERVA'; DELETE FROM saldos_diarios");
  for (const f of fotosAntes as any[]) db.prepare("INSERT INTO saldos_diarios VALUES (?,?,?,?)").run(f.data, f.origem, f.ref_id, f.saldo_centavos);
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

test("recorrentes: a já lançada com data futura não conta de novo como a que ainda vem", () => {
  const passado = ["2031-03-10", "2031-04-10", "2031-05-10"].flatMap((d) => [g("Streaming", d, 4000), g("Streaming", d, 9000)]);
  const ver = (...futuro: ReturnType<typeof g>[]) =>
    detectarRecorrentes([...passado, ...futuro], "2031-05-20").map((r) => [r.valor, r.vezes, r.ultima, r.proxima, r.a_lancar]).sort((a, b) => Number(a[0]) - Number(b[0]));
  const normal = (valor: number) => [valor, 3, "2031-05-10", "2031-06-10", "2031-06-10"];
  assert.deepEqual(ver(), [normal(4000), normal(9000)]);
  // só a de valor parecido anda, quantos meses já vierem, e nada mais muda na lista
  assert.deepEqual(ver(g("Streaming", "2031-06-10", 8700)), [normal(4000), [9000, 3, "2031-05-10", "2031-06-10", "2031-07-10"]]);
  assert.deepEqual(ver(g("Streaming", "2031-06-10", 9000), g("Streaming", "2031-07-10", 9000))[1][4], "2031-08-10");
  assert.deepEqual(ver(g("Streaming", "2031-06-10", 9000), g("Streaming", "2031-06-11", 4000)).map((r) => r[4]), ["2031-07-11", "2031-07-10"]);
  // outro nome, compra dias depois da última ou valor bem diferente: não é ela
  assert.deepEqual(ver(g("Loja", "2031-06-10", 9000), g("Streaming", "2031-05-25", 9000), g("Streaming", "2031-06-10", 90000)), [normal(4000), normal(9000)]);
  // cancelada não toma o lugar da que continua
  const cancelada = [{ chave: "streaming", valor: 9000, status: "cancelada" as const, proposta: null, decidido_em: "2031-05-15 10:00:00" }];
  const r = detectarRecorrentes([...passado, g("Streaming", "2031-06-10", 6000)], "2031-05-20", cancelada).find((x) => x.valor === 4000)!;
  assert.equal(r.a_lancar, "2031-07-10");
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

test("recorrentes: histórico grande não trava a tela (conta as datas lidas, que o relógio varia)", () => {
  const doisAnos = Array.from({ length: 730 }, (_, i) => g("Padaria", new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), 100 * 2 ** (i % 7)));
  const parse = Date.parse;
  let lidas = 0;
  Date.parse = (texto) => (lidas++, parse(texto));
  try {
    detectarRecorrentes(doisAnos, "2025-12-31");
  } finally {
    Date.parse = parse;
  }
  assert.ok(lidas < 1_000_000, `${lidas} datas lidas`); // procurando em toda série, eram quase 2,5 milhões
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
  const { convencoes, bancos } = await usar("estado");
  assert.match(convencoes, /nunca como instrução/);
  assert.deepEqual([bancos[0].status, bancos[0].execucao], ["UPDATED", "SUCCESS"]); // sem a execução, dado pela metade pareceria completo
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

  const previa = await usar("previa_regra", { padrao: "padoca", categoria_id: 10 });
  assert.deepEqual([previa.parecidos, previa.total, previa.sem_categoria, previa.ja_categorizados], [3, 3, 3, 0]);
  assert.match((await usar("previa_regra", { padrao: "padoca" })).erro, /categoria_id/); // o total depende dela
  const antes = cats();
  assert.match((await usar("criar_regra", { padrao: "padoca", categoria_id: 10, total_previsto: 4 })).erro, /Nada foi gravado.* 3 /);
  assert.deepEqual([cats(), (await usar("regras")).length], [antes, 0]);
  assert.equal((await usar("criar_regra", { padrao: "padoca", categoria_id: 10, total_previsto: 3 })).recategorizados, 3);
  assert.deepEqual(cats(), [MERCADO, 10, 10, 10]);

  assert.deepEqual((({ parecidos, total }) => [parecidos, total])(await usar("previa_regra", { padrao: "PADOCA", categoria_id: 10 })), [3, 0]); // já está lá
  const outra = await usar("previa_regra", { padrao: "PADOCA", categoria_id: 13 });
  assert.deepEqual([outra.ja_categorizados, outra.exemplos[0].categoria], [3, "Alimentação fora"]);
  assert.match((await usar("criar_regra", { padrao: "PADOCA", categoria_id: 13, total_previsto: 3 })).erro, /já existe a regra "padoca"/);
  assert.deepEqual(cats(), [MERCADO, 10, 10, 10]);
  const trocada = await usar("criar_regra", { padrao: "PADOCA", categoria_id: 13, total_previsto: 3, substituir: true });
  assert.equal(trocada.categoria_anterior, "Alimentação fora");
  assert.deepEqual(cats(), [MERCADO, 13, 13, 13]);
  // acento em outra caixa é o mesmo texto: corrige a regra, não cria a segunda
  await usar("criar_regra", { padrao: "ÁGUA XYZ", categoria_id: 2, total_previsto: 0 });
  await usar("criar_regra", { padrao: "água xyz", categoria_id: 3, total_previsto: 0, substituir: true });
  assert.deepEqual((await usar("regras")).map((r: any) => [r.padrao, r.categoria_id]).sort(), [["padoca", 13], ["ÁGUA XYZ", 3]]);

  // sentido: a prévia conta só aquele lado; texto que já tem regra (mesmo de outro alcance) continua pedindo substituir
  const entra = { padrao: "padoca", sentido: "entrada" };
  assert.equal((await usar("previa_regra", { ...entra, categoria_id: RENDA })).total, 1);
  assert.match((await usar("criar_regra", { ...entra, categoria_id: RENDA, total_previsto: 3 })).erro, /Nada foi gravado.* 1 /);
  assert.match((await usar("criar_regra", { ...entra, categoria_id: RENDA, total_previsto: 1 })).erro, /já existe a regra "padoca" → /);
  assert.equal((await usar("criar_regra", { ...entra, categoria_id: RENDA, total_previsto: 1, substituir: true })).recategorizados, 1);
  assert.deepEqual(cats(), [MERCADO, 13, RENDA, 13]);
  assert.match((await usar("criar_regra", { ...entra, categoria_id: 10, total_previsto: 1 })).erro, /"padoca" \(só entrada\) → Renda/);
  const daConta = { padrao: "padoca", conta_id: (lanc(itens[0].id) as any).conta_id };
  assert.equal((await usar("previa_regra", { ...daConta, categoria_id: 10 })).total, 2);
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

  const base = { gastoAteODia: 1000, dia: 10, diasNoMes: 30, depoisDoDia: [500, 900, 700], jaLancado: 1000 };
  assert.deepEqual(projetar(base), { min: 1700, max: 3000, media: 2350 });
  assert.deepEqual([4, 0].map((dia) => projetar({ ...base, dia })), [null, null]); // cedo demais, ou nenhum dado no mês
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

test("alarme e análises: mesma janela no acumulado, aviso do início que mudou, sem normal não é estouro e recorrente lançada não conta duas vezes", async () => {
  // meses e renda do teste do ritmo
  const conta = novaConta("BANK"), { mes, inicio } = (await chamar("GET", "/api/ritmo")).d, m = (k: number) => somarMes(mes, k);
  const ver = async (qual = mes) => ({ r: (await chamar("GET", `/api/ritmo?mes=${qual}`)).d, a: (await chamar("GET", `/api/analises?mes=${qual}`)).d });
  const limpar = () => db.prepare("DELETE FROM lancamentos WHERE conta_id = ?").run(conta);
  const base = await ver();
  assert.deepEqual([base.r.inicio_antes, base.a.inicio_antes], [null, null]);

  // V8: no mês passado a mediana era menor e mais um mês entrava na análise
  novoLanc(conta, `${m(-4)}-05`, 480000, RENDA);
  const mudou = await ver();
  assert.deepEqual([mudou.r.inicio, mudou.r.inicio_antes, mudou.a.inicio_antes], [inicio, m(-4), m(-4)]);
  const { cliente, usar } = await ligarMcp();
  assert.deepEqual([(await usar("ritmo_do_mes")).analise_desde_mudou_era, (await usar("analises")).analise_desde_mudou_era], [m(-4), m(-4)]);
  await chamar("PUT", "/api/analises/inicio", { mes: m(-2) });
  assert.equal((await ver()).a.inicio_antes, null); // escolhido não muda sozinho
  await chamar("PUT", "/api/analises/inicio", { mes: null });
  limpar();

  // V9: com histórico longo, as duas telas somam os mesmos 12 meses
  for (let k = 4; k <= 15; k++) {
    novoLanc(conta, `${m(-k)}-05`, 1000000, RENDA);
    novoLanc(conta, `${m(-k)}-06`, -100000 - k, MERCADO);
  }
  const longo = await ver(), fechados = longo.a.meses.filter((x: any) => !x.aberto);
  assert.deepEqual([longo.r.acumulado.meses, longo.r.acumulado.de, longo.r.acumulado.ate], [12, m(-12), m(-1)]);
  assert.deepEqual([fechados.length, fechados[0].mes, fechados.at(-1).acumulado], [12, m(-12), longo.r.acumulado.sobra]);
  assert.deepEqual([longo.a.meses.at(-1).mes, longo.a.meses.length], [mes, 13]);
  limpar();

  // V12: gasto esporádico e reembolso maior que o gasto não têm normal; não encabeçam o alarme
  const nova = async (nome: string) => (await chamar("POST", "/api/categorias", { nome, grupo: "essencial" })).d.id as number;
  const esporadica = await nova("Esporádica"), reembolsada = await nova("Reembolsada"), comum = await nova("Comum");
  for (const k of [1, 2]) {
    novoLanc(conta, `${m(-k)}-07`, 70000, reembolsada);
    novoLanc(conta, `${m(-k)}-07`, -30000, comum);
  }
  for (const c of [esporadica, reembolsada, comum]) novoLanc(conta, `${mes}-01`, -900000, c);
  const { r, a } = await ver(), linha = (id: number) => a.categorias.find((c: any) => c.categoria_id === id);
  assert.deepEqual([esporadica, reembolsada, comum].map((id) => [linha(id).gasto, linha(id).normal]), [[900000, null], [900000, null], [900000, 30000]]);
  const acima = r.acima.map((c: any) => c.categoria_id);
  assert.deepEqual([acima.includes(esporadica), acima.includes(reembolsada), acima.includes(comum)], [false, false, true]);
  assert.equal((await usar("analises")).categorias.find((c: any) => c.categoria_id === esporadica).normal, null);
  limpar();
  for (const id of [esporadica, reembolsada, comum]) assert.equal((await chamar("DELETE", `/api/categorias/${id}`)).status, 200);

  // V11: a academia deste mês e a do próximo já lançadas: estão no gasto, não no que ainda vem
  for (const k of [0, 1]) novoLanc(conta, `${m(k)}-28`, -5000, MERCADO, { descricao_original: "Academia", descricao: "Academia" });
  const lancada = await ver(), total = (x: typeof base, i: number) => x.a.comprometido[i].parcelas + x.a.comprometido[i].recorrentes;
  assert.equal(lancada.r.gasto, base.r.gasto + 5000);
  assert.deepEqual([lancada.r.por_dia.recorrentes, lancada.r.por_dia.livre], [base.r.por_dia.recorrentes - 5000, base.r.por_dia.livre]);
  assert.deepEqual([lancada.a.comprometido[0].recorrentes, total(lancada, 0)], [base.a.comprometido[0].recorrentes - 5000, total(base, 0)]);
  assert.deepEqual(lancada.a.comprometido.slice(1), base.a.comprometido.slice(1));
  limpar();
  await cliente.close();
  assert.deepEqual(await ver(), base);
});

test("projeção e curva do mês param no último dia com dado de todos os bancos; o que falta do mês conta de hoje", async () => {
  // meses e renda do teste do ritmo; o relógio é a data de atualização das conexões
  const antigas = db.prepare("SELECT item_id, atualizado_pluggy FROM conexoes").all() as { item_id: string; atualizado_pluggy: string | null }[];
  const OUTRO = "73737373-7373-4373-8373-737373737373";
  db.prepare("INSERT INTO conexoes (item_id, conector) VALUES (?, 'Outro banco')").run(OUTRO);
  const conta = novaConta("BANK", { item: OUTRO });
  const lido = (item: string, data: string | null) => db.prepare("UPDATE conexoes SET atualizado_pluggy = ? WHERE item_id = ?").run(data, item);
  const ver = async () => ({ r: (await chamar("GET", "/api/ritmo")).d, a: (await chamar("GET", "/api/analises")).d });
  for (const c of antigas) lido(c.item_id, null);

  const { r: sem, a: semA } = await ver(); // nenhum banco disse: vale hoje
  const { hoje, mes } = sem, menos = (n: number) => new Date(Date.parse(hoje) - n * 86_400_000).toISOString().slice(0, 10);
  const as12 = (data: string) => new Date(`${data}T12:00:00`).toISOString(); // meio-dia local
  assert.deepEqual([sem.dados_ate, semA.dia_a_dia.dados_ate, semA.dia_a_dia.dias.length], [hoje, hoje, Number(hoje.slice(8))]);

  lido(ITEM, as12(hoje));
  lido(OUTRO, as12(menos(1)));
  const gastoDeHoje = 12345; // chegou por um banco só: fica fora da conta até o outro chegar lá
  novoLanc(conta, hoje, -gastoDeHoje, MERCADO, { id: "de_hoje" });
  const { r, a } = await ver(), ontem = menos(1), dias = ontem < `${mes}-01` ? 0 : Number(ontem.slice(8));
  assert.deepEqual([r.dados_ate, a.dia_a_dia.dados_ate, a.dia_a_dia.dias], [ontem, ontem, semA.dia_a_dia.dias.slice(0, dias)]);
  assert.equal(r.gasto, sem.gasto + gastoDeHoje); // o Resumo não muda
  assert.deepEqual([r.por_dia.dias, r.por_dia.livre], [sem.por_dia.dias, sem.por_dia.livre - gastoDeHoje]);
  const curvas = await Promise.all([1, 2, 3].map(async (k) => (await chamar("GET", `/api/analises?mes=${somarMes(mes, -k)}`)).d.dia_a_dia.dias as number[]));
  const fim = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0)).getUTCDate();
  assert.deepEqual(r.projecao, projetar({
    gastoAteODia: a.dia_a_dia.dias.at(-1) ?? 0, dia: dias, diasNoMes: fim, jaLancado: r.gasto,
    depoisDoDia: curvas.map((c) => c.at(-1)! - (dias ? c[Math.min(dias, c.length) - 1] : 0)),
  }));

  // banco parado há dias não segura os outros; oculto ou PJ não conta; data no futuro não passa de hoje
  lido(OUTRO, as12(menos(9)));
  assert.equal((await ver()).r.dados_ate, hoje);
  lido(OUTRO, as12(menos(1)));
  for (const [coluna, valor, volta] of [["oculta", 1, 0], ["pessoa", "PJ", "PF"]] as const) {
    db.prepare(`UPDATE contas SET ${coluna} = ? WHERE id = ?`).run(valor, conta);
    assert.equal((await ver()).r.dados_ate, hoje, coluna);
    db.prepare(`UPDATE contas SET ${coluna} = ? WHERE id = ?`).run(volta, conta);
  }
  for (const i of [ITEM, OUTRO]) lido(i, as12(menos(-1)));
  assert.equal((await ver()).r.dados_ate, hoje);

  // ninguém sincroniza há um mês: sem dado no mês não há projeção nem curva, e o mês continua na análise
  for (const i of [ITEM, OUTRO]) lido(i, as12(menos(40)));
  const velho = await ver();
  assert.deepEqual([velho.r.projecao, velho.a.dia_a_dia.dias, velho.a.dia_a_dia.ja_lancado], [null, [], r.gasto]);
  assert.ok(velho.a.categorias.length > 0 && velho.a.dia_a_dia.anterior.length > 0);
  const { cliente, usar } = await ligarMcp();
  assert.equal((await usar("ritmo_do_mes")).dados_do_banco_ate, menos(40));
  assert.equal((await usar("analises")).gasto_acumulado_por_dia.dados_do_banco_ate, menos(40));
  assert.ok(!("dados_do_banco_ate" in (await usar("ritmo_do_mes", { mes: somarMes(mes, -1) }))));
  await cliente.close();

  db.prepare("DELETE FROM conexoes WHERE item_id = ?").run(OUTRO); // a conta e o lançamento vão junto
  for (const c of antigas) lido(c.item_id, c.atualizado_pluggy);
});

test("parcelas previstas: só de compra que o banco não manda adiante, do mês seguinte em diante, e cada compra uma vez só", () => {
  const p = (parcela: number, data: string, extra: object = {}) => ({ id: `p${parcela}`, conta_id: "c", data, compra: "2031-05-14", valor: 2000, parcela, total: 10, ...extra });
  const ver = (...l: ReturnType<typeof p>[]) => parcelasPrevistas(l, "2031-11-20").map((x) => [x.ultima, x.mes, x.valor]);
  const fim = [["p6", "2031-12", 2000], ["p6", "2032-01", 2000], ["p6", "2032-02", 2000], ["p6", "2032-03", 2000]];
  assert.deepEqual(ver(p(1, "2031-05-14", { valor: 2009 }), p(2, "2031-05-14"), p(5, "2031-10-03"), p(6, "2031-11-07")), fim); // a 4ª não veio: não volta
  // o dia da compra pode mudar em um entre a 1ª parcela e as outras, e a 1ª leva os centavos: ainda é uma compra só
  assert.deepEqual(
    ver(p(1, "2031-10-12", { total: 3, compra: "2031-10-12", valor: 2002 }), p(2, "2031-11-07", { total: 3, compra: "2031-10-11" })), [["p2", "2031-12", 2000]]);
  // banco que manda as futuras; compra completa; compra sem parcela há meses (antecipada, cancelada, banco parou)
  assert.deepEqual(ver(p(6, "2031-11-07"), p(7, "2031-12-07")), []);
  assert.deepEqual(ver(p(9, "2031-10-07"), p(10, "2031-11-07")), []);
  assert.deepEqual(ver(p(2, "2031-07-26", { total: 12, compra: "2031-06-02" })), []);
  // a que deveria vir neste mês não é prevista (se sumiu, é o limite do cartão que acusa)
  assert.deepEqual(ver(p(1, "2031-10-11", { total: 3, compra: "2031-10-11" })), [["p1", "2031-12", 2000]]);
  // 2ª parcela com a data da compra: a 3ª é dois meses depois da compra, não um
  assert.deepEqual(ver(p(1, "2031-10-11", { total: 3, compra: "2031-10-11" }), p(2, "2031-10-11", { total: 3, compra: "2031-10-11" })), [["p2", "2031-12", 2000]]);
  // compras diferentes não se misturam: outro cartão, outro número de parcelas, outro valor
  const duas = [p(6, "2031-11-07"), p(7, "2031-12-07", { conta_id: "d" }), p(7, "2031-12-07", { total: 12 }), p(7, "2031-12-07", { valor: 2050 })];
  assert.deepEqual(ver(...duas), fim);
});

test("parcelas previstas: em série à parte, sem mexer em total nenhum, e só da compra que conta no Resumo", async () => {
  const { mes, hoje } = (await chamar("GET", "/api/ritmo")).d, m = (n: number) => somarMes(mes, n);
  const ver = async () => {
    const { comprometido } = (await chamar("GET", "/api/analises")).d;
    const futuro = (await chamar("GET", `/api/ritmo?mes=${m(2)}`)).d;
    assert.equal(futuro.parcelas_previstas, comprometido[1].previstas);
    return { previstas: comprometido.map((c: any) => c.previstas), resto: JSON.stringify([comprometido.map((c: any) => ({ ...c, previstas: 0 })), futuro.gasto]) };
  };
  const antes = await ver();
  const nada = Array(12).fill(0);
  assert.deepEqual(antes.previstas, nada); // nenhuma parcela dos testes acima tem o dia da compra
  const parcela = (conta: string, extra: Record<string, string | number> = {}) =>
    novoLanc(conta, `${m(-1)}-05`, -7000, MERCADO, { id: "prev", parcela: 2, total_parcelas: 4, bruto: JSON.stringify({ creditCardMetadata: { purchaseDate: `${m(-2)}-05T12:00:00.000Z` } }), ...extra });
  const tirar = () => db.exec("DELETE FROM lancamentos WHERE id = 'prev'");
  const cartao = novaConta("CREDIT");
  parcela(cartao);
  assert.ok(hoje > `${m(-1)}-05`);
  const com = await ver();
  assert.deepEqual(com.previstas, [7000, ...nada.slice(1)]); // a 3ª é deste mês; a 4ª, do próximo
  assert.deepEqual(JSON.parse(com.resto), JSON.parse(antes.resto));
  const { cliente, usar } = await ligarMcp();
  assert.equal((await usar("analises")).comprometido[0].parcelas_previstas, 70);
  assert.equal((await usar("ritmo_do_mes", { mes: m(1) })).parcelas_previstas_fora_do_gasto, 70);
  assert.ok(!("parcelas_previstas_fora_do_gasto" in (await usar("ritmo_do_mes"))));
  await cliente.close();
  tirar();
  for (const [conta, extra] of [
    [cartao, { ignorado: 1 }], [cartao, { status: "REMOVIDO" }], [cartao, { categoria_id: TRANSFERENCIA }], [cartao, { bruto: "{}" }],
    [novaConta("CREDIT", { pessoa: "PJ" }), {}], [novaConta("CREDIT", { oculta: 1 }), {}],
  ] as const) {
    parcela(conta, extra);
    assert.deepEqual((await ver()).previstas, nada, JSON.stringify(extra));
    tirar();
  }
});

// faturas mensais (fecham dia 3, vencem dia 12), uma compra de R$ 100 em cada; a primeira é a do começo do histórico
const faturaDe = (m: number, extra: object = {}) => ({ id: `f${m}`, vencimento: `2031-0${m}-12`, fechamento: `2031-0${m}-03`, total: 10000 as number | null, ...extra });
const compraDe = (m: number, extra: object = {}) => ({ data: `2031-0${m - 1}-15`, valor: -10000, fatura_id: `f${m}` as string | null, pagamento: 0, ...extra });
const MESES_FATURA = [2, 3, 4, 5, 6, 7];

test("fatura que não fecha: acusa o que falta e o que sobra, junta as seguidas, e cada falso positivo conhecido fica de fora", () => {
  const faturas = MESES_FATURA.map((m) => faturaDe(m)), compras = MESES_FATURA.map((m) => compraDe(m));
  type F = typeof faturas; type L = typeof compras;
  const ver = (fs: F, ls: L, banco: string | null = "999", hoje = "2031-07-20") =>
    faturasQueNaoFecham(banco, fs, ls, hoje).map((l) => [l.de.slice(5, 7), l.ate.slice(5, 7), l.qtd, l.diferenca]);
  const com = (m: number, extra: object) => faturas.map((f) => (f.id === `f${m}` ? { ...f, ...extra } : f));
  assert.deepEqual(ver(faturas, compras), []);

  assert.deepEqual(ver(com(5, { total: 13000 }), compras), [["05", "05", 1, 3000]]);
  assert.deepEqual(ver(com(5, { total: 9000 }), compras), [["05", "05", 1, -1000]]);
  assert.deepEqual(ver(faturas, compras.filter((l) => l.fatura_id !== "f5")), [["05", "05", 1, 10000]]); // nenhuma compra dela veio
  // parcela que falta em faturas seguidas é um aviso (um centavo não separa); depois de uma que fecha, ou com outra diferença, é outro
  const varias = faturas.map((f) => ({ ...f, total: ({ f3: 12000, f4: 12001, f6: 12000, f7: 15000 } as Record<string, number>)[f.id] ?? 10000 }));
  assert.deepEqual(ver(varias, compras), [["03", "04", 2, 2000], ["06", "06", 1, 2000], ["07", "07", 1, 5000]]);

  // falsos positivos
  assert.deepEqual(ver(com(5, { total: 10100 }), compras), []); // arredondamento
  assert.deepEqual(ver(com(5, { total: null }), compras), []);
  assert.deepEqual(ver(com(2, { total: 99999 }), compras), []); // a primeira: tem compras de antes do histórico
  const semF2 = compras.filter((l) => l.fatura_id !== "f2").map((l) => (l.fatura_id === "f3" ? { ...l, data: "2031-02-20" } : l));
  assert.deepEqual(ver(com(3, { total: 99999 }), semF2), []); // abriu antes do 1º lançamento
  assert.deepEqual(ver(com(7, { total: 99999 }), compras, "999", "2031-07-12"), []); // não venceu: ainda pode chegar
  assert.equal(ver(com(7, { total: 99999 }), compras, "999", "2031-07-13").length, 1);
  assert.deepEqual(ver(com(3, { total: 99999 }), compras, "999", "2032-03-20"), []); // velha demais
  assert.deepEqual(ver(com(5, { total: 99999 }), compras.map((l) => ({ ...l, fatura_id: null }))), []); // banco que não liga lançamento à fatura
  assert.deepEqual(ver(faturas, [...compras, { data: "2031-05-12", valor: 10000, fatura_id: "f5", pagamento: 1 }]), []); // pagamento não é compra
  const credito = (extra: object = {}) => [...compras, { data: "2031-04-20", valor: 3001, fatura_id: "f5", pagamento: 0, ...extra }] as L;
  assert.deepEqual(ver(faturas, credito()), []); // está na soma, mas o banco o abateu da anterior
  assert.equal(ver(com(5, { total: 13500 }), credito()).length, 1); // crédito de outro valor não explica
  assert.deepEqual(ver(com(5, { total: 7000 }), credito({ fatura_id: null })), []); // está no total, mas fora da fatura
  assert.equal(ver(com(5, { total: 7000 }), credito({ fatura_id: null, data: "2031-02-20" })).length, 1); // de outro período

  // total que carrega a anterior: não paga (o total dobra) e paga em parte, só no banco que faz isso
  const anterior = (pagou: number) => [
    ...compras, { data: "2031-04-03", valor: -10000, fatura_id: "f5", pagamento: 1 }, { data: "2031-04-12", valor: pagou, fatura_id: "f5", pagamento: 1 },
  ] as L;
  assert.deepEqual(ver(com(5, { total: 20000 }), anterior(0), "104"), []);
  assert.deepEqual(ver(com(5, { total: 14000 }), anterior(6000), "104"), []);
  assert.deepEqual(ver(com(5, { total: 23000 }), anterior(0), "104"), [["05", "05", 1, 3000]]);
  for (const banco of ["999", null]) assert.equal(ver(com(5, { total: 20000 }), anterior(0), banco).length, 1);
});

test("fatura que não veio: só o pagamento sem vencimento por perto nem fatura com aquele total", () => {
  const faturas = MESES_FATURA.filter((m) => m !== 5).map((m) => faturaDe(m)); // a de maio não veio
  const ver = (data: string, extra: object = {}, fs = faturas, hoje = "2031-07-20") =>
    pagamentosSemFatura(fs, [{ data, valor: 8000, fatura_id: null, pagamento: 1, ...extra }], hoje);
  assert.deepEqual(ver("2031-05-12"), [{ data: "2031-05-12", valor: 8000 }]);
  assert.deepEqual(ver("2031-05-03", { valor: 10000 }), []); // paga com atraso
  const completa = MESES_FATURA.map((m) => faturaDe(m));
  for (const m of MESES_FATURA) for (const d of ["01", "08", "15", "23", "28"]) assert.deepEqual(ver(`2031-0${m}-${d}`, {}, completa), []); // em qualquer dia
  for (const extra of [{ pagamento: 0 }, { valor: -8000 }]) assert.deepEqual(ver("2031-05-12", extra), []); // estorno; total da anterior
  assert.deepEqual(ver("2031-05-12", {}, []), []); // cartão sem faturas
  assert.deepEqual(ver("2031-01-12"), []); // antes da primeira
  assert.deepEqual(ver("2031-08-12", {}, faturas, "2031-08-16"), []); // recente: a fatura ainda pode chegar
  assert.equal(ver("2031-08-12", {}, faturas, "2031-08-23").length, 1);
  assert.deepEqual(ver("2031-05-12", {}, faturas, "2032-05-24"), []); // velho demais
});

test("avisos de fatura: em contas e no MCP, só em cartão; removido não conta e ignorado conta", async () => {
  const cartao = novaConta("CREDIT"), PAGAMENTO = 20;
  const fatura = (id: string, d: number, total: number, bruto: object = {}) =>
    db.prepare("INSERT INTO faturas (id, conta_id, vencimento, total_centavos, bruto) VALUES (?,?,?,?,?)").run(id, cartao, dia(d), total, JSON.stringify(bruto));
  fatura("a1", -110, 5000, { billClosingDate: `${dia(-117)}T00:00:00.000Z` });
  fatura("a2", -20, 10000); // sem a data de fechamento
  novoLanc(cartao, dia(-120), -5000, MERCADO, { fatura_id: "a1" });
  novoLanc(cartao, dia(-40), -4000, MERCADO, { fatura_id: "a2", ignorado: 1 });
  novoLanc(cartao, dia(-40), -3000, MERCADO, { fatura_id: "a2", status: "REMOVIDO" });
  novoLanc(cartao, dia(-65), 7500, PAGAMENTO, { fatura_id: "a2" }); // entre as duas: a do meio não veio
  const { contas } = (await chamar("GET", "/api/contas")).d;
  const { faturas, sem_fatura } = contas.find((c: any) => c.id === cartao).faltas;
  assert.deepEqual([faturas, sem_fatura], [[{ de: dia(-20), ate: dia(-20), qtd: 1, diferenca: 6000 }], [{ data: dia(-65), valor: 7500 }]]);
  assert.ok(contas.every((c: any) => (c.tipo === "CREDIT") === (c.faltas !== null)));
  const { cliente, usar } = await ligarMcp();
  const pelo = (await usar("contas")).contas.find((c: any) => c.id === cartao);
  assert.deepEqual([pelo.faturas_que_nao_fecham, pelo.faturas_que_nao_vieram],
    [[{ vencimento_de: dia(-20), vencimento_ate: dia(-20), faturas: 1, falta_em_cada: 60 }], [{ pagamento_em: dia(-65), valor_pago: 75 }]]);
  await cliente.close();
  db.prepare("DELETE FROM faturas WHERE conta_id = ?").run(cartao);
  db.prepare("DELETE FROM lancamentos WHERE conta_id = ?").run(cartao);
});

test("gasto que o limite já conta: desconta o visto, a fatura a pagar e as previstas; nunca negativo nem por centavos", () => {
  const faturas = MESES_FATURA.map((m) => faturaDe(m)); // a última fechou em 03/07, com R$ 100
  const pagou = (valor: number, data = "2031-07-12") => ({ data, valor, fatura_id: null, pagamento: 1 });
  const nova = { data: "2031-07-10", valor: -3000, fatura_id: null, pagamento: 0 };
  const base = [...MESES_FATURA.map((m) => compraDe(m)), nova];
  const ver = (limite: number, mais: object[] = [pagou(10000)], previstas = 0, fs = faturas) => naoApareceu(limite, fs, [...base, ...mais] as typeof base, previstas);
  assert.equal(ver(3000), 0); // tudo visto
  assert.equal(ver(8000), 5000);
  assert.equal(ver(8000, [pagou(10000)], 2000), 3000);
  assert.deepEqual([ver(3100), ver(3101), ver(1000)], [0, 101, 0]); // centavos; limite menor que o visto
  // fatura fechada ocupa limite até ser paga, inteira ou em parte; pagamento de antes do fechamento é da anterior
  assert.deepEqual([ver(13000, []), ver(9000, [pagou(4000)]), ver(13000, [pagou(10000, "2031-06-30")]), ver(3000, [pagou(10500)])], [0, 0, 0, 0]);
  assert.equal(ver(13000), 10000);
  assert.equal(ver(13000, [], 0, faturas.map((f) => (f.id === "f7" ? { ...f, total: null } : f))), 0); // sem o total, vale o que se viu dela
  assert.equal(ver(8000, [pagou(10000), { data: "2031-07-04", valor: -5000, fatura_id: null, pagamento: 1 }]), 5000); // "total da anterior" não é compra nem desfaz o pagamento
  // fatura que ainda não veio: os lançamentos dela contam; os de fatura velha desconhecida, não
  const compra = (data: string) => ({ data, valor: -2000, fatura_id: "outra", pagamento: 0 });
  assert.deepEqual([ver(5000, [pagou(10000), compra("2031-07-05")]), ver(5000, [pagou(10000), compra("2031-06-20")])], [0, 2000]);
  assert.equal(naoApareceu(5000, [], [nova], 0), 2000); // cartão sem faturas
});

test("gasto que o limite já conta: só com o saldo da última sincronização; aparece em contas, no mês aberto do ritmo (PF visível) e no MCP, sem somar", async () => {
  const antes = { paginas, contasFalsas };
  const cartao = (balance: number | null) => [{ id: CARTAO, type: "CREDIT", name: "Cartão", balance }];
  const ver = async () => {
    const r = (await chamar("GET", "/api/ritmo")).d;
    return {
      conta: (await chamar("GET", "/api/contas")).d.contas.find((c: any) => c.id === CARTAO).faltas.nao_apareceu as number | null,
      ritmo: r.nao_apareceu.find((c: any) => c.conta_id === CARTAO)?.valor, resto: { ...r, nao_apareceu: 0 }, mes: r.mes as string,
    };
  };
  paginas = [[tx("visto", -1, { amount: 30 })]];
  contasFalsas = cartao(0);
  await sync();
  const zerado = await ver();
  const sobra = (db.prepare("SELECT -SUM(valor_centavos) AS n FROM lancamentos WHERE conta_id = ? AND status IS NOT 'REMOVIDO' AND categoria_id IS NOT 20").get(CARTAO) as { n: number }).n;
  assert.deepEqual([zerado.conta, zerado.ritmo], [0, undefined]);
  contasFalsas = cartao((sobra + 5000) / 100);
  await sync();
  const com = await ver();
  assert.deepEqual([com.conta, com.ritmo], [5000, 5000]);
  assert.deepEqual(com.resto, zerado.resto); // nenhum número do alarme mudou
  // parcela ignorada continua no limite (ela e a prevista do mês que vem); a de outro cartão não
  for (const [conta, falta] of [[novaConta("CREDIT"), 5000], [CARTAO, 3000]] as const) {
    const purchaseDate = `${somarMes(com.mes, -2)}-05T12:00:00.000Z`;
    novoLanc(conta, `${somarMes(com.mes, -1)}-05`, -1000, MERCADO, { id: "prev", ignorado: 1, parcela: 2, total_parcelas: 4, bruto: JSON.stringify({ creditCardMetadata: { purchaseDate } }) });
    assert.equal((await ver()).conta, falta);
    db.exec("DELETE FROM lancamentos WHERE id = 'prev'");
  }
  assert.deepEqual((await chamar("GET", `/api/ritmo?mes=${somarMes(com.mes, -1)}`)).d.nao_apareceu, []); // só no mês aberto
  const { cliente, usar } = await ligarMcp();
  assert.equal((await usar("contas")).contas.find((c: any) => c.id === CARTAO).ainda_nao_apareceu_ate, 50);
  assert.deepEqual((await usar("ritmo_do_mes")).ainda_nao_apareceu_ate.map((c: any) => c.valor), [50]);
  await cliente.close();
  db.prepare("UPDATE contas SET oculta = 1 WHERE id = ?").run(CARTAO);
  assert.equal((await ver()).ritmo, undefined);
  db.prepare("UPDATE contas SET oculta = 0, pessoa = 'PJ' WHERE id = ?").run(CARTAO);
  assert.equal((await ver()).ritmo, undefined);
  db.prepare("UPDATE contas SET pessoa = 'PF' WHERE id = ?").run(CARTAO);
  contasFalsas = cartao(null); // o banco não mandou o saldo: fica o último, que não serve para comparar
  await sync();
  assert.deepEqual([(await ver()).conta, (await ver()).ritmo], [null, undefined]);
  contasFalsas = cartao((sobra + 5000) / 100);
  await sync();
  assert.equal((await ver()).conta, 5000);
  falhas = { "/accounts": 500 }; // sincronização que falhou antes das contas: o saldo é da anterior
  await sincronizar(ITEM);
  falhas = {};
  assert.equal((await ver()).conta, null);
  ({ paginas, contasFalsas } = antes);
  db.exec("DELETE FROM lancamentos WHERE id = 'visto'");
  await sync();
});

test("dinheiro digitado no jeito brasileiro vira centavos", () => {
  for (const [texto, centavos] of [
    ["1.234,56", 123456], ["R$ 1.234,56", 123456], ["1234", 123400], ["1.234", 123400], ["12,5", 1250], ["12.50", 1250],
    ["0,1", 10], ["", 0], ["-50", -5000], ["abc", null], ["1,2,3", null],
  ] as const)
    assert.equal(lerDinheiro(texto), centavos, texto);
});
