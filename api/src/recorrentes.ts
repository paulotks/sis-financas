/** Detecção de cobranças mensais. Funções puras: recebem os gastos (do mais antigo ao mais novo) e as decisões do usuário. */

export interface Gasto {
  data: string; // AAAA-MM-DD
  descricao: string | null;
  descricao_original: string | null;
  valor: number; // centavos, positivo
  categoria: string | null;
  cor: string | null;
  conta: string | null;
  status: string | null; // PENDING ainda pode voltar com outra descrição
}

export type Status = "confirmada" | "ignorada" | "cancelada";

/** A cobrança é reconhecida por um valor que ela já teve: ele muda com o tempo, o histórico não. */
export interface Decisao {
  chave: string;
  valor: number; // 0 = todas as cobranças com essa descrição
  status: Status | "sugerida";
  proposta: Status | "sugerida" | null; // feita pelo MCP; não vale nada até ser aceita na tela
  decidido_em: string; // AAAA-MM-DD HH:MM:SS local
}

export interface Recorrente {
  chave: string; // com `valor_chave`, diz qual é a cobrança na hora de decidir
  valor_chave: number;
  decisao: { chave: string; valor: number } | null; // a que vale só para esta cobrança
  descricao: string;
  antes: string | null; // nome anterior, se o lojista trocou
  categoria: string | null;
  cor: string | null;
  conta: string | null;
  valor: number; // o da última cobrança
  vezes: number;
  ultima: string;
  proxima: string;
  situacao: "prevista" | "atrasada" | "parada";
  status: Status | null;
  proposta: Status | "sugerida" | null;
  cobrou_depois: { data: string; valor: number } | null; // cancelada que voltou a cobrar
}

const TOLERANCIA_VALOR = 0.6; // conta de luz oscila, plano muda de preço; quem segura o falso positivo é MINIMO_MENSAL
const TOLERANCIA_AVISO = 0.25; // acusar cobrança depois de cancelada exige valor mais parecido
const MINIMO_VEZES = 3;
const MES: [number, number] = [24, 37]; // vencimento em fim de semana, pagamento com alguns dias de atraso
const MES_PULADO: [number, number] = [54, 68];
const MINIMO_REGULAR = 0.5; // parte dos intervalos que precisa ser de um mês (o resto é mês pulado)
const MINIMO_MENSAL = 2 / 3; // parte das cobranças daquele nome que precisa estar em séries mensais
const MINIMO_LETRAS = 6; // nome menor que isso está contido em qualquer coisa
const DIAS_PARADA = 45;

const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const entre = (n: number, [min, max]: [number, number]) => n >= min && n <= max;
const diferenca = (de: number, para: number) => Math.abs(para - de) / de;

/** "NETFLIX.COM 123 São Paulo" -> "netflix com sao paulo": sem acento, número nem símbolo, para o mesmo lugar dar a mesma chave. */
export const chaveDe = (descricao: string) =>
  descricao.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim();

/**
 * Quem recebeu, sem a forma de pagamento: o banco escreve "Pagamento de conta X S.A." num mês e "Pagamento com Pix X SA" no outro.
 * A decisão continua guardada pela chave inteira.
 */
const nomeDe = (chave: string) =>
  chave
    .replace(/^(pagamento (com (qr )?pix|de conta)|(transferencia )?pix envi\w+|transferencia enviada|pagamento)( |$)/, "")
    .replace(/( s a| sa| ltda)+$/, "")
    .replace(/ /g, "") || chave.replace(/ /g, "");

const mesmoNome = (a: string, b: string) => {
  const [menor, maior] = a.length < b.length ? [a, b] : [b, a];
  return a === b || (menor.length >= MINIMO_LETRAS && maior.includes(menor));
};

/** Mesmo dia do mês seguinte; 31 vira o último dia. */
export function mesSeguinte(data: string) {
  const [a, m, d] = data.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
}

type Cobranca = Gasto & { chave: string; nome: string };
type Serie = Cobranca[];

/** A série que a cobrança continua: a de valor mais próximo entre as que combinam no dia e no valor. */
function aMaisProxima(series: Serie[], c: Cobranca, intervalos: [number, number][]) {
  let melhor: Serie | undefined, menor = TOLERANCIA_VALOR;
  for (const s of series) {
    const u = s.at(-1)!, n = dias(u.data, c.data), d = diferenca(u.valor, c.valor);
    if (d <= menor && intervalos.some((i) => entre(n, i))) [melhor, menor] = [s, d];
  }
  return melhor;
}

function montarSeries(cobrancas: Cobranca[]): Serie[] {
  // primeiro só o mês seguinte com o mesmo nome, para uma compra de nome parecido não roubar o lugar da cobrança de verdade
  const inicio: Serie[] = [];
  for (const nome of new Set(cobrancas.map((c) => c.nome))) {
    const doNome = cobrancas.filter((c) => c.nome === nome);
    const series: Serie[] = [];
    for (const c of doNome) {
      // nem uma compra no mesmo lugar, dias antes, se a cobrança de valor mais próximo ainda vem
      const livres = series.filter((s) => {
        const u = s.at(-1)!;
        return !doNome.some((x) => x.data > c.data && entre(dias(u.data, x.data), MES) && diferenca(u.valor, x.valor) < diferenca(u.valor, c.valor));
      });
      const s = aMaisProxima(livres, c, [MES]);
      if (s) s.push(c);
      else series.push([c]);
    }
    inicio.push(...series);
  }
  // depois emenda as que pararam: pulou um mês, ou o lojista trocou de nome (um contém o outro, na mesma conta)
  const juntas: Serie[] = [];
  for (const s of inicio.sort((a, b) => (a[0].data < b[0].data ? -1 : 1))) {
    const c = s[0];
    const combinam = juntas.filter((a) => a.at(-1)!.nome === c.nome || (a.at(-1)!.conta === c.conta && mesmoNome(a.at(-1)!.nome, c.nome)));
    const anterior = aMaisProxima(combinam, c, [MES]) ?? aMaisProxima(combinam, c, [MES_PULADO]);
    if (anterior) anterior.push(...s);
    else juntas.push(s);
  }
  return juntas;
}

