/**
 * Utilitários puros de formatação para o Caixa e Gaveta Lateral Financeira.
 * REGRA INEGOCIÁVEL:
 * - O sufixo "às" SÓ pode existir quando houver horário real confirmado pelo banco.
 * - Se datePrecision === 'DATE_ONLY' ou time for nulo/vazio/técnico: NUNCA concatena "às".
 * - A string "às" nunca pode ficar sozinha.
 * - Contraparte: nunca exibir "Informado pelo banco" ou variações como se fossem nome de pessoa/empresa.
 */

export interface BankDateTimeFormatResult {
  dateOnly: string;
  hasRealTime: boolean;
  time: string | null;
  displayWithTime: string;
}

/**
 * Formata data e horário para exibição segura na interface.
 */
export function formatBankDateTimeDisplay(
  rawDate: string | Date | null | undefined,
  precision?: 'DATE_ONLY' | 'DATETIME',
  time?: string | null
): BankDateTimeFormatResult {
  if (!rawDate) {
    return {
      dateOnly: '-',
      hasRealTime: false,
      time: null,
      displayWithTime: '-',
    };
  }

  let dateOnly = '-';
  try {
    const d = typeof rawDate === 'string' ? new Date(rawDate) : rawDate;
    if (d && !isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const year = d.getUTCFullYear();
      dateOnly = `${day}/${month}/${year}`;
    }
  } catch {
    dateOnly = '-';
  }

  const cleanTime = typeof time === 'string' ? time.trim() : '';
  const isTimeTechnical = cleanTime === '12:00' || cleanTime === '12:00:00' || cleanTime === '00:00' || cleanTime === '00:00:00';
  const isTimeValid = cleanTime.length > 0 && !isTimeTechnical;

  const hasRealTime = precision === 'DATETIME' && isTimeValid;

  if (hasRealTime && cleanTime) {
    return {
      dateOnly,
      hasRealTime: true,
      time: cleanTime,
      displayWithTime: `${dateOnly} às ${cleanTime}`,
    };
  }

  return {
    dateOnly,
    hasRealTime: false,
    time: null,
    displayWithTime: dateOnly, // NUNCA inclui 'às'
  };
}

/**
 * Normaliza e formata o nome da contraparte para exibição.
 * - Não usa "Informado pelo banco" como se fosse o nome de uma pessoa/empresa.
 * - Quando não houver contraparte identificada, retorna: "Não informada pelo banco".
 */
export function formatCounterpartyDisplay(name?: string | null): string {
  if (!name || typeof name !== 'string') {
    return 'Não informada pelo banco';
  }
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (
    !trimmed ||
    lower === 'informado pelo banco' ||
    lower === 'informada pelo banco' ||
    lower === 'não informado' ||
    lower === 'nao informado' ||
    lower === 'sem contraparte' ||
    lower === 'null' ||
    lower === 'undefined'
  ) {
    return 'Não informada pelo banco';
  }
  return trimmed;
}
