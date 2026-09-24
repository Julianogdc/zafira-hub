/**
 * Tipos internos do protocolo REST v1 da BrightBean.
 * ESTES TIPOS NÃO SÃO EXPOSTOS EM @zafira/contracts.
 */

export interface BrightBeanMeResponse {
  workspace_id: string;
  user_id?: string;
  email?: string;
}

export interface BrightBeanAccount {
  id: string;
  platform: string;
  account_name: string;
  account_handle?: string | null;
  connection_status?: string | null;
  char_limit?: number | null;
  escaped_chars?: string | null;
  needs_title?: boolean | null;
  supports_first_comment?: boolean | null;
}

export interface BrightBeanAccountsListResponse {
  accounts: BrightBeanAccount[];
}

export interface BrightBeanMediaAsset {
  id: string;
  url: string;
  mime_type: string;
  media_type?: string | null;
}

export interface BrightBeanPlatformPost {
  social_account_id: string;
  platform: string;
  status: string;
  platform_post_id?: string | null;
  publish_error?: string | null;
  scheduled_at?: string | null;
  published_at?: string | null;
}

export interface BrightBeanPostResponse {
  id: string;
  status: string;
  caption: string;
  scheduled_at?: string | null;
  published_at?: string | null;
  created_at: string;
  platform_posts?: BrightBeanPlatformPost[];
}

export interface BrightBeanDerivedMetric {
  key: string;
  label: string;
  kind: string;
  value: number;
  delta: number;
  series: number[];
}

export interface BrightBeanEngagementCard {
  rate: BrightBeanDerivedMetric;
  parts: BrightBeanDerivedMetric[];
}

export interface BrightBeanAccountAnalyticsResponse {
  account_id: string;
  platform: string;
  account_name: string;
  connection_status: string;
  days: number;
  analytics_available: boolean;
  unavailable_reason?: string | null;
  hero_metrics: BrightBeanDerivedMetric[];
  engagement?: BrightBeanEngagementCard | null;
  follower_growth?: BrightBeanDerivedMetric | null;
  captured_at?: string | null;
  next_sync_eta?: string | null;
}

export interface BrightBeanPostMetricTile {
  key: string;
  label: string;
  kind: string;
  value: number;
  series: number[];
  is_primary: boolean;
}

export interface BrightBeanPlatformPostAnalytics {
  platform_post_id: string;
  social_account_id: string;
  platform: string;
  status: string;
  published_at?: string | null;
  analytics_available: boolean;
  unavailable_reason?: string | null;
  metric_tiles: BrightBeanPostMetricTile[];
  captured_at?: string | null;
  next_sync_eta?: string | null;
}

export interface BrightBeanPostAnalyticsResponse {
  post_id: string;
  workspace_id: string;
  title: string;
  caption: string;
  platform_posts: BrightBeanPlatformPostAnalytics[];
}

export interface BrightBeanErrorResponse {
  error?: string;
  detail?: string;
  code?: string;
  message?: string;
}

export interface BrightBeanCreatePostPayload {
  social_account_id: string;
  caption: string;
  media_asset_ids: string[];
  action: 'draft' | 'schedule';
  scheduled_at?: string | null;
  post_type?: 'story' | 'reel';
}
