import v8 from 'node:v8';
import vm from 'node:vm';

/**
 * HM-3 (ajuste complementar) - Sensor de memoria para os testes de streaming.
 *
 * METODO: amostra process.memoryUsage() (heapUsed, external, arrayBuffers, rss) em intervalo fixo e a cada bloco
 * produzido pela fonte (chamando sample()), registrando base (apos GC), fim (apos GC) e o PICO de cada metrica.
 * `Buffer` vive em `external`/`arrayBuffers`, NAO em `heapUsed`: medir so heapUsed subestima o consumo de quem
 * trafega bytes; por isso as quatro metricas sao separadas.
 *
 * LIMITACOES (devem acompanhar qualquer numero citado):
 *  - medicao no proprio processo de teste, uma execucao por cenario; valores variam entre execucoes e maquinas;
 *  - o GC do V8 nao e deterministico: o pico inclui lixo ainda nao coletado (e o que o processo de fato ocupa);
 *  - o pico de cada metrica pode ocorrer em instantes diferentes (por isso ha tambem o pico SIMULTANEO de
 *    heapUsed+external); amostragem periodica pode perder picos mais curtos que o intervalo (ha amostra por bloco);
 *  - rss inclui memoria do runtime/test runner e fragmentacao do alocador; nao e atribuivel so ao codigo medido;
 *  - o cache de paginas do SO usado pelo arquivo temporario em disco nao entra no rss do processo;
 *  - carga sintetica (bytes repetidos), sem rede real, sem Cloudflare R2 real.
 */

const MIB = 1024 * 1024;
const toMiB = (n: number) => Number((n / MIB).toFixed(2));

interface Sample {
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

const read = (): Sample => {
  const m = process.memoryUsage();
  return { heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers, rss: m.rss };
};

// GC sob demanda sem exigir --expose-gc na linha de comando do runner de testes
let gcFn: (() => void) | null = (globalThis as { gc?: () => void }).gc ?? null;
if (!gcFn) {
  try {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  } catch {
    gcFn = null;
  }
}
export const forceGc = () => {
  if (gcFn) {
    gcFn();
    gcFn();
  }
};

const inMiB = (s: Sample) => ({
  heapUsedMiB: toMiB(s.heapUsed),
  externalMiB: toMiB(s.external),
  arrayBuffersMiB: toMiB(s.arrayBuffers),
  rssMiB: toMiB(s.rss),
});

export interface MemoryReport {
  label: string;
  payloadMiB: number;
  gcAvailable: boolean;
  samples: number;
  intervalMs: number;
  baseline: ReturnType<typeof inMiB>;
  end: ReturnType<typeof inMiB>;
  peak: ReturnType<typeof inMiB>;
  /** Pico menos base, por metrica (instantes podem diferir). */
  deltaPeak: ReturnType<typeof inMiB>;
  /** Fim (apos GC) menos base: retencao residual. */
  deltaEnd: ReturnType<typeof inMiB>;
  /** Maior valor SIMULTANEO de heapUsed+external, menos o da base. */
  deltaPeakHeapPlusExternalMiB: number;
  /** Bytes brutos para as asserções dos testes. */
  raw: { deltaPeakHeapPlusExternal: number; deltaPeakArrayBuffers: number; deltaPeakRss: number; payloadBytes: number };
}

export class MemoryProbe {
  private baseline: Sample = read();
  private peak: Sample = read();
  private peakHeapPlusExternal = 0;
  private timer: NodeJS.Timeout | null = null;
  private samples = 0;

  constructor(
    private readonly label: string,
    private readonly payloadBytes: number,
    private readonly intervalMs = 2
  ) {}

  start(): this {
    forceGc();
    this.baseline = read();
    this.peak = { ...this.baseline };
    this.peakHeapPlusExternal = this.baseline.heapUsed + this.baseline.external;
    this.samples = 0;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
    return this;
  }

  /** Amostra imediata (chame a cada bloco produzido pela fonte). */
  sample(): void {
    const s = read();
    this.samples += 1;
    if (s.heapUsed > this.peak.heapUsed) this.peak.heapUsed = s.heapUsed;
    if (s.external > this.peak.external) this.peak.external = s.external;
    if (s.arrayBuffers > this.peak.arrayBuffers) this.peak.arrayBuffers = s.arrayBuffers;
    if (s.rss > this.peak.rss) this.peak.rss = s.rss;
    const combined = s.heapUsed + s.external;
    if (combined > this.peakHeapPlusExternal) this.peakHeapPlusExternal = combined;
  }

  stop(): MemoryReport {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sample();
    forceGc();
    const end = read();
    const diff = (a: Sample, b: Sample): Sample => ({
      heapUsed: a.heapUsed - b.heapUsed,
      external: a.external - b.external,
      arrayBuffers: a.arrayBuffers - b.arrayBuffers,
      rss: a.rss - b.rss,
    });
    const dPeak = diff(this.peak, this.baseline);
    const dPeakCombined = this.peakHeapPlusExternal - (this.baseline.heapUsed + this.baseline.external);
    return {
      label: this.label,
      payloadMiB: toMiB(this.payloadBytes),
      gcAvailable: gcFn !== null,
      samples: this.samples,
      intervalMs: this.intervalMs,
      baseline: inMiB(this.baseline),
      end: inMiB(end),
      peak: inMiB(this.peak),
      deltaPeak: inMiB(dPeak),
      deltaEnd: inMiB(diff(end, this.baseline)),
      deltaPeakHeapPlusExternalMiB: toMiB(dPeakCombined),
      raw: {
        deltaPeakHeapPlusExternal: dPeakCombined,
        deltaPeakArrayBuffers: dPeak.arrayBuffers,
        deltaPeakRss: dPeak.rss,
        payloadBytes: this.payloadBytes,
      },
    };
  }
}

/** Uma linha JSON por cenario, facil de coletar do log do teste como evidencia. */
export function logMemoryReport(report: MemoryReport): void {
  const { raw: _raw, ...printable } = report;
  console.log(`[HM-3 MEMORIA] ${JSON.stringify(printable)}`);
}
