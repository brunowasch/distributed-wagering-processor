# Decisões de arquitetura

## Persistência e valores financeiros

O projeto usa MikroORM 7 e PostgreSQL. `Money` mantém valores em `Decimal.js`; as
entidades armazenam quantias em `numeric(20,2)` e moeda em coluna separada. O
mapper converte para strings decimais, sem passar por ponto flutuante binário.
Migrations versionadas definem unicidade, chaves estrangeiras e checks no banco.
O serviço é compilado pelo Nest CLI e executado pelo Bun também em produção;
scripts de migração e inicialização não alternam para o runtime Node.

## Atomicidade e concorrência por carteira

Cada caso de uso financeiro executa em `DatabaseUnitOfWork`, que fornece o
`EntityManager` transacional. O processamento obtém `FOR UPDATE` apenas na linha
da carteira afetada, aplica a regra de domínio e grava a transação, o novo saldo,
o ledger e os eventos da Outbox antes do commit. Assim, instâncias diferentes
serializam apenas operações da mesma carteira; carteiras distintas continuam
independentes. O campo de versão otimista do MikroORM permanece como proteção
adicional contra atualizações acidentais sem o lock de linha.

O saldo e o lançamento são confirmados juntos. O ledger possui chave única por
carteira/transação, constraints de não negatividade e FKs para carteira e
transação. A aplicação não atualiza nem remove lançamentos.

## Idempotência

O PostgreSQL é a fonte de verdade: `idempotency_key` e
`(provider_id, external_transaction_id)` têm constraints únicas. O hash SHA-256
é calculado sobre JSON canônico dos campos de negócio, excluindo metadados de
transporte. Cada transação também guarda o saldo devolvido originalmente para
que um replay tardio produza a mesma resposta mesmo após movimentações seguintes.

## Inbox, Outbox e entrega

O Inbox deduplica pela combinação consumidor/ID da mensagem. A Outbox guarda um
envelope versionado e usa leases com `FOR UPDATE SKIP LOCKED` para distribuir
trabalho entre publishers e permitir recuperação depois de um crash. Publicação
externa ocorre após o commit; uma falha entre envio e marcação pode causar
redelivery, portanto os consumidores devem deduplicar pelo `eventId`. As
requisições chegam em `wager-transactions.fifo`; eventos da Outbox saem por
`wager-events.fifo`, separando os dois contratos. O adaptador SQS usa o
protocolo Query oficial sobre HTTP e assina requisições com AWS Signature V4,
usando `fetch` e `crypto` do runtime para manter o conjunto de dependências
existente.

O consumidor confirma a mensagem apenas depois do commit de Inbox e efeitos
financeiros. Falhas deixam a mensagem na fila e aplicam visibilidade crescente
de 5, 10, 20 e até 30 segundos; a redrive policy encaminha mensagens que excedem
cinco entregas para `wager-transactions-dlq.fifo`. No encerramento, os hooks do
Nest param novas consultas e aguardam o lote ativo. O gauge de DLQ é consultado
no SQS e representa mensagens visíveis, não tentativas que ainda aguardam redrive.

Falhas PostgreSQL não são tratadas todas como permanentes: somente SQLSTATE
`23514` (violação de CHECK para o mesmo payload) recebe `FAILED` e o código
estável `PERMANENT_INFRASTRUCTURE_FAILURE`. A UoW que tentou aplicar a operação
é revertida; uma nova UoW persiste a transação `FAILED` e o recebimento Inbox
sem marcar a mensagem como processada. A entrega continua sem ACK para que o
redrive configurado a encaminhe à DLQ após cinco recebimentos. Uma redelivery
encontra o `FAILED` terminal e não reaplica efeitos nem confirma a mensagem.
Indisponibilidade, erros SQLSTATE da classe `08`, deadlocks (`40P01`),
serialization (`40001`), lock timeout (`55P03`), conflitos de unicidade e erros
HTTP de negócio não são classificados como `FAILED`: erros recuperáveis recebem
retry; conflitos e rejeições de negócio mantêm o tratamento terminal próprio.
Na API, uma falha permanente persistida retorna HTTP 500 com o estado e o código
estável no corpo, enquanto uma falha transitória não cria estado terminal.

Referências sem correspondência são tentadas no máximo 12 vezes. REFUND e
ROLLBACK dependem de uma referência; WIN pode informá-la opcionalmente. Nos três
casos, uma referência informada que ainda não chegou deixa a transação em
`PENDING_REFERENCE`, sem alterar saldo. O worker consulta as tentativas vencidas
e retoma o processamento quando a referência aparece. O intervalo é exponencial,
limitado a 15 minutos; ao esgotar tentativas, a transação termina como `REJECTED`
com `REFERENCE_NOT_FOUND` e evento de rejeição.

## Reconciliação

A consulta de reconciliação compara o saldo corrente com a soma dos lançamentos
e confere o conjunto de transações processadas que afetam saldo com os
lançamentos existentes. Ela apenas informa divergências; o ledger é imutável e
nenhuma correção histórica é aplicada automaticamente.

## Autenticação

Autenticação foi deixada fora do escopo de execução, conforme permitido pelo
desafio. Em produção, a extensão recomendada é um guard OIDC conectado a um
Identity Provider (por exemplo Keycloak), com identidade do provedor validada
no caso de uso. Não há tabela local de senhas.

## Trade-offs e limites

O lock pessimista por carteira é simples e protege a invariante do saldo sob
várias instâncias, mas serializa operações de uma wallet muito disputada. O
`version` continua habilitado para detectar caminhos de escrita que não usem o
lock. A entrega SQS é at-least-once; nenhuma deduplicação do broker substitui as
constraints e o Inbox do PostgreSQL.

Os códigos de rejeição são estáveis para integração: `INSUFFICIENT_FUNDS`,
`ROLLBACK_WOULD_OVERDRAW`, `CURRENCY_MISMATCH`, `REFERENCE_NOT_FOUND`,
`REFERENCE_NOT_ELIGIBLE` e `REFERENCE_ALREADY_REVERSED`. Falha permanente de
infraestrutura usa `PERMANENT_INFRASTRUCTURE_FAILURE` e permanece auditável na
transação, no Inbox e na DLQ.
