// Verificação com uma Pluggy falsa e base temporária: nunca usa as credenciais nem a base reais.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

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
const { sugerirCategoria } = await import("../src/categorizar.js");

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
    const r = http.request({ host: "127.0.0.1", port: PORTA, method: metodo, path: url, headers: { "content-type": "application/json", ...headers } }, (res) => {
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

test("API: host e origem de fora são recusados; erro de dados não vira 500", async () => {
  assert.equal((await chamar("GET", "/api/saude")).status, 200);
  assert.equal((await chamar("GET", "/api/lancamentos", undefined, { host: `evil.com:${PORTA}` })).status, 403);
  assert.equal((await chamar("POST", "/api/sync", {}, { origin: "http://evil.com" })).status, 403);
  assert.equal((await chamar("POST", "/api/categorias", { nome: "Pet", grupo: "essencial" })).status, 409);
  assert.equal((await chamar("PATCH", "/api/lancamentos/a2", { categoria_id: 9999 })).status, 400);
  assert.equal((await chamar("PATCH", `/api/contas/${ITEM2}`, { pessoa: "PJ" })).status, 404);
  assert.equal((await chamar("PATCH", "/api/categorias/9999", { nome: "x" })).status, 404);
  assert.equal((await chamar("GET", "/api/lancamentos?mes=2026-13")).status, 400);
  assert.equal((await chamar("GET", "/api/lancamentos")).d.total, ids().length);
});
