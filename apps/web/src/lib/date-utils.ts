import { format, parseISO } from 'date-fns';
import { toZonedTime, format as formatTz } from 'date-fns-tz';

// O fuso horário do usuário (detectado do navegador)
// Ex: "America/Sao_Paulo"
const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Converte uma data local (do input do usuário) para UTC ISO String
 * pronta para ser enviada para APIs que esperam UTC (como Asana due_at).
 * 
 * @param date Objeto Date representando o momento local escolhido pelo usuário
 * @returns String ISO (ex: "2023-10-25T17:30:00.000Z")
 */
export const toAsanaUTC = (date: Date): string => {
  return date.toISOString();
};

/**
 * Processa uma data vinda do Asana (que pode ser UTC ou YYYY-MM-DD)
 * para exibição correta no horário local do usuário.
 * 
 * O Asana retorna:
 * - due_on: "2023-10-25" (Data pura, sem hora)
 * - due_at: "2023-10-25T17:30:00.00Z" (Ponto no tempo UTC)
 * 
 * @param dateStr String de data (ISO ou YYYY-MM-DD)
 * @returns Date configurado para o fuso local
 */
export const fromAsanaDate = (dateStr: string): Date => {
  if (!dateStr) return new Date();
  
  // Se for uma data completa com hora (tem 'T' ou 'Z')
  if (dateStr.includes('T') || dateStr.includes('Z')) {
    return parseISO(dateStr);
  }
  
  // Se for apenas data (YYYY-MM-DD), o parseISO já trata corretamente como data local no início do dia
  // mas adicionamos o horário "fim do dia" ou "meio dia" dependendo da lógica de negócio.
  // Por padrão, o parseISO("2023-10-25") retorna data local.
  return parseISO(dateStr);
};

/**
 * Formata uma data para exibição amigável (Ex: "25/10/2023 14:30")
 * @param date Objeto Date ou string ISO
 * @param formatStr String de formatação date-fns
 */
export const formatDateLocal = (date: Date | string, formatStr: string = "dd/MM/yyyy HH:mm"): string => {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, formatStr);
};

/**
 * Cria uma data local baseada em input de data e hora (HTML Inputs)
 * @param datePart String YYYY-MM-DD
 * @param timePart String HH:mm
 * @returns Date combinado
 */
export const createLocalDate = (datePart: string, timePart: string): Date => {
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  
  // Cria data local
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return date;
};
