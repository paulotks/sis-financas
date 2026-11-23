import { useState } from "react";
import { dataCurta, dinheiro } from "../lib/api";

/** Evolução do patrimônio: uma linha, um ponto por dia com sincronização. Passe o mouse (ou use as setas) para ler um dia. */
export default function LinhaPatrimonio({ pontos }: { pontos: { data: string; total: number }[] }) {
  const [sel, setSel] = useState<number | null>(null);
  if (pontos.length < 2)
    return <p className="mudo pequeno">A evolução começa hoje: cada dia com sincronização vira um ponto.</p>;

  const ultimo = pontos.length - 1;
  const t = pontos.map((p) => Date.parse(p.data));
  const valores = pontos.map((p) => p.total);
  const min = Math.min(...valores), max = Math.max(...valores);
  const x = (i: number) => ((t[i] - t[0]) / (t[ultimo] - t[0])) * 100;
  const y = (i: number) => (max === min ? 50 : 100 - ((valores[i] - min) / (max - min)) * 100);
  const maisPerto = (pct: number) => t.reduce((m, _, i) => (Math.abs(x(i) - pct) < Math.abs(x(m) - pct) ? i : m), 0);
  const i = sel ?? ultimo;

  return (
    <figure className="evolucao">
      <div
        className="grafico"
        role="img"
        tabIndex={0}
        aria-label={`Patrimônio de ${dataCurta(pontos[0].data)} a ${dataCurta(pontos[ultimo].data)}: ${dataCurta(pontos[i].data)}, ${dinheiro(pontos[i].total)}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setSel(maisPerto(((e.clientX - r.left) / r.width) * 100));
        }}
        onPointerLeave={() => setSel(null)}
        onFocus={() => setSel((s) => s ?? ultimo)}
        onBlur={() => setSel(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSel(Math.max(0, i - 1));
          if (e.key === "ArrowRight") setSel(Math.min(ultimo, i + 1));
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={pontos.map((_, k) => `${x(k)},${y(k)}`).join(" ")} vectorEffect="non-scaling-stroke" />
        </svg>
        {sel !== null && <span className="mira" style={{ left: `${x(i)}%` }} />}
        <span className="marcador" style={{ left: `${x(i)}%`, top: `${y(i)}%` }} />
        {sel !== null && (
          <span className="dica" style={{ left: `${x(i)}%`, translate: `${-x(i)}% 0` }}>
            <strong>{dinheiro(pontos[i].total)}</strong> {dataCurta(pontos[i].data)}
          </span>
        )}
      </div>
      <figcaption className="mudo">
        <span>{dataCurta(pontos[0].data)}</span>
        <span>{dataCurta(pontos[ultimo].data)}</span>
      </figcaption>
    </figure>
  );
}
