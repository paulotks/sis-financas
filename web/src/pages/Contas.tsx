import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, type Conta } from "../lib/api";

export default function Contas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contas"], queryFn: api.contas });
  const editar = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Parameters<typeof api.editarConta>[1] }) => api.editarConta(id, d),
    onSuccess: () => qc.invalidateQueries(),
  });
  const [mostrarOcultas, setMostrarOcultas] = useState(false);
  const contas = (q.data?.contas ?? []).filter((c) => mostrarOcultas || !c.oculta);

  if (q.data && q.data.contas.length === 0)
    return (
      <section>
        <h1>Contas e cartões</h1>
        <p className="mudo">Nenhuma conta ainda. <Link to="/conexoes">Conecte um banco</Link>.</p>
      </section>
    );

  return (
    <section>
      <header className="topo">
        <h1>Contas e cartões</h1>
        <label className="check">
          <input type="checkbox" checked={mostrarOcultas} onChange={(e) => setMostrarOcultas(e.target.checked)} /> Mostrar ocultas
        </label>
      </header>

      {(["PF", "PJ"] as const).map((pessoa) => {
        const doGrupo = contas.filter((c) => c.pessoa === pessoa);
        if (!doGrupo.length) return null;
        return (
          <div key={pessoa}>
            <h2>{pessoa === "PF" ? "Pessoa física" : "Empresa (PJ)"}</h2>
            <div className="grade-contas">
              {doGrupo.map((c) => (
                <CartaoConta key={c.id} c={c} onEditar={(d) => editar.mutate({ id: c.id, d })} />
              ))}
            </div>
          </div>
        );
      })}

      {!!q.data?.investimentos.length && (
        <>
          <h2>Investimentos e cofrinhos</h2>
          <table className="tabela compacta">
            <tbody>
              {q.data.investimentos.map((i) => (
                <tr key={i.id}>
                  <td>{i.nome}</td>
                  <td className="mudo">{i.conector} · {i.tipo}</td>
                  <td className="num">{dinheiro(i.saldo_centavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function CartaoConta({ c, onEditar }: { c: Conta; onEditar: (d: { apelido?: string | null; pessoa?: "PF" | "PJ"; oculta?: boolean }) => void }) {
  const [apelido, setApelido] = useState(c.apelido ?? c.nome ?? "");
  const credito = c.tipo === "CREDIT";
  const usado = credito && c.limite_centavos ? Math.min(100, ((c.limite_centavos - (c.limite_disponivel_centavos ?? 0)) / c.limite_centavos) * 100) : 0;

  return (
    <div className={`conta ${c.oculta ? "oculta" : ""}`}>
      <div className="conta-topo">
        {c.imagem_url && <img src={c.imagem_url} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
        <input
          className="editavel titulo"
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          onBlur={() => apelido.trim() !== (c.apelido ?? c.nome ?? "") && onEditar({ apelido: apelido.trim() || null })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          title="Clique para renomear"
        />
      </div>
      <small className="mudo">
        {credito ? "Cartão" : "Conta"} {c.numero ? `· ${c.numero}` : ""} {c.apelido && c.nome ? `· ${c.nome}` : ""}
      </small>
      <strong className={credito ? "neg" : ""}>{dinheiro(c.saldo_centavos)}</strong>
      {credito && (
        <>
          <div className="barra"><span style={{ width: `${usado}%` }} /></div>
          <small className="mudo">
            Limite {dinheiro(c.limite_centavos)} · disponível {dinheiro(c.limite_disponivel_centavos)}
            {c.vencimento && ` · vence ${dataCurta(c.vencimento)}`}
          </small>
        </>
      )}
      <div className="acoes">
        <Link to={`/lancamentos?conta=${c.id}${c.pessoa === "PJ" ? "&pessoa=PJ" : ""}`}>Ver lançamentos</Link>
        <div className="segmentado pequeno">
          {(["PF", "PJ"] as const).map((p) => (
            <button key={p} className={c.pessoa === p ? "ativo" : ""} onClick={() => c.pessoa !== p && onEditar({ pessoa: p })}>{p}</button>
          ))}
        </div>
        <button className="icone-botao" title={c.oculta ? "Mostrar" : "Ocultar"} onClick={() => onEditar({ oculta: !c.oculta })}>
          {c.oculta ? "◉" : "◌"}
        </button>
      </div>
    </div>
  );
}
