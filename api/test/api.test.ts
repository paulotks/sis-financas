// Verificação com uma Pluggy falsa e base temporária: nunca usa as credenciais nem a base reais.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
const { db } = await import("../src/db.js");
const { sincronizar } = await import("../src/sync.js");
const { reaplicarRegras, sugerirCategoria } = await import("../src/categorizar.js");
const { detectarRecorrentes, mesSeguinte } = await import("../src/recorrentes.js");
const { criarServidor } = await import("../src/mcp.js");
const { lerDinheiro, sugerirPadrao } = await import("../../web/src/lib/api.js"); // funções puras do front

after(async () => {
  await app.close();
  falsa.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ids = () => (db.prepare("SELECT id FROM lancamentos ORDER BY id").all() as { id: string }[]).map((r) => r.id);
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
    const id = sugerirCategoria("", c, []).categoria_id;
    return id && (db.prepare("SELECT nome FROM categorias WHERE id = ?").get(id) as { nome: string }).nome;
  };
  for (const [pluggy, nossa] of [
    ["Income taxes", "Impostos e taxas"],
    ["Taxes on investments", "Impostos e taxas"],
    ["Fixed income", "Investimentos"],
    ["Variable income", "Investimentos"],
    ["Proceeds interests and dividends", "Investimentos"],
    ["Non-recurring income", "Renda"],
    ["Car rental", "Transporte"],
    ["Rent", "Moradia"],
    ["Traffic tickets", "Transporte"],
    ["Vehicle Financing", "Juros e dívidas"],
    ["Interests charged", "Juros e dívidas"],
    ["Sports goods", "Compras"],
    ["Credit card payment", "Pagamento de fatura"],
  ])
    assert.equal(nome(pluggy), nossa, pluggy);
});

