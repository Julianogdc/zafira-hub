import test from 'node:test';
import assert from 'node:assert';
import { buildClientResourceScopeWhere } from '../../modules/authorization/client-resource-scope.js';

test('Client Isolation and Resource Scope rules', async (t) => {
  await t.test('Admin Org A lista somente Clients de A (escopo organization-wide)', () => {
    const scope = buildClientResourceScopeWhere({
      organizationId: 'org-a',
      membershipId: 'mem-1',
      role: 'ADMIN',
    });

    assert.deepStrictEqual(scope, {
      organizationId: 'org-a',
    });
  });

  await t.test('Manager Org A restrito a direct assignment + active team assignment', () => {
    const scope = buildClientResourceScopeWhere({
      organizationId: 'org-a',
      membershipId: 'mem-2',
      role: 'MANAGER',
    });

    assert.strictEqual(scope.organizationId, 'org-a');
    assert.deepStrictEqual(scope.OR, [
      {
        assignedMembers: {
          some: {
            organizationMemberId: 'mem-2',
          },
        },
      },
      {
        teamAssignments: {
          some: {
            team: {
              isActive: true,
              members: {
                some: {
                  organizationMemberId: 'mem-2',
                },
              },
            },
          },
        },
      },
    ]);
  });

  await t.test('Member Org A restrito a direct assignment + active team assignment', () => {
    const scope = buildClientResourceScopeWhere({
      organizationId: 'org-a',
      membershipId: 'mem-3',
      role: 'MEMBER',
    });

    assert.strictEqual(scope.organizationId, 'org-a');
    assert.deepStrictEqual(scope.OR, [
      {
        assignedMembers: {
          some: {
            organizationMemberId: 'mem-3',
          },
        },
      },
      {
        teamAssignments: {
          some: {
            team: {
              isActive: true,
              members: {
                some: {
                  organizationMemberId: 'mem-3',
                },
              },
            },
          },
        },
      },
    ]);
  });
});
