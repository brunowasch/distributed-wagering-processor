import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Inicia o servidor HTTP na porta definida no .env ou na porta 3000.
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
