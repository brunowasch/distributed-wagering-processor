import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';

/** Processo Bun auxiliar que expõe o consumidor real aos sinais do sistema operacional. */
async function main(): Promise<void> {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    app.enableShutdownHooks(['SIGTERM']);
    process.stdout.write('CONSUMER_SHUTDOWN_READY\n');
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
