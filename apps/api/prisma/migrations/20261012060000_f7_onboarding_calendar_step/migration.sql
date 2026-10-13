-- F7-3c - Etapas de onboarding por evento do Google Calendar (DEC-F7-014)
-- Guarda, na etapa CONCLUIDA, um instantaneo do evento vinculado (historico auditavel; sem FK porque o evento
-- pode sair da janela ou ser cancelado depois). NENHUMA linha e alterada. Nao remove nenhum objeto anterior.
-- NAO REMOVER indices parciais, CHECKs e gatilhos das migrations F7-1a, F7-2a e F7-3a.
ALTER TABLE "onboarding_step_runs"
  ADD COLUMN "calendarEventId" TEXT,
  ADD COLUMN "calendarEventTitle" TEXT,
  ADD COLUMN "calendarEventStartAt" TIMESTAMP(3);

ALTER TABLE "onboarding_step_runs"
  ADD CONSTRAINT "onboarding_runs_calendar_event_only_done" CHECK ("calendarEventId" IS NULL OR "status" = 'DONE');
