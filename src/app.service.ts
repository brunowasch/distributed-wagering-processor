import { Injectable } from '@nestjs/common';

/** Serviço de aplicação associado ao endpoint raiz padrão do projeto. */
@Injectable()
export class AppService {
  /** Produz a mensagem usada pela rota GET /. */
  getHello(): string {
    return 'Hello World!';
  }
}
