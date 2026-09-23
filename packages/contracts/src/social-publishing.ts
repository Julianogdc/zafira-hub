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

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  accountPicture?: string | null;
  profileUrl?: string | null;
  workspaceId?: string | null;
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
}

export interface SocialPost {
  id: string;
  status: SocialPostStatus;
  content: string;
  format: SocialContentFormat;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  platformStates: SocialPlatformPostState[];
}

export interface CreateSocialPostInput {
  accountIds: string[];
  format: SocialContentFormat;
  content: string;
  mediaIds: string[];
  isDraft?: boolean;
  scheduledAt?: string | null;
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
