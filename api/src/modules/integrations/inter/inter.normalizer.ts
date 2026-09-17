import { FinancialTransactionDirection } from '@prisma/client';

/**
 * Normalizador robusto de datas do extrato do Banco Inter PJ.
 * Suporta múltiplos formatos retornados pela API Banking v2:
 * - ISO completo: "2026-09-17T14:30:00.663504" ou "2026-09-17T14:30:00Z"
 * - ISO com espaço: "2026-09-17 14:30:00" ou "2026-09-17 14:30:00.000"
 * - ISO date-only: "2026-09-17" (normalizado para 12:00:00 UTC para evitar divergência de dia civil)
 * - Padrão brasileiro: "17/09/2026" ou "17/09/2026 14:30:00"
 * - Timestamp numérico em milissegundos ou segundos
 * - Instância de Date
 *
 * REGRA INEGOCIÁVEL:
 * NUNCA utiliza a data atual (new Date()) como fallback silencioso.
 * Se o valor for nulo, indefinido, vazio ou irrecuperável, lança erro explícito.
 */
export function normalizeInterDate(rawDate: unknown): Date {
  if (rawDate === null || rawDate === undefined || rawDate === '') {
    throw new Error('DATA_EXTRATO_INVALIDA: Campo de data do Banco Inter está ausente ou vazio.');
  }

  if (rawDate instanceof Date) {
    if (isNaN(rawDate.getTime())) {
      throw new Error('DATA_EXTRATO_INVALIDA: Objeto Date inválido fornecido.');
    }
    return rawDate;
  }

  if (typeof rawDate === 'number') {
    // Timestamp em segundos vs milissegundos
    const ts = rawDate < 10000000000 ? rawDate * 1000 : rawDate;
    const d = new Date(ts);
    if (isNaN(d.getTime())) {
      throw new Error(`DATA_EXTRATO_INVALIDA: Timestamp numérico inválido (${rawDate}).`);
    }
    return d;
  }

  if (typeof rawDate === 'string') {
    const trimmed = rawDate.trim();
    if (!trimmed) {
      throw new Error('DATA_EXTRATO_INVALIDA: String de data em branco.');
    }

    // 1. Formato brasileiro: DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
    const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (brMatch) {
      const day = brMatch[1].padStart(2, '0');
      const month = brMatch[2].padStart(2, '0');
      const year = brMatch[3];
      const hours = (brMatch[4] || '12').padStart(2, '0');
      const minutes = (brMatch[5] || '00').padStart(2, '0');
      const seconds = (brMatch[6] || '00').padStart(2, '0');
      const isoStr = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
      const parsed = new Date(isoStr);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    // 2. Formato ISO date-only: YYYY-MM-DD
    const isoDateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnlyMatch) {
      // Normaliza para meio-dia UTC para prevenir desvio de dia por fuso horário local
      const parsed = new Date(`${trimmed}T12:00:00.000Z`);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    // 3. Formato ISO com espaço entre data e hora: YYYY-MM-DD HH:mm:ss...
    const isoSpaceMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?.*)$/);
    if (isoSpaceMatch) {
      const parsed = new Date(`${isoSpaceMatch[1]}T${isoSpaceMatch[2]}Z`);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    // 4. Tentativa padrão ISO
    const standardParsed = new Date(trimmed);
    if (!isNaN(standardParsed.getTime())) {
      return standardParsed;
    }
  }

  throw new Error(`DATA_EXTRATO_INVALIDA: Não foi possível converter '${String(rawDate)}' em uma data válida.`);
}

/**
 * Normalizador robusto da direção de transação (CREDIT / DEBIT) do extrato Inter PJ.
 *
 * REGRA INEGOCIÁVEL:
 * - Usa os campos estruturados oficiais do payload do Inter (tipoOperacao, tipoTransacao, operacao, titulo).
 * - Não assume débitos por omissão.
 * - PIX RECEBIDO -> CREDIT (Entradas operacionais)
 * - PIX ENVIADO, pagamento de fatura, compra no cartão, tarifas -> DEBIT (Saídas operacionais)
 */
