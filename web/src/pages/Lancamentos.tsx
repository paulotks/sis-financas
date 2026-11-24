import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, mesAtual, nomePluggy, type Categoria, type Lancamento } from "../lib/api";
import OferecerRegra from "../components/OferecerRegra";
import SelectCategoria from "../components/SelectCategoria";
import SeletorMes from "../components/SeletorMes";

export default function Lancamentos() {
  const [params, setParams] = useSearchParams();
  const mes = params.get("mes") ?? mesAtual();
  const filtros = {
    mes: params.get("todos") ? undefined : mes,
    conta: params.get("conta") ?? undefined,
    categoria: params.get("categoria") ? Number(params.get("categoria")) : undefined,
    busca: params.get("busca") ?? undefined,
    pendentes: params.get("pendentes") === "1",
    pessoa: params.get("pessoa") ?? "PF",
  };
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };

  // o campo acompanha a URL (voltar, links) sem perder o foco
  const campoBusca = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (campoBusca.current) campoBusca.current.value = filtros.busca ?? "";
  }, [filtros.busca]);

  const [oferta, setOferta] = useState<Lancamento | null>(null); // acabou de ter a categoria corrigida: oferece a regra
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  const qc = useQueryClient();
  const chave = ["lancamentos", filtros];
  const lista = useQuery({ queryKey: chave, queryFn: () => api.lancamentos(filtros) });
  const categorias = useQuery({ queryKey: ["categorias"], queryFn: api.categorias });
  const contas = useQuery({ queryKey: ["contas"], queryFn: api.contas });

  const editar = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Parameters<typeof api.editarLancamento>[1] }) => api.editarLancamento(id, d),
    onSuccess: (lancamento, { d }) => {
      qc.setQueryData<{ itens: Lancamento[]; total: number }>(chave, (old) =>
        old ? { ...old, itens: old.itens.map((l) => (l.id === lancamento.id ? lancamento : l)) } : old,
      );
      if (d.categoria_id !== undefined) setOferta(d.categoria_id && lancamento.descricao_original ? lancamento : null);
      // outros filtros em cache ficam velhos; a lista aberta não recarrega (para a linha não pular da tela)
      qc.invalidateQueries({ queryKey: ["lancamentos"], refetchType: "none" });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "lancamentos" });
    },
    onError: (e) => setAviso(`Erro ao salvar: ${e.message}`),
  });

  const itens = lista.data?.itens ?? [];
  const totais = useMemo(() => {
    const vis = itens.filter((l) => !l.ignorado && l.status !== "REMOVIDO");
    return {
      entradas: vis.filter((l) => l.valor_centavos > 0).reduce((s, l) => s + l.valor_centavos, 0),
      saidas: vis.filter((l) => l.valor_centavos < 0).reduce((s, l) => s - l.valor_centavos, 0),
    };
  }, [itens]);

  return (
    <section>
      <header className="topo">
        <h1>Lançamentos</h1>
        {!params.get("todos") && <SeletorMes mes={mes} onChange={(m) => set("mes", m)} />}
      </header>

      <div className="filtros">
        <input
          ref={campoBusca}
          className="campo"
          placeholder="Buscar descrição ou nota…"
          defaultValue={filtros.busca}
          onKeyDown={(e) => e.key === "Enter" && set("busca", (e.target as HTMLInputElement).value)}
          onBlur={(e) => set("busca", e.target.value)}
        />
        <select className="campo" value={filtros.conta ?? ""} onChange={(e) => set("conta", e.target.value)}>
          <option value="">Todas as contas</option>
          {contas.data?.contas
            .filter((c) => c.pessoa === filtros.pessoa)
            .map((c) => (
              <option key={c.id} value={c.id}>{c.apelido ?? c.nome}</option>
            ))}
        </select>
        <SelectCategoria
          categorias={categorias.data ?? []}
          valor={filtros.categoria ?? null}
          vazio="Todas as categorias"
          onChange={(id) => set("categoria", id === null ? null : String(id))}
        />
        <div className="segmentado">
          {(["PF", "PJ"] as const).map((p) => (
            <button key={p} className={filtros.pessoa === p ? "ativo" : ""} onClick={() => set("pessoa", p === "PF" ? null : p)}>{p}</button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={filtros.pendentes} onChange={(e) => set("pendentes", e.target.checked ? "1" : null)} />
          Só sem categoria
        </label>
        <label className="check">
          <input type="checkbox" checked={!!params.get("todos")} onChange={(e) => set("todos", e.target.checked ? "1" : null)} />
          Todos os meses
        </label>
      </div>

      {aviso && <div className="aviso">{aviso}</div>}
      {lista.error && <div className="aviso erro">{lista.error.message}</div>}

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Data</th>
              <th>Descrição</th>
              <th style={{ width: 170 }}>Conta</th>
              <th style={{ width: 210 }}>Categoria</th>
              <th style={{ width: 130 }} className="num">Valor</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && (
              <tr><td colSpan={6} className="vazio">Carregando…</td></tr>
            )}
            {lista.data && itens.length === 0 && (
              <tr><td colSpan={6} className="vazio">Nenhum lançamento com esses filtros.</td></tr>
            )}
            {itens.map((l) => (
              <Fragment key={l.id}>
                <Linha l={l} categorias={categorias.data ?? []} onSalvar={(d) => editar.mutate({ id: l.id, d })} />
                {oferta?.id === l.id && (
                  <tr>
                    <td colSpan={6}>
                      <OferecerRegra
                        key={oferta.categoria_id}
                        l={oferta}
                        onFechar={(texto) => {
                          setOferta(null);
                          if (texto) setAviso(texto);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                {itens.length} lançamento(s)
                {lista.data && lista.data.total > itens.length && ` de ${lista.data.total}: lista e totais cortados, use os filtros`}
              </td>
              <td className="num" colSpan={2}>
                <span className="pos">{dinheiro(totais.entradas)}</span> · <span className="neg">{dinheiro(-totais.saidas)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Linha({ l, categorias, onSalvar }: {
  l: Lancamento;
  categorias: Categoria[];
  onSalvar: (d: { descricao?: string; categoria_id?: number | null; ignorado?: boolean }) => void;
}) {
  const [desc, setDesc] = useState(l.descricao);
  useEffect(() => setDesc(l.descricao), [l.descricao]);
  const salvarDesc = () => {
    const v = desc.trim();
    if (v && v !== l.descricao) onSalvar({ descricao: v });
    else setDesc(l.descricao);
  };

  return (
    <tr className={l.ignorado || l.status === "REMOVIDO" ? "ignorado" : l.categoria_id === null ? "pendente" : ""}>
      <td className="mudo">{dataCurta(l.data)}</td>
      <td>
        <input
          className="editavel"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={salvarDesc}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setDesc(l.descricao);
          }}
        />
        <div className="sub">
          {l.descricao_original !== l.descricao && <span title="Descrição original do banco">{l.descricao_original}</span>}
          {l.total_parcelas && l.total_parcelas > 1 && <span className="selo">{l.parcela}/{l.total_parcelas}</span>}
          {l.status === "PENDING" && <span className="selo">pendente no banco</span>}
          {l.status === "REMOVIDO" && <span className="selo" title="O banco não devolve mais este lançamento; não entra no resumo">removido pelo banco</span>}
        </div>
      </td>
      <td className="mudo">{l.conta}</td>
      <td>
        <SelectCategoria
          categorias={categorias}
          valor={l.categoria_id}
          vazio={l.categoria_pluggy ? `? ${nomePluggy(l.categoria_pluggy)}` : "Sem categoria"}
          cor={l.categoria_cor}
          onChange={(id) => onSalvar({ categoria_id: id })}
        />
      </td>
      <td className={`num ${l.valor_centavos < 0 ? "neg" : "pos"}`}>{dinheiro(l.valor_centavos)}</td>
      <td>
        <button
          className="icone-botao"
          title={l.ignorado ? "Voltar a considerar" : "Ignorar (não entra no resumo)"}
          onClick={() => onSalvar({ ignorado: !l.ignorado })}
        >
          {l.ignorado ? "↺" : "⊘"}
        </button>
      </td>
    </tr>
  );
}
