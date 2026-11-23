import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, GRUPOS, mesAtual, type Categoria, type Lancamento } from "../lib/api";
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

  const [aplicarIguais, setAplicarIguais] = useState(true);
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
    onSuccess: ({ lancamento, afetados }) => {
      qc.setQueryData<{ itens: Lancamento[]; total: number }>(chave, (old) =>
        old ? { ...old, itens: old.itens.map((l) => (l.id === lancamento.id ? lancamento : l)) } : old,
      );
      if (afetados > 0) {
        setAviso(`Regra criada: mais ${afetados} lançamento(s) iguais foram categorizados.`);
        qc.invalidateQueries({ queryKey: ["lancamentos"] });
      }
      qc.invalidateQueries({ queryKey: ["resumo"] });
      qc.invalidateQueries({ queryKey: ["regras"] });
    },
    onError: (e) => setAviso(`Erro ao salvar: ${e.message}`),
  });

  const itens = lista.data?.itens ?? [];
  const totais = useMemo(() => {
    const vis = itens.filter((l) => !l.ignorado);
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
        <label className="check" title="Ao mudar a categoria, cria uma regra e aplica aos lançamentos com a mesma descrição original">
          <input type="checkbox" checked={aplicarIguais} onChange={(e) => setAplicarIguais(e.target.checked)} />
          Aplicar a iguais
        </label>
      </div>

      {aviso && <div className="aviso">{aviso}</div>}

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
            {!lista.isLoading && itens.length === 0 && (
              <tr><td colSpan={6} className="vazio">Nenhum lançamento com esses filtros.</td></tr>
            )}
            {itens.map((l) => (
              <Linha
                key={l.id}
                l={l}
                categorias={categorias.data ?? []}
                onSalvar={(d) => editar.mutate({ id: l.id, d: { ...d, aplicar_iguais: d.categoria_id ? aplicarIguais : undefined } })}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>{itens.length} lançamento(s)</td>
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
    <tr className={l.ignorado ? "ignorado" : l.categoria_id === null ? "pendente" : ""}>
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
        </div>
      </td>
      <td className="mudo">{l.conta}</td>
      <td>
        <SelectCategoria
          categorias={categorias}
          valor={l.categoria_id}
          vazio={l.categoria_pluggy ? `? ${l.categoria_pluggy}` : "Sem categoria"}
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

function SelectCategoria({ categorias, valor, vazio, cor, onChange }: {
  categorias: Categoria[];
  valor: number | null;
  vazio: string;
  cor?: string | null;
  onChange: (id: number | null) => void;
}) {
  const grupos = Object.keys(GRUPOS) as Categoria["grupo"][];
  return (
    <select
      className="campo categoria"
      style={cor ? { borderLeftColor: cor } : undefined}
      value={valor ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{vazio}</option>
      {grupos.map((g) => (
        <optgroup key={g} label={GRUPOS[g]}>
          {categorias.filter((c) => c.grupo === g).map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