function regular(s: Serie) {
  const meses = s.slice(1).filter((c, i) => entre(dias(s[i].data, c.data), MES)).length;
  return s.length >= MINIMO_VEZES && meses / (s.length - 1) >= MINIMO_REGULAR;
}

/** A decisão desta cobrança: a feita para ela vence a feita para o nome todo; entre iguais, a mais recente. */
const decisaoDe = (s: Serie, decisoes: Decisao[]) =>
  decisoes
    .filter((d) => s.some((c) => (d.valor === 0 ? c.nome === nomeDe(d.chave) : c.chave === d.chave && c.valor === d.valor)))
    .sort((a, b) => Number(b.valor > 0) - Number(a.valor > 0) || (a.decidido_em < b.decidido_em ? 1 : -1))[0];

export function detectarRecorrentes(gastos: Gasto[], hoje: string, decisoes: Decisao[] = []): Recorrente[] {
  const cobrancas = gastos
    .filter((g) => !/\d{1,2}\/\d{1,2}\s*$/.test(g.descricao_original ?? "")) // parcela escrita no texto (nem todo banco manda o metadado)
    .map((g) => ({ ...g, chave: chaveDe(g.descricao_original ?? "") }))
    .filter((g) => g.chave)
    .map((g) => ({ ...g, nome: nomeDe(g.chave) }));

  const regulares = montarSeries(cobrancas).filter(regular);
  const mensais = new Set(regulares.flat());
  /** Compra repetida no mesmo lugar às vezes forma uma série por acaso: aí a maior parte das compras fica fora de série. */
  const predominaMensal = (s: Serie) => {
    const nomes = new Set(s.map((c) => c.nome));
    const todas = cobrancas.filter((c) => nomes.has(c.nome) && c.data >= s[0].data);
    return todas.filter((c) => mensais.has(c)).length / todas.length >= MINIMO_MENSAL;
  };

  const achadas = regulares
    .map((serie) => {
      const decisao = decisaoDe(serie, decisoes), u = serie.at(-1)!, proxima = mesSeguinte(u.data);
      const status = decisao && decisao.status !== "sugerida" ? decisao.status : null;
      const situacao = dias(u.data, hoje) > DIAS_PARADA ? ("parada" as const) : proxima < hoje ? ("atrasada" as const) : ("prevista" as const);
      return { serie, decisao, status, situacao, proxima, u };
    })
    .filter((a) => (a.status && a.status !== "ignorada") || predominaMensal(a.serie));

  const viva = (a: (typeof achadas)[number]) => a.situacao !== "parada";
  const nomesEmComum = (a: Serie, b: Serie) => a.some((x) => b.some((y) => x.nome === y.nome));

  return achadas
    // o que já acabou só aparece se alguém decidiu sobre esta cobrança, ou sobre o nome e não sobrou outra viva com ele
    .filter((a) => viva(a) || (a.decisao?.valor ? a.decisao.status !== "sugerida" : a.status && !achadas.some((b) => viva(b) && nomesEmComum(a.serie, b.serie))))
    .map(({ serie, decisao, status, situacao, proxima, u }) => {
      const outro = serie.findLast((c) => c.nome !== u.nome);
      const firme = serie.findLast((c) => c.status !== "PENDING") ?? u; // a pendente pode mudar de nome e a decisão se perderia
      const cobrou = status !== "cancelada" ? undefined : cobrancas.findLast((c) =>
        c.data > decisao!.decidido_em.slice(0, 10) && dias(c.data, hoje) <= DIAS_PARADA &&
        (serie.includes(c) ||
          (serie.some((s) => mesmoNome(s.nome, c.nome)) && diferenca(u.valor, c.valor) <= TOLERANCIA_AVISO &&
            !achadas.some((b) => b.serie !== serie && b.status !== "cancelada" && b.serie.includes(c)))));
      return {
        chave: firme.chave,
        valor_chave: firme.valor,
        decisao: decisao?.valor ? { chave: decisao.chave, valor: decisao.valor } : null,
        descricao: u.descricao || u.descricao_original || u.chave,
        antes: outro ? outro.descricao || outro.descricao_original : null,
        categoria: u.categoria,
        cor: u.cor,
        conta: u.conta,
        valor: u.valor,
        vezes: serie.length,
        ultima: u.data,
        proxima,
        situacao,
        status,
        proposta: decisao?.proposta ?? null,
        cobrou_depois: cobrou ? { data: cobrou.data, valor: cobrou.valor } : null,
      };
    })
    .sort((a, b) => (a.proxima < b.proxima ? -1 : a.proxima > b.proxima ? 1 : b.valor - a.valor));
}
