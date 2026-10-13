-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_clientId_provider_key" ON "integration_connections"("clientId", "provider");
