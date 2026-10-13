import { z } from 'zod';
import {
  ClientStatusSchema,
  CreateClientRequestSchema,
  UpdateClientRequestSchema,
  CreateClientContactRequestSchema,
  UpdateClientContactRequestSchema,
  CreateClientMeetingNoteRequestSchema,
  UpdateClientMeetingNoteRequestSchema,
  CreateClientRequest,
  UpdateClientRequest,
  CreateClientContactRequest,
  UpdateClientContactRequest,
  CreateClientMeetingNoteRequest,
  UpdateClientMeetingNoteRequest,
} from '@zafira/contracts';

export const ClientStatusEnum = ClientStatusSchema;

export const createClientSchema = CreateClientRequestSchema;
export const updateClientSchema = UpdateClientRequestSchema;

export const createClientContactSchema = CreateClientContactRequestSchema;
export const updateClientContactSchema = UpdateClientContactRequestSchema;

export const createClientMeetingNoteSchema = CreateClientMeetingNoteRequestSchema;
export const updateClientMeetingNoteSchema = UpdateClientMeetingNoteRequestSchema;

export const listClientsQuerySchema = z.object({
  status: ClientStatusSchema.optional(),
  search: z.string().trim().optional(),
});

export const listMeetingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});

export const clientIdParamSchema = z.object({
  id: z.string().uuid('ID do cliente deve ser um UUID válido'),
});

export const clientContactParamsSchema = z.object({
  id: z.string().uuid('ID do cliente deve ser um UUID válido'),
  contactId: z.string().uuid('ID do contato deve ser um UUID válido'),
});

export const clientMeetingParamsSchema = z.object({
  id: z.string().uuid('ID do cliente deve ser um UUID válido'),
  meetingId: z.string().uuid('ID da reunião deve ser um UUID válido'),
});

export type CreateClientInput = CreateClientRequest;
export type UpdateClientInput = UpdateClientRequest;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;
export type ClientIdParam = z.infer<typeof clientIdParamSchema>;
export type ClientContactParams = z.infer<typeof clientContactParamsSchema>;
export type ClientMeetingParams = z.infer<typeof clientMeetingParamsSchema>;

export type {
  CreateClientContactRequest,
  UpdateClientContactRequest,
  CreateClientMeetingNoteRequest,
  UpdateClientMeetingNoteRequest,
};
