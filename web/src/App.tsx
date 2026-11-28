import { lazy, Suspense, useSyncExternalStore } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, copia, dadosVelhos, quando } from "./lib/api";
import RitmoLateral from "./components/RitmoLateral";
import Icone, { type NomeIcone } from "./components/Icone";
import Resumo from "./pages/Resumo";
import Lancamentos from "./pages/Lancamentos";
import Orcamento from "./pages/Orcamento";
import ContasDoMes from "./pages/ContasDoMes";
import Metas from "./pages/Metas";
import Recorrentes from "./pages/Recorrentes";
import Contas from "./pages/Contas";
import Conexoes from "./pages/Conexoes";
import Categorias from "./pages/Categorias";

const Analises = lazy(() => import("./pages/Analises")); // a biblioteca de gráficos só carrega nesta página

// fixo: fica na barra de baixo do celular; o resto vai para o "Mais"
const MENU: { to: string; rotulo: string; icone: NomeIcone; fixo?: true }[] = [
  { to: "/resumo", rotulo: "Resumo", icone: "resumo", fixo: true },
  { to: "/lancamentos", rotulo: "Lançamentos", icone: "lancamentos", fixo: true },
  { to: "/orcamento", rotulo: "Orçamento", icone: "orcamento", fixo: true },
  { to: "/contas-do-mes", rotulo: "Contas do mês", icone: "mes", fixo: true },
  { to: "/metas", rotulo: "Metas", icone: "metas" },
  { to: "/analises", rotulo: "Análises", icone: "analises" },
  { to: "/recorrentes", rotulo: "Recorrentes", icone: "recorrentes" },
  { to: "/contas", rotulo: "Contas e cartões", icone: "contas" },
  { to: "/categorias", rotulo: "Categorias e regras", icone: "categorias" },
  { to: "/conexoes", rotulo: "Conexões", icone: "conexoes" },
];

export default function App() {
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const conexoes = useQuery({ queryKey: ["conexoes"], queryFn: api.conexoes });
  const copiaDe = useSyncExternalStore(copia.ouvir, copia.ler);
  const sync = useMutation({
    mutationFn: () => api.sincronizar(),
    onSuccess: () => qc.invalidateQueries(),
  });
  const ultimo = conexoes.data?.map((c) => c.ultimo_sync).filter(Boolean).sort().at(-1) ?? null;
  const maisAntigo = conexoes.data?.map((c) => c.atualizado_pluggy).filter(Boolean).sort()[0] ?? null;
  const erros = conexoes.data?.filter((c) => c.erro).length ?? 0;
  // no computador fica embaixo do Sincronizar; no celular, dentro do "Mais"
  const situacao = (
    <>
      {/* sem resposta da API não dá para dizer "nunca" */}
      <small>Última: {conexoes.data ? quando(ultimo) : "…"}</small>
      {maisAntigo && (
        <small
          className={dadosVelhos(maisAntigo) ? "alerta" : ""}
          title={conexoes.data?.map((c) => `${c.nomes_contas ?? c.conector ?? "?"}: ${c.atualizado_pluggy ? quando(c.atualizado_pluggy) : "sem data"}`).join("\n")}
        >
          {dadosVelhos(maisAntigo) && "⚠ "}Dados do banco de {quando(maisAntigo)}
        </small>
      )}
      {sync.data && <small className="ok">+{sync.data.resultados.reduce((s, r) => s + r.novos, 0)} novos</small>}
      {(sync.error || erros > 0) && (
        <small className="erro">{sync.error ? sync.error.message : erros === 1 ? "1 conexão com erro" : `${erros} conexões com erro`}</small>
      )}
    </>
  );

  return (
    <div className="app" data-rota={pathname.split("/")[1]}>
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <aside className="lateral">
        <div className="marca">
          <span className="logo">R$</span> Finanças
        </div>
        <nav aria-label="Menu">
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} className={({ isActive }) => `${isActive ? "ativo" : ""} ${m.fixo ? "" : "extra"}`}>
              <Icone nome={m.icone} />
              {m.rotulo}
            </NavLink>
          ))}
          {/* só no celular: o que não cabe na barra de baixo */}
          <button className={`botao-mais ${MENU.some((m) => !m.fixo && pathname === m.to) ? "ativo" : ""}`} popoverTarget="menu-mais">
            <Icone nome="mais" />
            Mais
          </button>
        </nav>
        <div id="menu-mais" popover="auto" className="menu-mais">
          {MENU.filter((m) => !m.fixo).map((m) => (
            <NavLink key={m.to} to={m.to} className={({ isActive }) => (isActive ? "ativo" : "")}
              onClick={() => document.getElementById("menu-mais")?.hidePopover()}>
              <Icone nome={m.icone} />
              {m.rotulo}
            </NavLink>
          ))}
          <div className="situacao">{situacao}</div>
        </div>
        <RitmoLateral />
        <div className="sync">
          <button className="botao" disabled={sync.isPending || !conexoes.data?.length} onClick={() => sync.mutate()}
            aria-label={sync.isPending ? "Sincronizando…" : "Sincronizar"}>
            <Icone nome="sincronizar" /><span className="rotulo-sync">{sync.isPending ? " Sincronizando…" : " Sincronizar"}</span>
          </button>
          <div className="situacao" aria-live="polite">{situacao}</div>
        </div>
      </aside>
      <main className="conteudo" id="conteudo" tabIndex={-1}>
        {copiaDe !== null && (
          <div className="aviso alerta" role="status">
            PC desligado: mostrando o que este aparelho guardou em {quando(copiaDe || null)}. Nada pode ser gravado até ele ligar.
          </div>
        )}
        {conexoes.error && <div className="aviso erro">A API local não respondeu: {conexoes.error.message}</div>}
        <Routes>
          {/* espera as conexões chegarem: sem nenhuma, a primeira tela é a de conectar banco */}
          <Route path="/" element={conexoes.isPending ? null : <Navigate to={conexoes.data?.length === 0 ? "/conexoes" : "/resumo"} replace />} />
          <Route path="/resumo" element={<Resumo />} />
          <Route path="/lancamentos" element={<Lancamentos />} />
          <Route path="/orcamento" element={<Orcamento />} />
          <Route path="/contas-do-mes" element={<ContasDoMes />} />
          <Route path="/metas" element={<Metas />} />
          <Route path="/analises" element={<Suspense fallback={<p className="mudo">Carregando…</p>}><Analises /></Suspense>} />
          <Route path="/recorrentes" element={<Recorrentes />} />
          <Route path="/contas" element={<Contas />} />
          <Route path="/categorias" element={<Categorias />} />
          <Route path="/conexoes" element={<Conexoes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
