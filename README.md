# Distributed Wagering Processor

Serviço financeiro distribuído para processar operações de apostas de múltiplos provedores. O sistema mantém o saldo da carteira, o histórico imutável do ledger e as transações de forma consistente mesmo com entregas duplicadas, concorrência entre instâncias, mensagens fora de ordem e falhas durante o processamento.

## Índice

- [Recursos](#recursos)
- [Tecnologias](#tecnologias)
- [Começar com Docker Compose](#começar-com-docker-compose)
- [Executar no host](#executar-no-host)
- [Configuração](#configuração)
- [API HTTP](#api-http)
- [Operações de aposta](#operações-de-aposta)
- [Processamento assíncrono](#processamento-assíncrono)
- [Migrations](#migrations)
- [Testes](#testes)
- [Observabilidade](#observabilidade)
- [Segurança e escopo](#segurança-e-escopo)
- [Arquitetura](#arquitetura)

## Recursos

- Carteiras por jogador e moeda, com saldo inicial e versionamento.
- Processamento de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`.
- Idempotência persistida no PostgreSQL; repetição com o mesmo payload reproduz o resultado original e reutilização da chave com payload diferente gera conflito.
- Ledger imutável, com saldo anterior e posterior para cada movimentação.
- Inbox, Outbox e integração com filas FIFO do SQS.
- Retentativas com backoff, encaminhamento à dead-letter queue (DLQ) e recuperação de operações que chegaram antes de suas referências.
- Reconciliação de saldo, transações e ledger.
- Health checks de liveness e readiness, além de métricas Prometheus.

## Tecnologias

- Bun 1.x e TypeScript em modo estrito.
- NestJS 12.
- PostgreSQL 17 e MikroORM 7.
- Decimal.js para aritmética monetária.
- AWS SQS; LocalStack Community 4.14.0 para desenvolvimento e integração local.
- Docker Compose e Vitest.

## Começar com Docker Compose

Requisitos: Docker Desktop ou Docker Engine com Compose v2. A partir da raiz do repositório:

```sh
docker compose up --build -d
docker compose ps
```

O Compose inicia PostgreSQL, LocalStack e a aplicação. O PostgreSQL usa um volume persistente. O LocalStack cria as filas `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events.fifo`. A aplicação aplica as migrations antes de iniciar o servidor HTTP.

Verifique se a API está pronta:

```sh
curl -fsS http://localhost:3000/health/ready
```

Resposta esperada:

```json
{"status":"ready","dependencies":{"postgres":true,"sqs":true}}
```

Para acompanhar os serviços e logs:

```sh
docker compose ps
docker compose logs -f app
```

Para parar os serviços sem apagar os dados do PostgreSQL:

```sh
docker compose down
```

O volume persiste entre reinicializações. `docker compose down -v` também remove o volume e apaga os dados locais.

## Executar no host

Requisitos: Bun 1.x e Docker Compose. Instale as dependências e crie um arquivo de configuração local:

```sh
bun install --frozen-lockfile
cp .env.example .env
```

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`. O Compose define a configuração dos seus próprios containers; o arquivo `.env` é usado para iniciar a aplicação ou os testes diretamente no host.

Inicie PostgreSQL e LocalStack pelo Compose e rode a aplicação em modo de desenvolvimento:

```sh
docker compose up -d postgres localstack
bun run migration:up
bun run start:dev
```

Por padrão, `.env.example` aponta para o PostgreSQL local do Compose e contém credenciais exclusivamente de desenvolvimento (`postgres` e `test`). Ajuste `DATABASE_*` e as configurações AWS para sua instalação quando necessário. Não use esses valores em produção.

## Configuração

| Variável | Descrição | Valor local padrão |
|---|---|---|
| `PORT` | Porta HTTP | `3000` |
| `DATABASE_HOST` | Host PostgreSQL | `localhost` no host; `postgres` no Compose |
| `DATABASE_PORT` | Porta PostgreSQL | `5432` |
| `DATABASE_NAME` | Banco da aplicação | `wagering` |
| `DATABASE_USER` | Usuário PostgreSQL | `postgres` |
| `DATABASE_PASSWORD` | Senha PostgreSQL | `postgres` |
| `AWS_REGION` | Região AWS usada pelo SQS | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Access key para AWS/LocalStack | `test` no LocalStack |
| `AWS_SECRET_ACCESS_KEY` | Secret key para AWS/LocalStack | `test` no LocalStack |
| `AWS_ACCOUNT_ID` | ID da conta AWS simulada | `000000000000` |
| `AWS_SQS_ENDPOINT` | Endpoint do SQS | `http://localhost:4566` no host; `http://localstack:4566` no Compose |
| `WAGER_TRANSACTIONS_QUEUE` | Fila de operações recebidas | `wager-transactions.fifo` |
| `WAGER_TRANSACTIONS_DLQ_QUEUE` | Dead-letter queue | `wager-transactions-dlq.fifo` |
| `WAGER_EVENTS_QUEUE` | Fila de eventos publicados pela Outbox | `wager-events.fifo` |
| `SQS_CONSUMER_ENABLED` | Habilita o consumidor de operações | `true` no Compose |
| `OUTBOX_PUBLISHER_ENABLED` | Habilita o publisher da Outbox | `true` no Compose |
| `OUTBOX_POLL_INTERVAL_MS` | Intervalo do publisher | `1000` |
| `REFERENCE_WORKER_ENABLED` | Habilita novas tentativas de referências pendentes | `true` no Compose |
| `REFERENCE_WORKER_POLL_INTERVAL_MS` | Intervalo do worker de referências | `1000` |

`DATABASE_HOST` e `AWS_SQS_ENDPOINT` variam conforme o processo esteja no host ou na rede Docker. Dentro dos containers, use os nomes dos serviços `postgres` e `localstack`; no host, use `localhost`.

Arquivos `.env*` são ignorados pelo Git e pelo contexto de build do Docker. O único arquivo de ambiente versionado é `.env.example`, que contém valores locais de exemplo, não credenciais de produção.

## API HTTP

A API escuta em `http://localhost:3000`. Valores monetários usam strings decimais com duas casas, acompanhadas do código ISO 4217 da moeda. O sistema não converte moedas.

Os exemplos HTTP abaixo usam `curl`; no PowerShell, invoque `curl.exe` para evitar o alias `curl` do shell.

### Abrir uma carteira

`POST /wallets`

```sh
curl -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"player-123","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Resposta `201 Created`:

```json
{
  "id":"<wallet-id>",
  "playerId":"player-123",
  "balance":{"amount":"100.00","currency":"BRL"},
  "version":1
}
```

Há no máximo uma carteira por jogador e moeda. O saldo inicial pode ser zero ou positivo. Um saldo inicial positivo gera uma operação interna `OPENING` e seu lançamento de crédito no ledger; `OPENING` não pode ser submetida pela API nem pela fila.

### Consultar uma carteira

`GET /wallets/{walletId}`

### Consultar o ledger

`GET /wallets/{walletId}/ledger?limit=50&cursor={cursor}`

`limit` é opcional, padrão `50`, mínimo `1` e máximo `100`. A resposta contém `items` e `nextCursor`; use o cursor opaco retornado para buscar a próxima página. Cada item inclui direção, valor, moeda, saldo anterior, saldo posterior e data de criação.

### Submeter uma operação

`POST /wagering/transactions`

O header `Idempotency-Key` é obrigatório. Exemplo de aposta:

```sh
curl -X POST http://localhost:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:bet-1001' \
  -d '{
    "providerId":"provider-a",
    "externalTransactionId":"bet-1001",
    "playerId":"player-123",
    "walletId":"<wallet-id>",
    "roundId":"round-77",
    "gameId":"game-9",
    "kind":"BET",
    "money":{"amount":"10.00","currency":"BRL"}
  }'
```

Resposta normal `201 Created`:

```json
{
  "transactionId":"<transaction-id>",
  "status":"PROCESSED",
  "balance":{"amount":"90.00","currency":"BRL"},
  "idempotentReplay":false
}
```

Status HTTP relevantes:

| Status | Significado |
|---|---|
| `201` | Operação registrada/processada pela primeira vez |
| `200` | Replay idempotente de uma operação já registrada |
| `202` | Operação aguardando uma referência (`PENDING_REFERENCE`) |
| `400` | Contrato inválido, valor monetário inválido ou `OPENING` externo |
| `404` | Carteira ou transação não encontrada |
| `409` | Conflito de idempotência, carteira ou identificadores |
| `422` | Operação rejeitada por regra de negócio; a resposta inclui `failureCode` |
| `500` | Erro de servidor; quando classificado como permanente, a resposta inclui estado `FAILED` e `failureCode` estável |

### Consultar transações

- `GET /wagering/transactions/{transactionId}` — consulta pelo ID interno.
- `GET /providers/{providerId}/wagering/transactions/{externalTransactionId}` — consulta pela identidade e ID externo do provedor.

As respostas incluem o tipo e estado da operação, dados de referência, `failureCode` quando aplicável, datas de criação/processamento e os valores monetários como strings.

### Reconciliar uma carteira

`POST /wallets/{walletId}/reconciliation`

Compara o saldo armazenado com o saldo reconstruído pelo ledger e confere os lançamentos esperados para as transações processadas. Retorna `consistent`, os saldos, a diferença e as quantidades verificadas. A reconciliação é somente leitura: ela informa divergências e não altera o saldo nem o ledger.

## Operações de aposta

| Tipo | Efeito no saldo | Ledger | Regra principal |
|---|---|---|---|
| `BET` | Débito | `DEBIT` | Rejeitada se não houver saldo suficiente |
| `WIN` | Crédito | `CREDIT` | Referência a `BET` é opcional; se informada, deve ser elegível |
| `LOSS` | Nenhum | Nenhum | Registra o resultado sem movimentar saldo |
| `REFUND` | Crédito | `CREDIT` | Exige referência a uma `BET` processada e só pode ocorrer uma vez |
| `ROLLBACK` | Inverso da referência | Débito ou crédito | Exige referência processada elegível e só pode ocorrer uma vez |

`REFUND` e `ROLLBACK` devem usar o mesmo valor da transação referenciada. Referências precisam corresponder ao mesmo provedor, jogador, carteira e rodada. Referências ausentes deixam a operação em `PENDING_REFERENCE`; o worker persistente tenta processá-la novamente e rejeita após o limite configurado de tentativas.

Os estados possíveis são `PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED` e `FAILED`. `PROCESSED`, `REJECTED` e `FAILED` são terminais. Falhas de negócio não criam lançamentos financeiros indevidos; `LOSS` também não cria lançamento. O ledger é imutável.

## Processamento assíncrono

A fila de entrada `wager-transactions.fifo` recebe envelopes JSON neste formato:

```json
{
  "type":"WagerTransactionRequested",
  "messageId":"message-123",
  "data":{
    "providerId":"provider-a",
    "externalTransactionId":"bet-1001",
    "idempotencyKey":"provider-a:bet-1001",
    "playerId":"player-123",
    "walletId":"<wallet-id>",
    "roundId":"round-77",
    "gameId":"game-9",
    "kind":"BET",
    "money":{"amount":"10.00","currency":"BRL"}
  }
}
```

`REFUND` e `ROLLBACK` também incluem `referenceExternalTransactionId`. `WIN` pode incluir esse campo opcionalmente.

O consumidor registra Inbox, transação, alteração da carteira, ledger e eventos da Outbox em unidades de trabalho SQL. Ele só confirma a mensagem SQS depois do commit. Redeliveries são deduplicadas pela Inbox; mensagens que falham recebem visibilidade crescente (5, 10, 20 e até 30 segundos) e a política de redrive do LocalStack as encaminha à DLQ após cinco recebimentos. Falhas permanentes elegíveis ficam auditáveis como `FAILED` e não recebem ACK.

Os eventos confirmados pela Outbox são publicados em `wager-events.fifo`. A publicação ocorre depois do commit financeiro; uma falha entre o envio e a marcação de publicação pode gerar entrega repetida, por isso consumidores de eventos devem deduplicar pelo `eventId`.

O LocalStack Community é fixado em `4.14.0` para este ambiente SQS não exigir token pessoal. Atualize o pin somente após validar licença, comportamento e compatibilidade com o projeto.

## Migrations

As migrations versionadas ficam em `src/migrations` e são executadas pelo Compose antes da API. Também podem ser executadas manualmente no banco apontado por `DATABASE_*`:

```sh
bun run migration:up
bun run migration:down
```

`migration:down` reverte somente a migration mais recente. Execute migrations apenas no banco desejado e mantenha backups antes de reverter alterações em ambientes com dados importantes.

## Testes

O projeto usa Vitest. Os testes de integração PostgreSQL precisam de um banco dedicado com migrations aplicadas. Não aponte a suíte para um banco com dados de produção.

```sh
bun run test
bun run test:e2e
bun run build
bun run lint
```

Os testes SQS/LocalStack e de três processos independentes são condicionais. A integração de SIGTERM real deve executar em Linux; em Windows, sinais de processo não reproduzem o comportamento POSIX necessário para validar o hook assíncrono do Nest. Para rodar a suíte inteira em Linux por Docker, com Compose iniciado na raiz do repositório:

```sh
docker compose up -d postgres localstack
docker compose exec -T postgres createdb -U postgres wagering_test
docker build --target build -t wagering-test .
docker run --rm --network distributed-wagering-processor_default \
  -e DATABASE_HOST=postgres -e DATABASE_PORT=5432 \
  -e DATABASE_NAME=wagering_test -e DATABASE_USER=postgres \
  -e DATABASE_PASSWORD=postgres \
  -e AWS_SQS_ENDPOINT=http://localstack:4566 -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
  wagering-test bun run migration:up
docker run --rm --network distributed-wagering-processor_default \
  -e SQS_INTEGRATION_TESTS=true \
  -e WAGER_MULTIPROCESS_INTEGRATION_TESTS=true \
  -e DATABASE_HOST=postgres -e DATABASE_PORT=5432 \
  -e DATABASE_NAME=wagering_test -e DATABASE_USER=postgres \
  -e DATABASE_PASSWORD=postgres \
  -e AWS_SQS_ENDPOINT=http://localstack:4566 -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
  wagering-test bun run test
```

No PowerShell, use crase (`` ` ``) como continuação de linha no lugar de `\`. Considere a suíte aprovada somente quando o resumo do Vitest mostrar todos os testes passando, sem arquivos ou testes ignorados. Os testes exercitam dinheiro, domínio, API, migrations/constraints, Inbox/Outbox, SQS/LocalStack, redelivery, DLQ, reconciliação, corrida multiprocesso e shutdown após SIGTERM.

## Observabilidade

- `GET /health/live` confirma que o processo HTTP está ativo.
- `GET /health/ready` testa PostgreSQL e SQS; responde `503` se uma dependência não estiver disponível.
- `GET /metrics` expõe métricas em texto Prometheus, incluindo retries, conflitos, replays idempotentes, duração de processamento, atraso da Outbox, mensagens visíveis na DLQ e divergências de reconciliação.
- Logs de falha são estruturados em JSON e evitam registrar payloads monetários completos.

## Segurança e escopo

Autenticação não foi implementada, conforme permitido pelo desafio técnico; os endpoints HTTP não exigem identidade autenticada. O uso em produção exige integrar um provedor de identidade externo (por exemplo, OIDC) e fornecer credenciais reais por um mecanismo seguro de configuração. Credenciais do `.env.example` e do Compose são apenas para desenvolvimento local.

Não há conversão cambial. Operações precisam usar a moeda da carteira. Valores monetários devem ser enviados como strings decimais, nunca como números JSON.

## Arquitetura

O domínio financeiro fica separado das camadas de aplicação, persistência, mensageria e apresentação. PostgreSQL é a fonte de verdade para idempotência, transações e ledger; o processamento financeiro usa transações SQL e bloqueio por carteira. Inbox e Outbox são persistidos com os efeitos financeiros. O SQS oferece entrega at-least-once e não substitui as garantias de consistência do banco.

Mais detalhes sobre atomicidade, concorrência, retries, falhas permanentes, autenticação e trade-offs estão em [ARCHITECTURE.md](ARCHITECTURE.md).
