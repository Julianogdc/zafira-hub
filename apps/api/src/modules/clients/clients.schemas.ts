import { z } from 'zod';

export const ClientStatusEnum = z.enum(['LEAD', 'ACTIVE', 'PAUSED', 'INACTIVE']);

export const createClientSchema = z
  .object({
    name: z.string().trim().min(1, 'O nome é obrigatório'),
    legalName: z.string().trim().optional(),
    document: z.string().trim().optional(),
    email: z
      .string()
      .trim()
      .email('Formato de e-mail inválido')
      .optional()
      .or(z.literal('')),
    phone: z.string().trim().optional(),
    status: ClientStatusEnum.default('ACTIVE').optional(),
    responsibleUserId: z
      .string()
      .uuid('ID do responsável deve ser um UUID válido')
      .optional(),
    contractValue: z
      .number({ invalid_type_error: 'O valor do contrato deve ser numérico' })
      .nonnegative('O valor do contrato não pode ser negativo')
      .optional(),
    startDate: z.coerce.date({ invalid_type_error: 'Data inicial inválida' }).optional(),
    endDate: z.coerce.date({ invalid_type_error: 'Data final inválida' }).optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      message: 'A data final deve ser posterior ou igual à data de início',
      path: ['endDate'],
    }
  );

export const updateClientSchema = z
  .object({
    name: z.string().trim().min(1, 'O nome não pode ser vazio').optional(),
    legalName: z.string().trim().optional().nullable(),
    document: z.string().trim().optional().nullable(),
    email: z
      .string()
      .trim()
      .email('Formato de e-mail inválido')
      .optional()
      .nullable()
      .or(z.literal('')),
    phone: z.string().trim().optional().nullable(),
    status: ClientStatusEnum.optional(),
    responsibleUserId: z
      .string()
      .uuid('ID do responsável deve ser um UUID válido')
      .optional()
      .nullable(),
    contractValue: z
      .number({ invalid_type_error: 'O valor do contrato deve ser numérico' })
      .nonnegative('O valor do contrato não pode ser negativo')
      .optional()
      .nullable(),
    startDate: z.coerce.date({ invalid_type_error: 'Data inicial inválida' }).optional().nullable(),
    endDate: z.coerce.date({ invalid_type_error: 'Data final inválida' }).optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      message: 'A data final deve ser posterior ou igual à data de início',
      path: ['endDate'],
    }
  );

export const listClientsQuerySchema = z.object({
  status: ClientStatusEnum.optional(),
  search: z.string().trim().optional(),
});

export const clientIdParamSchema = z.object({
  id: z.string().uuid('ID do cliente deve ser um UUID válido'),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
