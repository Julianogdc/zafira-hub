export const FEATURE_FLAGS = [
  'CLIENT_360',
  'CONTENT_APPROVAL',
  'CREATORS',
  'COMMERCIAL',
  'FINANCIAL',
  'PERFORMANCE',
  'INTEGRATIONS',
  'COMMUNICATION',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number];

export function isValidFeatureFlagKey(key: string): key is FeatureFlagKey {
  return (FEATURE_FLAGS as readonly string[]).includes(key);
}
