// Guarda a última resposta de cada tela para o app abrir com o PC desligado (só leitura).
// Servidor no ar: busca na rede e guarda. Fora do ar: devolve a cópia com o cabeçalho x-copia-de (quando foi guardada).
// ponytail: o cache só cresce (um item por URL de consulta e por build); limpar por idade se um dia pesar.
const CACHE = "financas-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// PC desligado pelo túnel: a Cloudflare responde 502/530 em HTML; em casa, a conexão é recusada (fetch falha)
const foraDoAr = (r) => r.status >= 502 && !(r.headers.get("content-type") ?? "").includes("json");

const semCopia = (erro) =>
  new Response(JSON.stringify({ erro }), { status: 503, headers: { "content-type": "application/json" } });

async function guardar(chave, r) {
  const h = new Headers(r.headers);
  h.set("x-guardado-em", new Date().toISOString());
  const c = await caches.open(CACHE);
  await c.put(chave, new Response(await r.clone().blob(), { status: r.status, headers: h }));
}

async function copia(chave) {
  const r = await caches.match(chave);
  if (!r) return null;
  const h = new Headers(r.headers);
  h.set("x-copia-de", r.headers.get("x-guardado-em") ?? "");
  return new Response(r.body, { status: r.status, headers: h });
}

/** Rede primeiro; caiu, a cópia. */
async function redeOuCopia(req, chave, avisoSemCopia) {
  try {
    const r = await fetch(req);
    if (!foraDoAr(r)) {
      if (r.ok) await guardar(chave, r);
      return r;
    }
  } catch {
    // sem rede ou sem servidor: vai para a cópia
  }
  return (await copia(chave)) ?? semCopia(avisoSemCopia);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.method !== "GET") {
    // gravar precisa do PC: troca a página de erro da Cloudflare por uma mensagem que a tela mostra
    e.respondWith(
      fetch(req)
        .then((r) => (foraDoAr(r) ? semCopia("PC desligado: nada pode ser gravado agora.") : r))
        .catch(() => semCopia("PC desligado: nada pode ser gravado agora.")),
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(redeOuCopia(req, req, "PC desligado, e esta tela ainda não tinha sido aberta neste aparelho."));
    return;
  }
  if (req.mode === "navigate") {
    // toda rota é o mesmo index.html; o redirecionamento do login da Cloudflare passa direto
    e.respondWith(
      fetch(req)
        .then(async (r) => {
          if (foraDoAr(r)) return (await caches.match("/")) ?? r;
          if (r.ok && r.type === "basic") await guardar("/", r);
          return r;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }
  // arquivos do build têm hash no nome: a cópia vale para sempre
  e.respondWith(
    caches.match(req).then(
      (c) =>
        c ??
        fetch(req).then(async (r) => {
          if (r.ok) await (await caches.open(CACHE)).put(req, r.clone());
          return r;
        }),
    ),
  );
});
