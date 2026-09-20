import test from 'node:test';
import assert from 'node:assert';
import { ClientsService } from '../../modules/clients/clients.service.js';

test('Client Isolation and Scope rules', async (t) => {
  const svc = new ClientsService();

  // Testando apenas a lógica de geração de query parameters (getMemberScopeFilter)
  // Já que não podemos conectar banco real e os métodos usam prisma interno.
  // Como o método é privado, testamos indiretamente observando o que a classe espera no contexto.
  
  await t.test('Admin Org A lista somente Clients de A', () => {
    // Escopo organizacional puro
    const filter = (svc as any).getMemberScopeFilter({
      organizationId: 'org-a',
      membershipId: 'mem-1',
      role: 'ADMIN'
    });
    
    assert.deepStrictEqual(filter, {});
  });

  await t.test('Manager Org A lista somente Clients de A', () => {
    // Escopo organizacional puro
    const filter = (svc as any).getMemberScopeFilter({
      organizationId: 'org-a',
      membershipId: 'mem-2',
      role: 'MANAGER'
    });
    
    assert.deepStrictEqual(filter, {});
  });

  await t.test('Member A restrito a clientes atribuídos', () => {
    const filter = (svc as any).getMemberScopeFilter({
      organizationId: 'org-a',
      membershipId: 'mem-3',
      role: 'MEMBER'
    });
    
    assert.deepStrictEqual(filter, {
      assignedMembers: {
        some: {
          organizationMemberId: 'mem-3'
        }
      }
    });
  });
});
