import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, quando } from "../lib/api";
import { abrirPluggyConnect } from "../lib/pluggyConnect";

export default function Conexoes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["conexoes"], queryFn: api.conexoes });
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  /** Abre o widget (novo banco ou reconexão), grava o item e já sincroniza. */
  const conectar = useMutation({
    mutationFn: async (itemId?: string) => {
      const { accessToken } = await api.connectToken(itemId);
      const novoId = await abrirPluggyConnect(accessToken, itemId);
      if (!novoId) return null;
      return api.salvarConexao(novoId);
    },
    onSuccess: (r) => {
      if (!r) return;
      setMsg(r.erro
        ? { tipo: "erro", texto: `Conectado, mas a sincronização falhou: ${r.erro}` }
        : { tipo: "ok", texto: `${r.conector ?? "Banco"} conectado: ${r.contas} conta(s), ${r.novos} lançamento(s) novos.` });
      qc.invalidateQueries();
    },
    onError: (e) => setMsg({ tipo: "erro", texto: e.message }),
  });

  const sync = useMutation({
    mutationFn: (itemId: string) => api.sincronizar(itemId),
    onSuccess: ({ resultados: [r] }) => {
      setMsg(r.erro ? { tipo: "erro", texto: r.erro } : { tipo: "ok", texto: `${r.conector}: ${r.novos} novos, ${r.atualizados} atualizados.` });
      qc.invalidateQueries();
    },
    onError: (e) => setMsg({ tipo: "erro", texto: e.message }),
  });

  return (
    <section>
      <header className="topo">
        <h1>Conexões</h1>
        <button className="botao" disabled={conectar.isPending} onClick={() => conectar.mutate(undefined)}>
          {conectar.isPending ? "Aguardando o banco…" : "+ Conectar banco"}
        </button>
      </header>
      <p className="mudo">
        Cada banco autorizado pelo Open Finance (via Meu Pluggy) vira uma conexão. As credenciais da Pluggy ficam só na API local; o
        navegador recebe apenas um token temporário.
      </p>

      {msg && <div className={`aviso ${msg.tipo === "erro" ? "erro" : ""}`}>{msg.texto}</div>}

      <table className="tabela">
        <thead>
          <tr>
            <th>Conector</th>
            <th>Contas</th>
            <th>Status</th>
            <th>Última sincronização</th>
            <th style={{ width: 220 }} />
          </tr>
        </thead>
        <tbody>
          {q.data?.length === 0 && (
            <tr><td colSpan={5} className="vazio">Nenhum banco conectado. Clique em “Conectar banco”.</td></tr>
          )}
          {q.data?.map((c) => (
            <tr key={c.item_id}>
              <td>
                <div className="com-logo">
                  {c.imagem_url && <img src={c.imagem_url} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
                  <div>
                    {c.conector ?? "—"}
                    <div className="sub"><code>{c.item_id}</code></div>
                  </div>
                </div>
              </td>
              <td>{c.contas}</td>
              <td>
                {c.erro ? <span className="neg" title={c.erro}>erro</span> : <span className="selo">{c.status ?? "—"}</span>}
              </td>
              <td className="mudo">{quando(c.ultimo_sync)}</td>
              <td className="acoes-linha">
                <button className="botao secundario" disabled={sync.isPending} onClick={() => sync.mutate(c.item_id)}>Sincronizar</button>
                <button className="botao secundario" disabled={conectar.isPending} onClick={() => conectar.mutate(c.item_id)} title="Reautorizar quando o consentimento vencer">
                  Reconectar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
