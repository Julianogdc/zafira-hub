import { acquireLease, releaseLease } from '../../lib/scheduler-lease.js';
import { AutomationService, automationService } from './automation.service.js';
import { dispatchIntervalSeconds, dispatcherEnabled } from './automation-config.js';

/**
 * F7-4a - Despachante interno das automacoes n8n (DEC-F7-016). Sem servico novo na VPS.
 * DESLIGADO por padrao: so liga com N8N_DISPATCH_ENABLED=true, depois de medir a capacidade e com autorizacao.
 * Desligado, nenhum pedido e enviado e nenhuma automacao e considerada concluida.
 */

type Logger = { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: AutomationService = automationService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private logger: Logger = console as unknown as Logger
  ) {}

  isEnabled() {
    return dispatcherEnabled(this.env);
  }

  start(logger?: Logger) {
    if (logger) this.logger = logger;
    if (!this.isEnabled()) {
      this.logger.info({ enabled: false }, '[Automation] despachante nao iniciado');
      return;
    }
    const everyMs = dispatchIntervalSeconds(this.env) * 1000;
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref?.();
    this.logger.info({ enabled: true, everyMs }, '[Automation] despachante iniciado');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Um ciclo por vez entre instancias (trava no banco). */
  async tick() {
    const holder = await acquireLease('n8n-dispatch-tick', 5 * 60_000);
    if (!holder) return;
    try {
      await this.service.dispatchDue({ limit: 50 });
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, '[Automation] falha no ciclo de despacho');
    } finally {
      await releaseLease('n8n-dispatch-tick', holder);
    }
  }
}

export const automationScheduler = new AutomationScheduler();
