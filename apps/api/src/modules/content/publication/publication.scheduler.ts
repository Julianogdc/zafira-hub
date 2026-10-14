import { acquireLease, releaseLease } from '../../../lib/scheduler-lease.js';
import { PublicationDispatcher, publicationDispatcher } from './publication-dispatcher.js';

/**
 * F8-4a (DEC-F8-023) - Ciclo do despachante de publicacoes. DESLIGADO por padrao:
 * so liga com PUBLICATION_DISPATCH_ENABLED=true, com autorizacao. Desligado, nada e enviado ao provedor.
 */

type Logger = { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

export const publicationDispatchIntervalSeconds = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.PUBLICATION_DISPATCH_INTERVAL_SECONDS);
  return Number.isFinite(n) && n >= 15 ? Math.floor(n) : 30;
};

export class PublicationScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dispatcher: PublicationDispatcher = publicationDispatcher,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private logger: Logger = console as unknown as Logger
  ) {}

  start(logger?: Logger) {
    if (logger) this.logger = logger;
    if (!this.dispatcher.isEnabled()) {
      this.logger.info({ enabled: false }, '[Publication] despachante nao iniciado');
      return;
    }
    const everyMs = publicationDispatchIntervalSeconds(this.env) * 1000;
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref?.();
    this.logger.info({ enabled: true, everyMs }, '[Publication] despachante iniciado');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Um ciclo por vez entre instancias (trava no banco). */
  async tick() {
    const holder = await acquireLease('publication-dispatch-tick', 5 * 60_000);
    if (!holder) return;
    try {
      await this.dispatcher.dispatchDue({ limit: 20 });
      await this.dispatcher.reconcileDue({ limit: 50 });
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, '[Publication] falha no ciclo de despacho');
    } finally {
      await releaseLease('publication-dispatch-tick', holder);
    }
  }
}

export const publicationScheduler = new PublicationScheduler();