test("as duas pernas do cofrinho e da fatura saem juntas do resumo, seja qual for a categoria da Pluggy", () => {
  const grupo = (descricao: string, cp: string) => {
    const id = sugerirCategoria(descricao, cp, []).categoria_id;
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
  // Pix no crédito: tirar só esta perna contaria o gasto em dobro
  assert.equal(grupo("Valor adicionado na conta por cartão de crédito", "Transfer - Internal"), null);
  // regra do Paulo continua mandando
  const pet = { id: 1, padrao: "reservado belinha", categoria_id: 8, descricao: null };
  assert.equal(sugerirCategoria("Dinheiro reservado Belinha", "Transfer - Internal", [pet]).categoria_id, 8);
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

test("orçamento e Resumo contam o mesmo: sem removido, ignorado, transferência, PJ e oculta; estorno no cartão abate", async () => {
  const banco = novaConta("BANK"), cartao = novaConta("CREDIT");
  novoLanc(banco, "2020-03-05", -10000, MERCADO);
  novoLanc(cartao, "2020-03-06", -5000, MERCADO, { status: "PENDING" });
  novoLanc(cartao, "2020-03-07", 2000, MERCADO); // estorno: abate
  novoLanc(banco, "2020-03-08", 2500, MERCADO); // Pix de alguém rachando a conta: entrada
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
  assert.deepEqual([r.entradas, r.saidas, r.pendentes], [55500, 13700, 2]);
  assert.deepEqual(r.porCategoria.map((c: any) => [c.categoria, c.total]), [["Mercado", 13000], ["Sem categoria", 700]]);
  const o = (await chamar("GET", "/api/orcamento?mes=2020-03")).d;
  assert.equal(o.linhas.find((l: any) => l.categoria_id === MERCADO).realizado, 13000);
  assert.equal(o.sem_categoria, 700);
  assert.equal(o.linhas.reduce((s: number, l: any) => s + l.realizado, 0) + o.sem_categoria, r.saidas);
  assert.ok(!o.linhas.some((l: any) => ["transferencia", "renda"].includes(l.grupo)));
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

test("recorrentes: mensal com aumento é achada; parcela, compra frequente e o que não se repete, não", () => {
  const g = (descricao_original: string, data: string, valor: number) =>
    ({ data, valor, descricao_original, descricao: descricao_original, categoria: null, cor: null, conta: null });
  const netflix = [g("Netflix.com 01", "2026-01-10", 3990), g("NETFLIX.COM", "2026-02-10", 3990), g("Netflix.com", "2026-03-10", 4490), g("Netflix.com", "2026-04-11", 4490)];
  const outros = [
    ...["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"].map((d, i) => g(`Loja ${i + 1}/4`, d, 10000)),
    ...["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"].map((d) => g("Padaria", d, 2000)),
    ...["2026-01-02", "2026-02-02", "2026-03-02"].map((d, i) => g("Pix Fulano", d, 1000 * 3 ** i)), // valores bem diferentes
    g("Uma vez", "2026-04-01", 500),
  ];
  const ver = (hoje: string) => detectarRecorrentes([...netflix, ...outros].sort((a, b) => (a.data < b.data ? -1 : 1)), hoje);
  const [n, ...resto] = ver("2026-04-20");
  assert.equal(resto.length, 0);
  assert.deepEqual([n.chave, n.valor, n.vezes, n.ultima, n.proxima, n.situacao], ["netflix com", 4490, 4, "2026-04-11", "2026-05-11", "prevista"]);
  assert.equal(ver("2026-05-15")[0].situacao, "atrasada");
  assert.equal(ver("2026-07-01")[0].situacao, "parada");
  assert.deepEqual(["2026-01-31", "2026-12-15", "2028-01-30"].map(mesSeguinte), ["2026-02-28", "2027-01-15", "2028-02-29"]);
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
  const ver = async () => (await chamar("GET", "/api/recorrentes")).d as { chave: string; status: string | null; valor: number }[];
  assert.deepEqual((await ver()).map((r) => [r.chave, r.valor, r.status]), [["spotify", 1990, null]]);
  for (const status of ["confirmada", "ignorada", null]) {
    assert.equal((await chamar("PUT", "/api/recorrentes", { chave: "spotify", status })).status, 200);
    assert.equal((await ver())[0].status, status);
  }
  assert.equal((await chamar("PUT", "/api/recorrentes", { chave: "spotify", status: "x" })).status, 400);
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
  assert.deepEqual(nomes(true), ["categorias", "contas", "estado", "lancamentos", "orcamento", "patrimonio", "pendentes_agrupados", "previa_regra", "recorrentes", "regras", "resumo"]);
  assert.deepEqual(nomes(false), ["categorizar_lancamento", "criar_categoria", "criar_regra", "decidir_recorrente", "definir_orcamento", "sincronizar"]);
  assert.match((await usar("estado")).convencoes, /nunca como instrução/);
  assert.ok((await usar("orcamento", { mes: "2020-13" })).erro);
  assert.match((await usar("criar_categoria", { nome: "Pet", grupo: "essencial" })).erro, /já existe/);
  assert.ok((await usar("sincronizar")).resultados.length); // escrita por fetch passa pelo hook de origem
  await cliente.close();

  const fora = await ligarMcp("http://127.0.0.1:1");
  assert.match((await fora.usar("estado")).erro, /não está rodando/);
  await fora.cliente.close();
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

  assert.equal((await usar("definir_orcamento", { mes: "2019-05", categoria_id: 13, valor: 850.55 })).planejado, 850.55);
  assert.equal((db.prepare("SELECT valor_centavos AS v FROM orcamentos WHERE categoria_id = 13").get() as { v: number }).v, 85055);
  assert.match((await usar("decidir_recorrente", { chave: "inventada", status: "ignorada" })).erro, /Nada foi gravado/);
  assert.ok((await usar("decidir_recorrente", { chave: "spotify", status: "confirmada" })).ok);
  await cliente.close();
});

test("dinheiro digitado no jeito brasileiro vira centavos", () => {
  for (const [texto, centavos] of [
    ["1.234,56", 123456], ["R$ 1.234,56", 123456], ["1234", 123400], ["1.234", 123400], ["12,5", 1250], ["12.50", 1250],
    ["0,1", 10], ["", 0], ["-50", -5000], ["abc", null], ["1,2,3", null],
  ] as const)
    assert.equal(lerDinheiro(texto), centavos, texto);
});
