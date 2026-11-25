# sis-financas

Sistema financeiro pessoal alimentado por **Open Finance** via [Pluggy](https://pluggy.ai) (Meu Pluggy).
Roda só no seu computador: a API escuta em `127.0.0.1` e os dados ficam num SQLite local.

- **api/**: Node + TypeScript + Fastify + SQLite nativo do Node (`node:sqlite`, sem dependência nativa para compilar)
- **web/**: React + Vite + TanStack Query + React Router

Clonar o repositório traz só o código. Cada pessoa usa a **própria** conta da Pluggy, as **próprias** credenciais e a **própria** base: ninguém vê os dados de ninguém.

## Instalar no seu PC

O caminho tem quatro passos: programas → código → conta na Pluggy → conectar os bancos.

### 1. Programas

- **Git**
- **Node 22.13+** (recomendado: 24 LTS). No Windows, prefira o [nvm-windows](https://github.com/coreybutler/nvm-windows): o instalador comum põe o Node em `C:\Program Files`, e o início automático (`app:instalar`) não aceita caminho com espaço.

  ```powershell
  winget install CoreyButler.NVMforWindows   # depois, feche e abra o terminal
  nvm install 24
  nvm use 24
  node -v                      # 22.13 ou maior
  (Get-Command node).Source    # não pode ter espaço no caminho
  ```

Já tem o Node em `C:\Program Files`? Tudo funciona, menos o início automático: use `npm start`.

### 2. Código

Use uma pasta **sem espaços** e, por causa da base, fora do OneDrive.

```powershell
git clone https://github.com/paulotks/sis-financas.git C:\sis-financas
cd C:\sis-financas
npm install
npm test                  # opcional: usa uma Pluggy falsa, não precisa de credenciais
copy .env.example .env
```

### 3. Sua conta na Pluggy (grátis para uso pessoal)

A Pluggy é quem fala com os bancos. Para uso pessoal, o caminho é o **Meu Pluggy** mais o conector **MeuPluggy**.

1. **Conecte os bancos** em [meu.pluggy.ai](https://meu.pluggy.ai). É aqui que cada banco pede CPF e aprovação no aplicativo.
2. **Entre no Dashboard** em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) com a **mesma conta** do Meu Pluggy.
3. **Confira o conector**, uma vez só: em **Customização → Conectores**, pesquise `MeuPluggy` (grupo *Pessoal*, aba **Conectores Diretos**). Em *Seleção personalizada*, ative o interruptor; no modo padrão, com todos selecionados, ele já aparece.
4. **Crie uma aplicação** em **Aplicações** e copie o **Client ID** e o **Client Secret**. O secret aparece **uma única vez**; se perder, use **Gerar novo secret** na página da aplicação.
5. **Preencha o `.env`** (`notepad .env`):

   ```ini
   PLUGGY_CLIENT_ID=seu-client-id
   PLUGGY_CLIENT_SECRET=seu-client-secret
   ```

Não mande esses dois valores para ninguém e não use os de outra pessoa.

Limites do plano gratuito: até **5 conexões** ativas, todas do **mesmo titular**, sem uso comercial. O aviso de teste de 15 dias no Dashboard não afeta o MeuPluggy. Guia oficial: [uso pessoal com Meu Pluggy](https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use).

### 4. Rodar e conectar os bancos

```powershell
npm run build
npm start
```

1. Abra http://127.0.0.1:3333 e vá em **Conexões → Conectar banco**.
2. Na janela da Pluggy, escolha **MeuPluggy** (não o seu banco) e entre com a sua conta do Meu Pluggy.
3. Autorize **um banco**. Ao terminar, o app já sincroniza os últimos 365 dias (`SYNC_DIAS_INICIAIS`).
4. Repita para cada banco: a autorização é uma por banco.
5. Em **Contas**, confira se cada conta está como PF ou PJ e dê um apelido, se quiser.

Conecte sempre por esta tela. O guia da Pluggy usa a página **Demo** do Dashboard, mas o app não enxerga o que for conectado por lá.

### Se algo der errado

| O que aparece | O que fazer |
|---|---|
| `npm.ps1 não pode ser carregado` (execução de scripts desabilitada) | Use `npm.cmd` no lugar de `npm`, ou rode no Prompt de Comando. |
| `npm warn install-scripts ... esbuild` | Pode ignorar: o build funciona assim mesmo. |
| `Credenciais Pluggy ausentes` | O `.env` não está na raiz ou está vazio. Depois de mudar o `.env`, pare (`Ctrl+C`) e rode de novo. |
| `HTTP 401 — client keys are invalid` | Client ID ou Client Secret errado. Copie de novo ou gere outro secret. |
| MeuPluggy não aparece na janela | Refaça o item 3 do passo 3. |
| A janela pede CPF e aprovação do banco | Você escolheu o conector do banco. Volte e escolha **MeuPluggy**. |
| Só veio um dos bancos | É assim mesmo: repita **Conectar banco** para cada um. |
| `EADDRINUSE` na porta 3333 | Outro programa usa a porta: ponha `PORT=3334` no `.env` e abra nessa porta. |
| `Port 5173 is already in use` no `npm run dev` | Feche o outro programa: essa porta é fixa. |
| `a base (versão …) é mais nova que este código` | O código (ou o `dist`) é mais antigo que a base: `git pull`, `npm install`, `npm run build`. |
| `sem a cópia em … a base não foi migrada` | A pasta das cópias (`COPIAS_DIR` no `.env`) não pôde ser criada ou está sem espaço. Nada foi mudado: corrija e inicie de novo. |
| `Caminho com espaco nao funciona` no `app:instalar` | Node ou projeto em pasta com espaço: ver passos 1 e 2, ou use `npm start`. |

### Manutenção

- **Atualizar o código** (com o app parado): `git pull`, `npm install`, `npm run build`. A base é atualizada quando o app inicia, depois de uma cópia automática.
- **Backup:** automático. Uma cópia por dia e uma antes de cada atualização da base, as 14 últimas de cada. Sem configurar, ficam em `data/copias`; ponha no `.env` uma pasta fora do projeto (`COPIAS_DIR=C:/Users/voce/sis-financas-copias`), de preferência em outro disco. Pasta de nuvem leva seus extratos para lá. Se a cópia do dia falhar, o aviso fica em `data/app.log`.
- **Voltar uma cópia:** pare o app, tire de `data/` os arquivos `financas.db`, `financas.db-wal` e `financas.db-shm` (guarde-os em outro lugar), copie a cópia escolhida para `data/financas.db` e inicie. Não deixe o `-wal` antigo: ele estraga a base restaurada.
- **O `.env` não entra nas cópias:** guarde o Client Secret num gerenciador de senhas. A Pluggy o mostra uma vez só.
- **Dados novos:** a Pluggy atualiza 1x por dia; não dá para forçar pelo app.
- **Uma vez por ano** a autorização do MeuPluggy vence e é preciso conectar de novo. Faça backup e leia [Problemas conhecidos](#problemas-conhecidos) antes.

## Uso diário: inicia com o Windows

Opcional, só no Windows. O app sobe sozinho no logon, sem janela, pela tarefa agendada `sis-financas`. Abra **http://meu-financeiro.localhost** (Chrome e Edge resolvem o nome sozinhos; em outro programa use `http://127.0.0.1`). Em outro sistema, use `npm start` (não testado fora do Windows).

```powershell
npm run build          # uma vez, e a cada atualização do código
npm run app:instalar   # uma vez: registra a tarefa (não precisa de administrador)
npm run app:iniciar    # sobe agora, sem esperar o próximo logon
npm run app:reiniciar  # depois de um build
npm run app:parar      # antes do npm run dev ou npm start (todos gravam na mesma base)
npm run app:remover    # desfaz
```

- O log do último início fica em `data/app.log`. Se o servidor cair, ele não volta sozinho: `npm run app:iniciar`.
- Usa a porta **80**. Se outro programa já estiver nela, o `app:iniciar` avisa; use `npm start` (porta 3333).
- A tarefa roda o que está em `api/dist` e `web/dist`, e as migrações rodam a cada início, **na base real**: só compile na pasta principal a partir do `main`.
- `npm start` continua valendo para rodar numa janela.

## Desenvolver

```powershell
npm run dev        # API :3333 + tela em http://127.0.0.1:5173, recarrega ao salvar
npm run typecheck
npm test           # Pluggy falsa e base temporária; não usa credenciais nem a base real
```

O `npm run dev` usa a mesma base de `data/`. Convenções do projeto: [`CLAUDE.md`](CLAUDE.md).

## Assistente no Claude Desktop (MCP local)

O app tem um MCP que deixa o Claude ler e organizar as finanças pela mesma API da tela. Precisa do app rodando (ele sobe com o Windows; ver "Uso diário").

1. `npm run build`.
2. Feche o Claude Desktop por completo e acrescente em `mcpServers`, no `claude_desktop_config.json`:
   ```json
   "financas": { "command": "C:/nvm4w/nodejs/node.exe", "args": ["C:/sis-financas/api/dist/mcp-stdio.js"] }
   ```
   Troque pelos seus caminhos: o do Node (`(Get-Command node).Source`) e o da pasta do projeto, com barras `/`.
   O MCP procura o app na porta 80. Se você usa `npm start`, some `"env": { "PORT": "3333" }`.
3. Abra o Claude Desktop e peça: "use o financas e chame estado".

Depois de mudar o MCP, rode o build e reinicie o Claude Desktop.

- **Lê:** estado, resumo, ritmo do mês, análises, orçamento com a renda esperada, lançamentos, compras de um estorno, pendentes agrupados, categorias, regras, prévia de regra, recorrentes, patrimônio e contas.
- **Grava:** regra (só com a prévia conferida), lançamento, categoria, orçamento, mês inicial da análise e sincronização. Em recorrentes ele só propõe: você aceita ou recusa na tela. **O Cowork pode gravar sem pedir confirmação** (aconteceu em 24/11/2026): use o modo Manual no seletor da conversa ou marque essas ferramentas como "Sempre perguntar", se elas aparecerem em Customize > Connectors. O pedido de "ok" nas convenções é só uma instrução ao modelo, não uma trava.
- **Não faz:** conectar banco, apagar, trocar PF/PJ, mexer em bens, dizer se a conta usa cofrinho.
- O que ele lê passa pela conversa do Claude, na conta em que o Desktop está logado.

## Segurança

- `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` ficam só no `.env`, que está no `.gitignore`. O navegador recebe apenas o Connect Token, que vale 30 minutos.
- A API escuta só em `127.0.0.1` e recusa escrita (POST/PATCH/DELETE) vinda de outra origem e qualquer pedido com `Host` de fora (DNS rebinding).
- `data/` (a base) e `.env` **nunca** vão para o GitHub. As cópias da base têm os mesmos dados, sem senha: cuide da pasta.

## Como funciona

| Conceito | Detalhe |
|---|---|
| Conexão | Um *item* da Pluggy (um banco autorizado). |
| Sincronização | Item → contas → lançamentos (`GET /v2/transactions`, por cursor) → faturas (cartões) → investimentos. Relê os últimos 365 dias (`SYNC_DIAS_INICIAIS`) e as parcelas futuras, porque a Pluggy cria lançamentos com data passada. Nos últimos 60 dias, remove o que a Pluggy apagou e recriou com outro id (a sua edição passa para o substituto; sem substituto, o lançamento editado fica marcado como “removido pelo banco” e não soma). Se o banco avisar que os dados vieram incompletos, nada é removido até a próxima atualização completa. |
| Valores | Em centavos; saída é negativa (definida pelo `type` DEBIT/CREDIT da Pluggy). |
| Categorias | Ordem de decisão: regra sua > categoria da Pluggy (mapeada) > sem categoria. Uma edição manual nunca é sobrescrita pela sincronização. |
| Regras | Ao corrigir a categoria de um lançamento, a tela oferece criar a regra (texto editável e contagem de parecidos). Valem para lançamentos cuja descrição original *contém* o texto, menos os editados à mão. |
| PF / PJ | Cada conta é marcada como PF ou PJ (nome com "empresa", "PJ", "business" ou "CNPJ" começa como PJ; dá para trocar em **Contas**). O resumo separa as duas. |
| Alarme | Só PF. Topo do Resumo e linha fixa no menu: compara o gasto projetado do mês com o orçado e a renda esperada. Verde = dentro do orçado; amarelo = passou dele; vermelho = passou da renda. Os meses antes de a renda aparecer completa não entram. |
| Análises | Só PF, com os totais do Resumo. O mês inicial é automático (o primeiro com a renda completa) ou escolhido na página, e vale também para o alarme. |
| Resumo | Ignora transferências entre contas, pagamento de fatura e investimentos, que não são gasto nem renda. Estorno no cartão e reembolso em conta abatem a categoria. |
| Orçamento | Só PF. O planejado é digitado na linha e vale daquele mês em diante, até mudar. A renda esperada também; sem digitar, é a mediana dos 3 últimos meses fechados. |
| Recorrentes | Cobranças mensais de valor parecido, detectadas nos lançamentos, uma linha para cada. Você confirma, ignora ou marca que cancelou (e é avisado se cobrarem de novo). |
| Dado que falta | O app avisa, sem somar em nada: gasto que o limite do cartão já conta e ainda não apareceu, fatura que não bate com os lançamentos ou que não veio, e parcelas que o cartão ainda não mandou (previstas). |
| Patrimônio | Contas + investimentos + cofrinhos + bens manuais − cartões (limite usado) e dívidas. Cada sincronização guarda uma foto para a evolução. |
| Cofrinhos e caixinhas | Quando o banco informa dinheiro guardado, o cartão da conta (em **Contas**) pergunta se você usa cofrinho ou caixinha ali. Só o “Sim” soma no patrimônio. Se o valor já estava numa linha manual, zere a linha no mesmo dia. |

### Rotas principais

`POST /api/pluggy/connect-token` · `GET|POST /api/conexoes` · `POST /api/sync` · `GET /api/contas` · `PATCH /api/contas/:id` ·
`GET /api/lancamentos?mes=&conta=&categoria=&busca=&pendentes=1&pessoa=` · `PATCH /api/lancamentos/:id` · `GET /api/resumo?mes=&pessoa=` · `GET /api/ritmo?mes=` · `GET /api/analises?mes=` · `PUT /api/analises/inicio` ·
`GET|POST /api/categorias` · `GET|POST|DELETE /api/regras` · `GET /api/regras/previa` · `GET|PUT /api/orcamento` ·
`GET|PUT /api/recorrentes` · `POST /api/recorrentes/propostas` · `GET /api/patrimonio` · `POST|PATCH|DELETE /api/bens`

## Problemas conhecidos

Vistos no código e na documentação da Pluggy; ainda sem correção.

**1. Renovar a autorização anual pode travar ou repetir contas** (ainda não aconteceu na prática)

- **O que vence:** a autorização do MeuPluggy, um ano depois de conectar. É separada da autorização de cada banco, então o botão **Reautorizar** (que abre o meu.pluggy.ai) não a renova.
- **Como aparece:** a Pluggy passa a devolver listas vazias. Nada é apagado da sua base, e a conexão fica com erro em **Conexões** (“não devolveu nenhuma conta”).
- **Como renovar:** **Conectar banco → MeuPluggy**, um banco de cada vez. A Pluggy avisa que o id da conexão pode mudar.
- **Se o id mudar:** as contas e os lançamentos dos últimos 365 dias podem vir repetidos, sem as suas edições. Ocultar a conta antiga em **Contas** tira a repetição dos totais, mas tira junto o histórico mais antigo. Cofrinho segue a conta; os outros investimentos não têm "ocultar" e contariam em dobro no patrimônio.
- **Trava:** com 5 conexões salvas, **Conectar banco** fica desligado. A tela conta toda conexão já salva, e o app não remove nenhuma (remover no meu.pluggy.ai não muda essa conta).

**2. `app:instalar` recusa caminho com espaço**

O instalador comum do Node usa `C:\Program Files\nodejs`, e `app-windows.ps1` para com `Caminho com espaco nao funciona`. Saída: nvm-windows (passo 1) ou `npm start`.

**3. O nome do dono está fixo no código**

As instruções do MCP (`CONVENCOES` e descrições, em `api/src/mcp.ts`) tratam qualquer usuário pelo nome do dono do projeto, e a mensagem de "app não está rodando" cita a pasta dele. O `clientUserId` enviado à Pluggy (`api/src/server.ts`) também é fixo. Não muda o funcionamento; trocar à mão pode dar conflito no próximo `git pull`.

## Próximos passos

- [x] Orçamento mensal (planejado × realizado)
- [x] Alarme da renda (renda esperada × orçado × gasto)
- [x] Página de análises com gráficos
- [ ] Metas
- [ ] Faturas e parcelas futuras
- [x] Assinaturas recorrentes
- [ ] Lançamentos manuais (cartões fora do Open Finance, dinheiro)
- [ ] Importar regras e assinaturas do sistema antigo (`financeiro.db`)

## Licença

[MIT](LICENSE): use, mude e compartilhe à vontade, sem garantia.
