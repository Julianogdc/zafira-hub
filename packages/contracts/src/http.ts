import { z } from 'zod';

export const API_VERSION = 'v1' as const;
export const API_BASE_PATH = '/api/v1' as const;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const IdSchema = z.string().min(1);

export const IsoDateTimeSchema = z.string().datetime();

export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido. Use YYYY-MM-DD.');
