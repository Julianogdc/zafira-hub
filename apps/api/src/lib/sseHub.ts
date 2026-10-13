import { FastifyReply } from 'fastify';

export interface AsanaNormalizedEvent {
  type: string;
  organizationId: string;
  projectGid: string;
  resourceGid?: string;
  resourceType?: string;
  action?: string;
  timestamp: string;
  details?: any;
  timing?: {
    asanaCreatedAt?: string | null;
    serverReceivedAt?: number;
    serverPublishedAt?: number;
  };
}

interface SSEClient {
  id: string;
  organizationId: string;
  reply: FastifyReply;
}

class SSEHub {
  private clients: Map<string, Set<SSEClient>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      for (const [orgId, clientSet] of this.clients.entries()) {
        for (const client of clientSet) {
          try {
            client.reply.raw.write(':ping\n\n');
          } catch {
            this.removeClient(orgId, client.id);
          }
        }
      }
    }, 15000);

    // Evita que o timer impeça encerramento do processo em testes
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Registra uma nova conexão SSE de um cliente autenticado na organização.
   */
  register(organizationId: string, reply: FastifyReply): string {
    const clientId = `sse_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Importante no Fastify v5: assume o controle do stream HTTP manualmente
    if (typeof reply.hijack === 'function') {
      reply.hijack();
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Envia evento inicial de conexão estabelecida
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', organizationId })}\n\n`);

    const client: SSEClient = { id: clientId, organizationId, reply };

    if (!this.clients.has(organizationId)) {
      this.clients.set(organizationId, new Set());
    }
    this.clients.get(organizationId)!.add(client);

    const currentCount = this.clients.get(organizationId)?.size || 1;
    console.log(`[SSE] connected organizationId=${organizationId} connections=${currentCount}`);

    // Remove a conexão assim que o socket for fechado
    reply.raw.on('close', () => {
      this.removeClient(organizationId, clientId);
    });

    return clientId;
  }

  /**
   * Remove uma conexão do conjunto da organização.
   */
  removeClient(organizationId: string, clientId: string) {
    const orgClients = this.clients.get(organizationId);
    if (!orgClients) return;

    for (const client of orgClients) {
      if (client.id === clientId) {
        orgClients.delete(client);
        break;
      }
    }

    console.log(`[SSE] disconnected organizationId=${organizationId}`);

    if (orgClients.size === 0) {
      this.clients.delete(organizationId);
    }
  }

  /**
   * Publica um evento em tempo real EXCLUSIVAMENTE para os clientes da organização correspondente.
   * Garante isolamento absoluto multi-tenant.
   */
  publishToOrganization(organizationId: string, event: AsanaNormalizedEvent) {
    const orgClients = this.clients.get(organizationId);
    const count = orgClients?.size || 0;
    console.log(`[SSE] publish organizationId=${organizationId} eventType=${event.type} connections=${count}`);

    if (!orgClients || orgClients.size === 0) {
      return;
    }

    const payload = `event: asana_event\ndata: ${JSON.stringify(event)}\n\n`;

    for (const client of orgClients) {
      try {
        client.reply.raw.write(payload);
        if (typeof (client.reply.raw as any).flush === 'function') {
          (client.reply.raw as any).flush();
        }
      } catch {
        this.removeClient(organizationId, client.id);
      }
    }
  }

  /**
   * Retorna o número de conexões ativas (geral ou filtrado por organização).
   */
  getActiveConnectionsCount(organizationId?: string): number {
    if (organizationId) {
      return this.clients.get(organizationId)?.size || 0;
    }
    let total = 0;
    for (const set of this.clients.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Fecha todas as conexões e para o heartbeat (útil para testes/shutdown).
   */
  closeAll() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const set of this.clients.values()) {
      for (const client of set) {
        try {
          client.reply.raw.end();
        } catch {}
      }
    }
    this.clients.clear();
  }
}

export const sseHub = new SSEHub();
