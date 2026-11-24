import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";
import { dinheiro } from "../lib/api";

/** Cores por assunto, iguais em todos os gráficos. Azul e laranja validados juntos (daltonismo e contraste) sobre o painel escuro. */
export const COR = { renda: "#3987e5", gasto: "#d95926", apoio: "#8b8b96", tinta: "#ececf1", grade: "#24242b" };

/** "12 mil" no eixo (valores em centavos). */
const curto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
export const eixo = { stroke: COR.apoio, tickLine: false, axisLine: false, fontSize: 12 } as const;
export const eixoDinheiro = { ...eixo, width: 52, tickFormatter: (v: number) => curto.format(v / 100) };

type Chave = { nome: string; cor: string; forma?: "linha" | "tracejada" };

/** Moldura de um gráfico: título, a frase que ele prova, legenda e a mesma informação em tabela. */
export function Grafico({ titulo, frase, chaves = [], tabela, children }: {
  titulo: string;
  frase?: ReactNode;
  chaves?: Chave[]; // legenda; com uma série só, o título já diz o que é
  tabela?: { colunas: string[]; linhas: ReactNode[][] };
  children: ReactNode;
}) {
  return (
    <figure className="painel grafico-painel">
      <h2>{titulo}</h2>
      {frase && <p className="frase">{frase}</p>}
      {chaves.length > 1 && (
        <ul className="legenda">
          {chaves.map((c) => (
            <li key={c.nome}><span className={c.forma ?? "bloco"} style={{ color: c.cor }} />{c.nome}</li>
          ))}
        </ul>
      )}
      {children}
      {tabela && (
        <details className="pequeno">
          <summary className="mudo">Ver em tabela</summary>
          <table className="tabela compacta">
            <thead><tr>{tabela.colunas.map((c, i) => <th key={c} className={i ? "num" : ""}>{c}</th>)}</tr></thead>
            <tbody>{tabela.linhas.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j} className={j ? "num" : ""}>{v}</td>)}</tr>)}</tbody>
          </table>
        </details>
      )}
    </figure>
  );
}

/** Caixinha ao passar o mouse (ou com as setas do teclado). `extra` acrescenta uma linha calculada do ponto. */
export function Dica({ p, titulo, extra }: { p: TooltipContentProps; titulo: (rotulo: string) => string; extra?: (ponto: any) => ReactNode }) {
  if (!p.active || !p.payload?.length) return null;
  return (
    <div className="dica-grafico">
      <span className="mudo">{titulo(String(p.label ?? ""))}</span>
      {p.payload.filter((s) => s.value != null).map((s) => (
        <span key={String(s.dataKey)}><i style={{ background: s.color }} /><b>{dinheiro(Number(s.value))}</b> {s.name}</span>
      ))}
      {extra?.(p.payload[0]?.payload)}
    </div>
  );
}
