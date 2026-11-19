# v4.14.0 é a última imagem Community anterior à exigência de auth token nas
# imagens atuais. O projeto usa apenas SQS; manter a tag fixa torna o ambiente
# local reproduzível e não exige credenciais pessoais no Compose.
FROM localstack/localstack:4.14.0
COPY --chmod=755 init-sqs.sh /etc/localstack/init/ready.d/init-sqs.sh
