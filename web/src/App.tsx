import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dadosVelhos, quando } from "./lib/api";
import RitmoLateral from "./components/RitmoLateral";
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

const MENU = [
  { to: "/resumo", rotulo: "Resumo", icone: "◎" },
  { to: "/lancamentos", rotulo: "Lançamentos", icone: "≡" },
  { to: "/orcamento", rotulo: "Orçamento", icone: "◔" },
  { to: "/contas-do-mes", rotulo: "Contas do mês", icone: "▤" },
  { to: "/metas", rotulo: "Metas", icone: "⚑" },
  { to: "/analises", rotulo: "Análises", icone: "▥" },
  { to: "/recorrentes", rotulo: "Recorrentes", icone: "∞" },
  { to: "/contas", rotulo: "Contas e cartões", icone: "▣" },
  { to: "/categorias", rotulo: "Categorias e regras", icone: "◇" },
  { to: "/conexoes", rotulo: "Conexões", icone: "⇄" },
];

export default function App() {
  const qc = useQueryClient();
  const conexoes = useQuery({ queryKey: ["conexoes"], queryFn: api.conexoes });
  const sync = useMutation({
    mutationFn: () => api.sincronizar(),
    onSuccess: () => qc.invalidateQueries(),
  });
  const ultimo = conexoes.data?.map((c) => c.ultimo_sync).filter(Boolean).sort().at(-1) ?? null;
  const maisAntigo = conexoes.data?.map((c) => c.atualizado_pluggy).filter(Boolean).sort()[0] ?? null;
  const erros = conexoes.data?.filter((c) => c.erro).length ?? 0;

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <span className="logo">R$</span> Finanças
        </div>
        <nav>
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} className={({ isActive }) => (isActive ? "ativo" : "")}>
              <span className="icone">{m.icone}</span>
              {m.rotulo}
            </NavLink>
          ))}
        </nav>
        <RitmoLateral />
        <div className="sync">
          <button className="botao" disabled={sync.isPending || !conexoes.data?.length} onClick={() => sync.mutate()}>
            {sync.isPending ? "Sincronizando…" : "↻ Sincronizar"}
          </button>
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
          {sync.data && (
            <small className="ok">
              +{sync.data.resultados.reduce((s, r) => s + r.novos, 0)} novos
            </small>
          )}
          {(sync.error || erros > 0) && (
            <small className="erro">{sync.error ? sync.error.message : `${erros} conexão(ões) com erro`}</small>
          )}
        </div>
      </aside>
      <main className="conteudo">
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
