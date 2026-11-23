import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, GRUPOS, type Categoria } from "../lib/api";

export default function Categorias() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ["categorias"], queryFn: api.categorias });
  const regras = useQuery({ queryKey: ["regras"], queryFn: api.regras });
  const [nome, setNome] = useState("");
  const [grupo, setGrupo] = useState<Categoria["grupo"]>("estilo_de_vida");
  const [cor, setCor] = useState("#7c9cff");

  const criar = useMutation({
    mutationFn: () => api.criarCategoria({ nome, grupo, cor }),
    onSuccess: () => {
      setNome("");
      qc.invalidateQueries({ queryKey: ["categorias"] });
    },
  });
  const apagar = useMutation({
    mutationFn: api.apagarRegra,
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <section>
      <h1>Categorias e regras</h1>
      <div className="duas-colunas">
        <div className="painel">
          <h2>Categorias</h2>
          <form
            className="linha-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (nome.trim()) criar.mutate();
            }}
          >
            <input className="campo" placeholder="Nova categoria" value={nome} onChange={(e) => setNome(e.target.value)} />
            <select className="campo" value={grupo} onChange={(e) => setGrupo(e.target.value as Categoria["grupo"])}>
              {Object.entries(GRUPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} />
            <button className="botao" disabled={criar.isPending}>Adicionar</button>
          </form>
          {(cats.error ?? criar.error) && <div className="aviso erro">{(cats.error ?? criar.error)!.message}</div>}
          {(Object.keys(GRUPOS) as Categoria["grupo"][]).map((g) => (
            <div key={g}>
              <h3>{GRUPOS[g]}</h3>
              <div className="chips">
                {cats.data?.filter((c) => c.grupo === g).map((c) => (
                  <span key={c.id} className="chip" style={{ borderColor: c.cor ?? undefined }}>{c.nome}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="painel">
          <h2>Regras</h2>
          <p className="mudo pequeno">
            Criadas quando você categoriza um lançamento com “Aplicar a iguais” ligado. Valem para lançamentos novos cuja descrição
            original contenha o texto.
          </p>
          {(regras.error ?? apagar.error) && <div className="aviso erro">{(regras.error ?? apagar.error)!.message}</div>}
          <table className="tabela compacta">
            <tbody>
              {regras.data?.length === 0 && <tr><td className="vazio">Nenhuma regra ainda.</td></tr>}
              {regras.data?.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.padrao}</code>{r.descricao && <div className="sub">→ {r.descricao}</div>}</td>
                  <td>{r.categoria}</td>
                  <td className="mudo num">{r.usos} uso(s)</td>
                  <td>
                    <button className="icone-botao" title="Apagar regra" onClick={() => apagar.mutate(r.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
