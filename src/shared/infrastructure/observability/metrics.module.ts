import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';

/** Compartilha o coletor de métricas entre aplicação, workers e controllers. */
@Global()
@Module({ providers: [MetricsService], exports: [MetricsService] })
export class MetricsModule {}