export function normalizeInterDirection(item: any): FinancialTransactionDirection {
  if (!item || typeof item !== 'object') {
    return 'DEBIT';
  }

  // 1. Campo estruturado primário oficial do Banco Inter: tipoOperacao ou operacao
  const rawOp = String(item.tipoOperacao || item.operacao || '').trim().toUpperCase();

  if (rawOp === 'C' || rawOp === 'CREDITO' || rawOp === 'CREDIT') {
    return 'CREDIT';
  }
  if (rawOp === 'D' || rawOp === 'DEBITO' || rawOp === 'DEBIT') {
    return 'DEBIT';
  }

  // 2. Campo estruturado secundário oficial: tipoTransacao
  const rawType = String(item.tipoTransacao || '').trim().toUpperCase();

  if (
    rawType.includes('RECEBIDO') ||
    rawType.includes('RECEBIMENTO') ||
    rawType.includes('CREDITO') ||
    rawType === 'PIX_RECEBIDO' ||
    rawType === 'TED_RECEBIDA' ||
    rawType === 'DOC_RECEBIDO' ||
    rawType === 'DEPOSITO' ||
    rawType === 'RESGATE'
  ) {
    return 'CREDIT';
  }

  if (
    rawType.includes('ENVIADO') ||
    rawType.includes('PAGAMENTO') ||
    rawType.includes('DEBITO') ||
    rawType.includes('COMPRA') ||
    rawType.includes('TARIFA') ||
    rawType === 'PIX_ENVIADO' ||
    rawType === 'TED_ENVIADA' ||
    rawType === 'PAGAMENTO_FATURA' ||
    rawType === 'COMPRA_CARTAO'
  ) {
    return 'DEBIT';
  }

  // 3. Campo estruturado complementar: titulo do lançamento (ex: 'PIX RECEBIDO', 'PIX ENVIADO', 'PAGAMENTO DE FATURA')
  const rawTitle = String(item.titulo || '').trim().toUpperCase();

  if (
    rawTitle.includes('PIX RECEBIDO') ||
    rawTitle.includes('RECEBIDO') ||
    rawTitle.includes('RECEBIMENTO') ||
    rawTitle.includes('TRANSFERENCIA RECEBIDA') ||
    rawTitle.includes('CRÉDITO') ||
    rawTitle.includes('CREDITO') ||
    rawTitle.includes('ESTORNO RECEBIDO')
  ) {
    return 'CREDIT';
  }

  if (
    rawTitle.includes('PIX ENVIADO') ||
    rawTitle.includes('PAGAMENTO') ||
    rawTitle.includes('FATURA') ||
    rawTitle.includes('COMPRA') ||
    rawTitle.includes('DÉBITO') ||
    rawTitle.includes('DEBITO') ||
    rawTitle.includes('TARIFA') ||
    rawTitle.includes('APLICAÇÃO') ||
    rawTitle.includes('APLICACAO')
  ) {
    return 'DEBIT';
  }

  // 4. Descrição do lançamento (último recurso se campos estruturados estiverem vazios)
  const rawDesc = String(item.descricao || '').trim().toUpperCase();
  if (
    rawDesc.includes('PIX RECEBIDO') ||
    rawDesc.includes('RECEBIMENTO') ||
    rawDesc.includes('TRANSFERENCIA RECEBIDA')
  ) {
    return 'CREDIT';
  }

  return 'DEBIT';
}

/**
 * Normaliza o valor da transação garantindo magnitude positiva absoluta.
 * O sinal e a cor da transação são determinados exclusivamente pela direção (CREDIT / DEBIT).
 */
export function normalizeInterAmount(rawAmount: unknown): number {
  if (rawAmount === null || rawAmount === undefined) {
    return 0;
  }

  if (typeof rawAmount === 'number') {
    return Math.abs(isNaN(rawAmount) ? 0 : rawAmount);
  }

  if (typeof rawAmount === 'string') {
    let clean = rawAmount.trim();
    if (!clean) return 0;

    // Se estiver no formato brasileiro '1.250,50'
    if (clean.includes(',') && clean.includes('.')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }

    const parsed = Number(clean);
    return Math.abs(isNaN(parsed) ? 0 : parsed);
  }

  return 0;
}

/**
 * Gera um externalId determinístico, imutável e robusto para itens do extrato do Banco Inter.
 * Prioriza identificador único bancário oficial do Inter (idTransacao, codigoTransacao, nossoNumero).
 * Fallback composto normalizado que previne variações de string e colisões espúrias.
 */
export function generateInterExternalId(
  item: any,
  occurredAt: Date,
  direction: FinancialTransactionDirection,
  amount: number
): string {
  if (!item || typeof item !== 'object') {
    const dateStr = occurredAt.toISOString().slice(0, 10);
    return `inter_${dateStr}_${direction}_${amount}`;
  }

  // 1. Identificadores oficiais do Banco Inter
  const officialId = String(item.idTransacao || item.codigoTransacao || item.nossoNumero || '').trim();
  if (officialId) {
    return officialId;
  }

  // 2. Fallback determinístico estruturado
  const dateStr = occurredAt.toISOString().slice(0, 10);
  const cleanTitle = String(item.titulo || item.descricao || 'transacao')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .slice(0, 40);

  // Contraparte (documento ou nome limpo) para desambiguar lançamentos múltiplos no mesmo dia
  const cpDoc = String(item.contraparte?.cpfCnpj || '').replace(/\D/g, '').trim();
  const cpName = String(item.contraparte?.nome || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .slice(0, 30);
  const cpSuffix = cpDoc || cpName || 'SEM_CP';

  return `inter_${dateStr}_${direction}_${amount}_${cleanTitle}_${cpSuffix}`;
}

/**
 * Mascara com segurança CPF ou CNPJ para exibição na gaveta de detalhes, protegendo a privacidade.
 */
export function maskDocument(rawDoc?: string | null): string {
  if (!rawDoc) return 'Documento não informado';
  const clean = rawDoc.replace(/\D/g, '').trim();
  if (!clean) return 'Documento não informado';

  if (clean.length === 11) {
    // CPF: ***.456.789-**
    return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
  }

  if (clean.length === 14) {
    // CNPJ: **.345.678/0001-**
    return `**.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-**`;
  }

  // Fallback genérico seguro
  if (clean.length > 4) {
    return `***${clean.slice(-4)}`;
  }

  return '***';
}

/**
 * Extrai o horário informado pelo banco se existir de forma comprovável.
 * Se o banco não tiver informado horário (ex: date-only ou meia-noite padrão), retorna null.
 * REGRA INEGOCIÁVEL: NUNCA inventar horário se o banco não informou.
 */
export function extractInterTime(rawPayload: any): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;

  const rawCandidate = String(
    rawPayload.dataHoraMovimento ||
    rawPayload.dataHora ||
    rawPayload.horaLancamento ||
    rawPayload.hora ||
    ''
  ).trim();

  if (!rawCandidate) return null;

  // Procura padrão HH:mm ou HH:mm:ss
  const timeMatch = rawCandidate.match(/(?:[ T]|^)(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) return null;

  const hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);

  // Se for exatamente 00:00 ou 12:00 gerado artificialmente por date-only:
  // Verifica se o campo original era apenas data sem hora
  if (rawCandidate.length <= 10 && !rawCandidate.includes(':')) {
    return null;
  }

  if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  return null;
}

