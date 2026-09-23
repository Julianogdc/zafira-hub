import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateSocialPostInput,
  SocialAccount,
  SocialPost,
  SocialPostStatus,
} from '@zafira/contracts';
import { SocialMediaUploadInput } from '../social-publisher.provider';

describe('SocialPublisher Contract Alignment (2B4A)', () => {
  it('should accept CreateSocialPostInput with a single accountId and optional idempotencyKey', () => {
    const input: CreateSocialPostInput = {
      accountId: 'acc-123',
      format: 'REEL',
      content: 'Publicação de teste',
      mediaIds: ['media-1'],
      idempotencyKey: 'idem-key-abc-123',
      isDraft: false,
      scheduledAt: null,
    };

    assert.equal(input.accountId, 'acc-123');
    assert.equal(input.idempotencyKey, 'idem-key-abc-123');
    // Confirma via TS que accountId é singular e idempotencyKey existe
  });

  it('should allow SocialPost with format as null', () => {
    const post: SocialPost = {
      id: 'post-1',
      status: 'PUBLISHED',
      content: 'Conteúdo sem formato explícito retornado da leitura remota',
      format: null,
      createdAt: new Date().toISOString(),
      platformStates: [
        {
          accountId: 'acc-123',
          platform: 'INSTAGRAM',
          status: 'PUBLISHED',
          externalPostId: 'ext-post-1',
          scheduledAt: null,
          publishedAt: new Date().toISOString(),
        },
      ],
    };

    assert.equal(post.format, null);
    assert.equal(post.platformStates[0].publishedAt !== undefined, true);
  });

  it('should support SocialAccount with optional capabilities, handle and connectionStatus', () => {
    const account: SocialAccount = {
      id: 'acc-123',
      platform: 'INSTAGRAM',
      accountName: 'Zafira Hub Official',
      accountHandle: '@zafirahub',
      connectionStatus: 'CONNECTED',
      capabilities: {
        charLimit: 2200,
        escapedChars: null,
        needsTitle: false,
        supportsFirstComment: true,
      },
    };

    assert.equal(account.accountHandle, '@zafirahub');
    assert.equal(account.capabilities?.charLimit, 2200);
    assert.equal(account.capabilities?.supportsFirstComment, true);
  });

  it('should allow SocialMediaUploadInput with optional idempotencyKey', () => {
    const uploadInput: SocialMediaUploadInput = {
      filename: 'video.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('dummy'),
      idempotencyKey: 'idem-upload-999',
    };

    assert.equal(uploadInput.idempotencyKey, 'idem-upload-999');
  });

  it('should document expected status mapping rules between BrightBean and Hub', () => {
    // Tabela conceitual de mapeamento futuro do BrightBeanProvider para SocialPostStatus do Hub
    const mapBrightBeanStatusToHub = (brightBeanStatus: string): SocialPostStatus => {
      switch (brightBeanStatus) {
        case 'draft':
        case 'pending_review':
        case 'pending_client':
        case 'approved':
        case 'changes_requested':
        case 'rejected':
          return 'DRAFT';
        case 'scheduled':
          return 'SCHEDULED';
        case 'publishing':
          return 'PUBLISHING';
        case 'published':
          return 'PUBLISHED';
        case 'failed':
          return 'FAILED';
        case 'partially_published':
          return 'PARTIALLY_PUBLISHED';
        default:
          return 'DRAFT';
      }
    };

    assert.equal(mapBrightBeanStatusToHub('draft'), 'DRAFT');
    assert.equal(mapBrightBeanStatusToHub('pending_review'), 'DRAFT');
    assert.equal(mapBrightBeanStatusToHub('scheduled'), 'SCHEDULED');
    assert.equal(mapBrightBeanStatusToHub('published'), 'PUBLISHED');
    assert.equal(mapBrightBeanStatusToHub('failed'), 'FAILED');
  });
});
