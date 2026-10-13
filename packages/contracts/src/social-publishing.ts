export type SocialProviderCode = 'BRIGHTBEAN';

export type SocialPlatform =
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'LINKEDIN'
  | 'TIKTOK'
  | 'YOUTUBE'
  | 'TWITTER_X'
  | (string & {});

export type SocialContentFormat =
  | 'FEED'
  | 'REEL'
  | 'STORY_IMAGE'
  | 'STORY_VIDEO'
  | 'CAROUSEL';

export type SocialPostStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIALLY_PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

export interface SocialAccountCapabilities {
  charLimit?: number | null;
  escapedChars?: string | null;
  needsTitle?: boolean | null;
  supportsFirstComment?: boolean | null;
}

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  accountPicture?: string | null;
  profileUrl?: string | null;
  workspaceId?: string | null;
  accountHandle?: string | null;
  connectionStatus?: string | null;
  capabilities?: SocialAccountCapabilities;
}

export type SocialMediaType = 'IMAGE' | 'VIDEO' | 'OTHER';

export interface SocialMediaAsset {
  id: string;
  url: string;
  mimeType: string;
  mediaType: SocialMediaType;
}

export interface SocialPlatformPostState {
  accountId: string;
  platform: SocialPlatform;
  status: SocialPostStatus;
  externalPostId?: string | null;
  permalink?: string | null;
  error?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
}

export interface SocialPost {
  id: string;
  status: SocialPostStatus;
  content: string;
  format?: SocialContentFormat | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  platformStates: SocialPlatformPostState[];
  mediaItems?: SocialMediaAsset[];
}

export interface AggregatedSocialPost {
  id: string;
  clientId: string;
  clientName: string;
  accountId: string;
  accountName: string;
  platform: SocialPlatform;
  format: SocialContentFormat;
  status: SocialPostStatus;
  content: string;
  mediaItems: SocialMediaAsset[];
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  externalPostId?: string | null;
  releaseUrl?: string | null;
  platformStates: SocialPlatformPostState[];
}

export interface AggregatedSocialContentFilters {
  startDate?: string;
  endDate?: string;
  clientId?: string;
  accountId?: string;
  status?: SocialPostStatus;
  format?: SocialContentFormat;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AggregatedSocialContentResponse {
  posts: AggregatedSocialPost[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateSocialPostInput {
  accountId: string;
  format: SocialContentFormat;
  content: string;
  mediaIds: string[];
  isDraft?: boolean;
  scheduledAt?: string | null;
  idempotencyKey?: string;
}

export interface ScheduleSocialPostInput {
  postId: string;
  scheduledAt: string;
}

export interface SocialPublisherStatus {
  connected: boolean;
  provider: SocialProviderCode;
  workspaceId?: string | null;
}

export interface SocialPostAnalytics {
  impressions?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  videoViews?: number | null;
  watchTime?: number | null;
  engagementRate?: number | null;
}

export interface SocialAccountAnalytics {
  followerCount?: number | null;
  followingCount?: number | null;
  postCount?: number | null;
  profileViews?: number | null;
  websiteClicks?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface SocialMediaUploadResult {
  id: string;
  url: string;
  mimeType: string;
}
