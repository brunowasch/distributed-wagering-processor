import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/** Cria a aplicação Nest e inicia o servidor HTTP na porta configurada. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Permite que SIGTERM/SIGINT acionem OnModuleDestroy nos workers e aguardem
  // o lote SQS atualmente em processamento antes de encerrar o processo.
  app.enableShutdownHooks();

  // Inicia o servidor HTTP na porta definida no .env ou na porta 3000.
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
