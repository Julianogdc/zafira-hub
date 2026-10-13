import { acquireLease, releaseLease } from '../../../lib/scheduler-lease.js';
import { GoogleCalendarService, googleCalendarService } from './google-calendar.service.js';

/**
 * F7-3a - Agendador interno da agenda Google (DEC-F7-012). Sem servico novo na VPS.
 * DESLIGADO por padrao: so liga com GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED=true, depois de medir a
 * capacidade e com autorizacao (mesma regra da P24). Intervalo padrao 15 min, minimo 5.
 */

type Logger = { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

export const readIntervalMinutes = (value: string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 5 && n <= 1440 ? Math.floor(n) : 15;
};

export class GoogleCalendarScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: GoogleCalendarService = googleCalendarService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private logger: Logger = console as unknown as Logger
  ) {}

  isEnabled() {
    return this.env.GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED === 'true';
  }

  start(logger?: Logger) {
    if (logger) this.logger = logger;
    if (!this.isEnabled()) {
      this.logger.info({ enabled: false }, '[GoogleCalendar] agendador nao iniciado');
      return;
    }
    const everyMs = readIntervalMinutes(this.env.GOOGLE_CALENDAR_SYNC_INTERVAL_MINUTES) * 60_000;
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref?.();
    this.logger.info({ enabled: true, everyMs }, '[GoogleCalendar] agendador iniciado');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Um ciclo: uma instancia por vez (trava no banco); falha de uma organizacao nao derruba as demais. */
  async tick() {
    const holder = await acquireLease('gcal-sync-tick', 14 * 60_000);
    if (!holder) return;
    try {
      for (const organizationId of await this.service.organizationsToSync()) {
        try {
          await this.service.syncOrganization(organizationId);
        } catch (error) {
          this.logger.error({ organizationId, error: (error as Error).message }, '[GoogleCalendar] falha ao sincronizar organizacao');
        }
      }
    } finally {
      await releaseLease('gcal-sync-tick', holder);
    }
  }
}

export const googleCalendarScheduler = new GoogleCalendarScheduler();
