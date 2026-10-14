-- F8-5p.2 (DEC-F8-031, P38): repeticoes controladas do coletor de metricas (15, 30 e 60 min) sem consumir o ponto da janela.
-- metricsRetryAt tambem serve de reserva curta durante a consulta (evita consultas simultaneas da mesma publicacao).
ALTER TABLE "content_publications" ADD COLUMN "metricsRetryAt" TIMESTAMP(3), ADD COLUMN "metricsErrorCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_metrics_error_count" CHECK ("metricsErrorCount" >= 0 AND "metricsErrorCount" <= 10);
