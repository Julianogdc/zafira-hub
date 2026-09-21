import { PermissionCode } from './permissions.js';

export type RoleType = 'ADMIN' | 'MANAGER' | 'MEMBER';

export const ADMIN_DEFAULTS: PermissionCode[] = [
  'clients.list',
  'clients.view',
  'clients.create',
  'clients.edit',
  'clients.archive',
  'clients.export',
  'clients.view_sensitive',
  'projects.view',
  'projects.sync',
  'projects.open_external',
  'projects.manage_links',
  'deliverables.view',
  'deliverables.plan',
  'deliverables.complete',
  'deliverables.reopen',
  'deliverables.cancel',
  'deliverables.adjust_target',
  'content.create',
  'content.review',
  'content.send_to_client',
  'content.approve_internal',
  'content.schedule',
  'content.publish',
  'content.delete',
  'financial.view_summary',
  'financial.view_details',
  'financial.edit',
  'financial.reconcile',
  'financial.export',
  'contracts.view',
  'contracts.create',
  'contracts.send',
  'contracts.resend',
  'contracts.cancel',
  'contracts.download',
  'commercial.view_pipeline',
  'commercial.edit_deal',
  'commercial.view_values',
  'commercial.export',
  'users.view',
  'users.invite',
  'users.edit_role',
  'users.edit_permissions',
  'users.assign_clients',
  'users.suspend',
  'users.remove',
  'integrations.view',
  'integrations.connect',
  'integrations.reconnect',
  'integrations.sync',
  'integrations.remove',
  'admin.configure_organization',
  'admin.configure_metrics',
  'admin.configure_templates',
  'admin.view_audit',
  'admin.configure_retention'
];

export const MANAGER_DEFAULTS: PermissionCode[] = [
  'clients.list',
  'clients.view',
  'clients.create',
  'clients.edit',
  'clients.archive',
  'clients.export',
  'clients.view_sensitive',
  'projects.view',
  'projects.sync',
  'projects.open_external',
  'projects.manage_links',
  'deliverables.view',
  'deliverables.plan',
  'deliverables.complete',
  'deliverables.reopen',
  'deliverables.cancel',
  'deliverables.adjust_target',
  'content.create',
  'content.review',
  'content.send_to_client',
  'content.approve_internal',
  'content.schedule',
  'content.publish',
  'content.delete',
  'financial.view_summary',
  'financial.view_details',
  'contracts.view',
  'contracts.create',
  'contracts.send',
  'contracts.resend',
  'contracts.download',
  'commercial.view_pipeline',
  'commercial.edit_deal',
  'commercial.view_values',
  'commercial.export',
  'users.view',
  'users.assign_clients',
  'integrations.view',
  'integrations.sync'
];

export const MEMBER_DEFAULTS: PermissionCode[] = [
  'clients.list',
  'clients.view',
  'projects.view',
  'projects.open_external',
  'deliverables.view',
  'deliverables.complete',
  'content.create',
  'content.review',
  'integrations.view'
];

export function getDefaultPermissionsForRole(role: RoleType): PermissionCode[] {
  switch (role) {
    case 'ADMIN':
      return ADMIN_DEFAULTS;
    case 'MANAGER':
      return MANAGER_DEFAULTS;
    case 'MEMBER':
      return MEMBER_DEFAULTS;
    default:
      return [];
  }
}

export function roleHasDefaultPermission(role: RoleType, permission: PermissionCode): boolean {
  const defaults = getDefaultPermissionsForRole(role);
  return defaults.includes(permission);
}
