import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export class ObservabilityService {
  public readonly registry: Registry;
  public readonly httpRequestsTotal: Counter<string>;
  public readonly httpRequestDurationSeconds: Histogram<string>;
  public readonly databaseHealthGauge: Gauge<string>;
  public readonly databaseHealthDurationSeconds: Histogram<string>;

  constructor(customRegistry?: Registry) {
    this.registry = customRegistry || new Registry();

    // Coleta métricas padrão do processo Node.js (CPU, heap, event loop, etc.) no registry isolado
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'zafira_http_requests_total',
      help: 'Total de requisicoes HTTP processadas pela API Zafira Hub',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'zafira_http_request_duration_seconds',
      help: 'Duracao das requisicoes HTTP em segundos',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.databaseHealthGauge = new Gauge({
      name: 'zafira_database_health',
      help: 'Status da conexao com o banco de dados PostgreSQL (1=conectado, 0=desconectado)',
      registers: [this.registry],
    });

    this.databaseHealthDurationSeconds = new Histogram({
      name: 'zafira_database_healthcheck_duration_seconds',
      help: 'Duracao do teste de conexao SELECT 1 de healthcheck em segundos',
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });
  }

  public recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const labels = {
      method: method.toUpperCase(),
      route: route || 'unmatched',
      status_code: statusCode.toString(),
    };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  public recordDatabaseHealth(isConnected: boolean, durationSeconds?: number): void {
    this.databaseHealthGauge.set(isConnected ? 1 : 0);
    if (typeof durationSeconds === 'number') {
      this.databaseHealthDurationSeconds.observe(durationSeconds);
    }
  }

  public async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  public getContentType(): string {
    return this.registry.contentType;
  }
}
