import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, dataCurta, dinheiro, mesCurto, porTipo, type Conta, type Faltas } from "../lib/api";
import Patrimonio from "../components/Patrimonio";

export default function Contas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contas"], queryFn: api.contas });
  const editar = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Parameters<typeof api.editarConta>[1] }) => api.editarConta(id, d),
    onSuccess: () => qc.invalidateQueries(),
  });
  const [mostrarOcultas, setMostrarOcultas] = useState(false);
  const contas = (q.data?.contas ?? []).filter((c) => mostrarOcultas || !c.oculta);
  // reserva zerada fica na base (a evolução precisa), mas não na tela; a de conta respondida com "não", também não
  const usaReservas = new Map(q.data?.contas.map((c) => [c.id, c.usa_reservas]));
  const investimentos = (q.data?.investimentos ?? []).filter(
    (i) => (mostrarOcultas || !i.oculta) && !(i.tipo === "RESERVA" && (!i.saldo_centavos || usaReservas.get(i.conta_id!) === 0)),
  );
  const reservado = (c: Conta) => (q.data?.investimentos ?? []).reduce((s, i) => s + (i.conta_id === c.id ? i.saldo_centavos ?? 0 : 0), 0);
  const perguntar = contas.filter((c) => !c.oculta && c.usa_reservas === null && reservado(c));

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

      {(q.error ?? editar.error) && <div className="aviso erro">{(q.error ?? editar.error)!.message}</div>}

      {perguntar.length > 0 && (
        <div className="aviso">
          O banco informou dinheiro guardado em {perguntar.map((c) => c.apelido ?? c.nome).join(" e ")}. Responda no cartão da conta se você usa
          cofrinho ou caixinha ali: até lá, não entra no patrimônio.
        </div>
      )}

      <Patrimonio />

      {(["PF", "PJ"] as const).map((pessoa) => {
        const doGrupo = contas.filter((c) => c.pessoa === pessoa);
        if (!doGrupo.length) return null;
        return (
          <div key={pessoa}>
            <h2>{pessoa === "PF" ? "Pessoa física" : "Empresa (PJ)"}</h2>
            {porTipo(doGrupo).map(([titulo, daSecao]) => (
              <Fragment key={titulo}>
                <h3>{titulo}</h3>
                <div className="grade-contas">
                  {daSecao.map((c) => (
                    <CartaoConta key={c.id} c={c} reservado={reservado(c)} onEditar={(d) => editar.mutate({ id: c.id, d })} />
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        );
      })}

      {investimentos.length > 0 && (
        <>
          <h2>Investimentos e cofrinhos</h2>
          <table className="tabela compacta">
            <tbody>
              {investimentos.map((i) => (
                <tr key={i.id}>
                  <td>{i.nome}</td>
                  <td className="mudo">
                    {i.tipo === "RESERVA" ? `${i.conta} · cofrinho ou caixinha${usaReservas.get(i.conta_id!) === null ? " · não soma ainda" : ""}` : `${i.conector} · ${i.tipo}`}
                  </td>
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

/** Fechado: são meses passados, e o que o banco não mandou não volta. */
function FaturasComFalta({ f }: { f: Faltas }) {
  const n = f.faturas.reduce((s, l) => s + l.qtd, f.sem_fatura.length);
  if (!n) return null;
  const falta = f.sem_fatura.length > 0 || f.faturas.some((l) => l.diferenca > 0);
  const mes = (dia: string) => mesCurto(dia.slice(0, 7));
  return (
    <details className="faltas">
      <summary className="alerta">⚠ {n === 1 ? "1 fatura não bate" : `${n} faturas não batem`} com os lançamentos</summary>
      <ul>
        {f.faturas.map((l) => (
          <li key={l.de}>
            {l.qtd === 1 ? `Fatura de ${mes(l.de)}` : `Faturas de ${mes(l.de)} a ${mes(l.ate)}`}:{" "}
            {l.diferenca > 0 ? <>faltam <b>{dinheiro(l.diferenca)}</b></> : <>os lançamentos passam <b>{dinheiro(-l.diferenca)}</b> do total</>}
            {l.qtd > 1 && " em cada (costuma ser uma parcela que o banco não mandou)"}.
          </li>
        ))}
        {f.sem_fatura.map((p) => (
          <li key={p.data}>Pagamento de <b>{dinheiro(p.valor)}</b> em {dataCurta(p.data)}: a fatura e as compras dela não vieram.</li>
        ))}
      </ul>
      <p className="mudo">
        Faturas pelo mês do vencimento.{falta && " O que falta não foi mandado pelo banco: o gasto daqueles meses é maior que o mostrado."}
      </p>
    </details>
  );
}

function CartaoConta({ c, reservado, onEditar }: { c: Conta; reservado: number; onEditar: (d: Parameters<typeof api.editarConta>[1]) => void }) {
  const atual = c.apelido ?? c.nome ?? "";
  const [apelido, setApelido] = useState(atual);
  useEffect(() => setApelido(atual), [atual]);
  const salvarApelido = () => {
    const v = apelido.trim();
    if (v !== atual) onEditar({ apelido: v || null });
    if (!v) setApelido(c.nome ?? ""); // vazio volta ao nome do banco
  };
  const credito = c.tipo === "CREDIT";
  // sem o disponível não dá para saber o uso; a conta fica em centavos até o fim para 80% e 100% saírem exatos
  const usado =
    credito && c.limite_centavos && c.limite_disponivel_centavos !== null
      ? Math.floor(((c.limite_centavos - c.limite_disponivel_centavos) * 100) / c.limite_centavos)
      : null;
  const nivel = usado === null || usado < 80 ? "" : usado < 100 ? "perto" : "estourou";

  return (
    <div className={`conta ${c.oculta ? "oculta" : ""}`}>
      <div className="conta-topo">
        {c.imagem_url && <img src={c.imagem_url} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
        <input
          className="editavel titulo"
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          onBlur={salvarApelido}
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
          {usado !== null && <div className={`barra ${nivel}`}><span style={{ width: `${Math.min(100, usado)}%` }} /></div>}
          {nivel && <small className={nivel === "perto" ? "alerta" : "neg"}>⚠ {usado}% do limite usado</small>}
          <small className="mudo">
            Limite {dinheiro(c.limite_centavos)} · disponível {dinheiro(c.limite_disponivel_centavos)}
            {c.vencimento && ` · vence ${dataCurta(c.vencimento)}`}
          </small>
          {!!c.faltas?.nao_apareceu && (
            <small className="alerta">⚠ Até {dinheiro(c.faltas.nao_apareceu)} já contam no limite e ainda não apareceram nos lançamentos. Não soma no gasto.</small>
          )}
          {c.faltas && <FaturasComFalta f={c.faltas} />}
        </>
      )}
      {(reservado !== 0 || c.usa_reservas !== null) && (
        <div className="acoes">
          <small className={c.usa_reservas === null ? "alerta" : "mudo"}>
            O banco informa {dinheiro(reservado)} guardado. Usa cofrinho ou caixinha aqui?
          </small>
          <div className="segmentado pequeno" role="group" aria-label="Usa cofrinho ou caixinha nesta conta?">
            {([1, 0] as const).map((v) => (
              <button
                key={v}
                className={c.usa_reservas === v ? "ativo" : ""}
                aria-pressed={c.usa_reservas === v}
                onClick={() =>
                  c.usa_reservas !== v &&
                  (!v || confirm(`Somar ${dinheiro(reservado)} ao patrimônio? Se esse dinheiro já está em "Bens e dívidas (à mão)", zere a linha de lá hoje mesmo: senão conta em dobro.`)) &&
                  onEditar({ usa_reservas: !!v })
                }
              >
                {v ? "Sim" : "Não"}
              </button>
            ))}
          </div>
        </div>
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
