import { asanaMirrorService, AsanaMirrorService } from './asana-mirror.service.js';
import { MIRROR_TIMEZONE } from './asana-mirror.diff.js';

/**
 * F6-IMP.8 — Agendador interno do espelho do Asana (DEC-F6-003, revisado pela DEC-F6-004).
 * Sem serviço novo no servidor.
 *
 *  - TEMPO REAL: cada aviso do Asana (webhook validado) confere só o projeto avisado,
 *    agrupando avisos por ASANA_MIRROR_WEBHOOK_DEBOUNCE_SECONDS (padrão 10; mínimo 5).
 *  - CONFERÊNCIA NOTURNA de segurança, uma vez por dia às ASANA_MIRROR_NIGHTLY_HOUR
 *    (padrão 3, horário de São Paulo): tira a foto diária e corrige avisos perdidos.
 *  - Uma conferência 2 minutos após a API iniciar, para cobrir avisos perdidos enquanto esteve fora do ar.
 *
 * DESLIGADO por padrão. Só liga com ASANA_MIRROR_SCHEDULE_ENABLED=true (decisão explícita por ambiente,
 * porque a capacidade do servidor ainda não foi medida — P24).
 * A execução única entre instâncias é garantida pela trava no banco (scheduler_leases).
 */

type Logger = { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

const readNumber = (value: string | undefined, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Hora (0–23) e minuto atuais no fuso de referência. */
function zonedHourMinute(now: Date, timeZone: string): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Milissegundos até a próxima ocorrência de `hour`:00 no fuso de referência (sempre > 0). */
export function msUntilNextHour(now: Date, hour: number, timeZone = MIRROR_TIMEZONE): number {
  const { hour: h, minute, second } = zonedHourMinute(now, timeZone);
  const elapsedToday = (h * 3600 + minute * 60 + second) * 1000 + now.getMilliseconds();
  const target = hour * 3600 * 1000;
  let wait = target - elapsedToday;
  if (wait <= 0) wait += 24 * 3600 * 1000;
  return wait;
}

export class AsanaMirrorScheduler {
  private nightlyTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, { timer: NodeJS.Timeout; projectGids: Set<string> }>();
  private lastPurgeDay: string | null = null;

  constructor(
    private readonly service: AsanaMirrorService = asanaMirrorService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private logger: Logger = console as unknown as Logger
  ) {}

  get enabled(): boolean {
    return this.env.ASANA_MIRROR_SCHEDULE_ENABLED === 'true';
  }

  get nightlyHour(): number {
    return readNumber(this.env.ASANA_MIRROR_NIGHTLY_HOUR, 3, 0, 23);
  }

  get debounceMs(): number {
    return readNumber(this.env.ASANA_MIRROR_WEBHOOK_DEBOUNCE_SECONDS, 10, 5) * 1000;
  }

  start(logger?: Logger): boolean {
    if (logger) this.logger = logger;
    if (!this.enabled || this.nightlyTimer) {
      this.logger.info({ enabled: this.enabled }, '[AsanaMirror] agendador não iniciado');
      return false;
    }
    this.scheduleNightly();
    this.startupTimer = setTimeout(() => void this.runAll('startup'), 120_000);
    this.startupTimer.unref?.();
    this.logger.info(
      { nightlyHour: this.nightlyHour, timeZone: MIRROR_TIMEZONE, debounceSeconds: this.debounceMs / 1000 },
      '[AsanaMirror] agendador iniciado (tempo real por avisos + conferência noturna)'
    );
    return true;
  }

  private scheduleNightly(): void {
    const wait = msUntilNextHour(new Date(), this.nightlyHour);
    this.nightlyTimer = setTimeout(() => {
      void this.runAll('nightly').finally(() => {
        if (this.nightlyTimer) this.scheduleNightly();
      });
    }, wait);
    this.nightlyTimer.unref?.();
  }

  stop(): void {
    if (this.nightlyTimer) clearTimeout(this.nightlyTimer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.nightlyTimer = null;
    this.startupTimer = null;
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  /** Conferência de todas as organizações com projetos vinculados + descarte diário da retenção. */
  async runAll(reason: 'nightly' | 'startup' = 'nightly'): Promise<void> {
    try {
      const organizations = await this.service.listOrganizationsWithLinks();
      for (const organizationId of organizations) {
        const result = await this.service.syncOrganization(organizationId, 'schedule');
        this.logger.info({ organizationId, reason, ...result }, '[AsanaMirror] conferência de segurança');
      }
      const today = new Date().toISOString().slice(0, 10);
      if (this.lastPurgeDay !== today) {
        const purged = await this.service.purgeExpired();
        this.lastPurgeDay = today;
        this.logger.info(purged, '[AsanaMirror] descarte de retenção (13 meses)');
      }
    } catch (error) {
      this.logger.error(error, '[AsanaMirror] falha na conferência de segurança');
    }
  }

  /**
   * Aviso do Asana (webhook já validado e deduplicado): confere só aquele projeto, em tempo real,
   * agrupando avisos próximos da mesma organização. Com o agendador desligado, não faz nada.
   * Se outra conferência estiver rodando (trava ocupada), tenta de novo uma vez após o agrupamento.
   */
  notifyProjectChanged(organizationId: string, projectGid: string, attempt = 1): boolean {
    if (!this.enabled || !organizationId || !projectGid) return false;
    const existing = this.pending.get(organizationId);
    if (existing) {
      existing.projectGids.add(projectGid);
      return true;
    }
    const projectGids = new Set([projectGid]);
    const timer = setTimeout(() => {
      this.pending.delete(organizationId);
      const gids = [...projectGids];
      void this.service
        .syncOrganization(organizationId, 'webhook', { projectGids: gids })
        .then((result) => {
          this.logger.info({ organizationId, ...result }, '[AsanaMirror] atualização em tempo real (aviso do Asana)');
          if (result.skipped && attempt < 2) {
            for (const gid of gids) this.notifyProjectChanged(organizationId, gid, attempt + 1);
          }
        })
        .catch((error) => this.logger.error(error, '[AsanaMirror] falha na atualização por aviso'));
    }, this.debounceMs);
    timer.unref?.();
    this.pending.set(organizationId, { timer, projectGids });
    return true;
  }
}

export const asanaMirrorScheduler = new AsanaMirrorScheduler();
