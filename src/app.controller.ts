import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

/** Controller raiz mantido para a rota simples de verificação da aplicação Nest. */
@Controller()
export class AppController {
  /** Injeta o serviço de aplicação associado à rota raiz. */
  constructor(private readonly appService: AppService) {}

  /** Retorna a resposta básica da rota GET /. */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
