# sis-financas

Sistema financeiro pessoal alimentado por **Open Finance** via [Pluggy](https://pluggy.ai) (Meu Pluggy).
Roda só no seu computador: a API escuta em `127.0.0.1` e os dados ficam num SQLite local.

- **api/**: Node + TypeScript + Fastify + SQLite nativo do Node (`node:sqlite`, sem dependência nativa para compilar)
- **web/**: React + Vite + TanStack Query + React Router

## Requisitos

- Node **22.13+** (recomendado: 24 LTS)
- Conta no Dashboard da Pluggy, com o conector **MeuPluggy** habilitado

## Primeira vez

```powershell
git clone https://github.com/paulotks/sis-financas.git D:\sis-financas
cd D:\sis-financas
npm install
copy .env.example .env    # e preencha PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET
npm run dev
```

Abra http://127.0.0.1:5173. Vá em **Conexões → Conectar banco**, escolha **MeuPluggy** e autorize os bancos, um de cada vez. Cada conexão já faz a primeira sincronização, buscando 365 dias por padrão (`SYNC_DIAS_INICIAIS`).

### Uso diário sem modo dev

```powershell
npm run build
npm start          # tudo em http://127.0.0.1:3333
```

## Segurança

- `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` ficam só no `.env`, que está no `.gitignore`. O navegador recebe apenas o Connect Token, que vale 30 minutos.
- A API escuta só em `127.0.0.1` e recusa escrita (POST/PATCH/DELETE) vinda de outra origem.
- `data/` (a base) e `.env` **nunca** vão para o GitHub.

## Como funciona

| Conceito | Detalhe |
|---|---|
| Conexão | Um *item* da Pluggy (um banco autorizado). |
| Sincronização | Item → contas → lançamentos (`GET /v2/transactions`, por cursor) → faturas (cartões) → investimentos. É incremental: volta 15 dias a partir do último lançamento de cada conta. |
| Valores | Em centavos; saída é negativa (definida pelo `type` DEBIT/CREDIT da Pluggy). |
| Categorias | Ordem de decisão: regra sua > categoria da Pluggy (mapeada) > sem categoria. Uma edição manual nunca é sobrescrita pela sincronização. |
| Regras | Criadas ao categorizar um lançamento com **Aplicar a iguais** ligado. Valem para lançamentos cuja descrição original *contém* o texto. |
| PF / PJ | Cada conta é marcada como PF ou PJ (Inter Empresas → PJ). O resumo separa as duas. |
| Resumo | Ignora transferências entre contas e pagamento de fatura, para não contar o mesmo gasto duas vezes. |

### Rotas principais

`POST /api/pluggy/connect-token` · `GET|POST /api/conexoes` · `POST /api/sync` · `GET /api/contas` · `PATCH /api/contas/:id` ·
`GET /api/lancamentos?mes=&conta=&categoria=&busca=&pendentes=1&pessoa=` · `PATCH /api/lancamentos/:id` · `GET /api/resumo?mes=&pessoa=` ·
`GET|POST /api/categorias` · `GET|POST|DELETE /api/regras`

## Próximos passos

- [ ] Orçamento mensal (planejado × realizado)
- [ ] Faturas e parcelas futuras
- [ ] Assinaturas recorrentes
- [ ] Lançamentos manuais (cartões fora do Open Finance: Bradescard, C&A, Pefisa, Midway)
- [ ] Importar regras e assinaturas do sistema antigo (`financeiro.db`)
