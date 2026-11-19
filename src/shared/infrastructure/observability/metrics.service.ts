import { Injectable } from '@nestjs/common';

/** Métricas operacionais leves; nunca participam de decisões de consistência financeira. */
@Injectable()
export class MetricsService {
    private readonly counters = new Map<string, number>();
    private readonly gauges = new Map<string, number>();
    private readonly observations = new Map<string, { sum: number; count: number }>;

    /** Soma um valor a um contador operacional. */
    increment(name: string, amount = 1): void {
        this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
    }

    /** Define a amostra atual de um gauge. */
    set(name: string, value: number): void {
        this.gauges.set(name, value);
    }

    /** Acumula soma e quantidade para expor uma observação agregada. */
    observe(name: string, value: number): void {
        const current = this.observations.get(name) ?? { sum: 0, count: 0 };
        current.sum += value;
        current.count += 1;
        this.observations.set(name, current);
    }

    /** Exposição Prometheus compatível para coleta sem acoplar o domínio a um vendor. */
    renderPrometheus(): string {
        const lines = [
            ...[...this.counters].map(([name, value]) => `${name} ${value}`),
            ...[...this.gauges].map(([name, value]) => `${name} ${value}`),
            ...[...this.observations].flatMap(([name, { sum, count }]) => [
                `${name}_sum ${sum}`,
                `${name}_count ${count}`,
            ]),
        ];
        return `${lines.join('\n')}\n`;
    }
}
