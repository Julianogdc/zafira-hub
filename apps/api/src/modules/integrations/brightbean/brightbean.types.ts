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

export interface BrightBeanAccountAnalyticsResponse {
  profile_views?: number | null;
  website_clicks?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  follower_growth?: number | null;
}

export interface BrightBeanPostAnalyticsResponse {
  impressions?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  views?: number | null;
  watch_time?: number | null;
  engagement?: number | null;
}

export interface BrightBeanErrorResponse {
  code?: string;
  detail?: string;
  message?: string;
}

export interface BrightBeanCreatePostPayload {
  social_account_id: string;
  caption: string;
  media_asset_ids: string[];
  action: 'draft' | 'schedule';
  scheduled_at?: string | null;
}
