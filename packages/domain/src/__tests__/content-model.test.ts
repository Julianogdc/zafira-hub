import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_FORMATS,
  CONTENT_MAX_FILE_BYTES,
  canAddMedia,
  canChangeFormat,
  detectFileType,
  isVersionEditable,
  storageKeyFor,
  validateMediaSet,
  validateUploadedFile,
} from '../content/content-model.js';

const bytes = (...n: number[]) => Uint8Array.from(n);
const text = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const mp4 = (brand: string) => Uint8Array.from([0, 0, 0, 24, ...text('ftyp'), ...text(brand), 0, 0, 0, 0]);

test('formatos canonicos: sem formato separado de video de feed', () => {
  assert.deepEqual([...CONTENT_FORMATS], ['FEED_IMAGE', 'CAROUSEL', 'REEL', 'STORY']);
});

test('tipo real por assinatura: JPG, PNG, WebP, MP4 e MOV; o resto e recusado', () => {
  assert.equal(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime, 'image/jpeg');
  assert.equal(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.mime, 'image/png');
  assert.equal(detectFileType(Uint8Array.from([...text('RIFF'), 1, 2, 3, 4, ...text('WEBP')]))?.mime, 'image/webp');
  assert.equal(detectFileType(mp4('isom'))?.mime, 'video/mp4');
  assert.equal(detectFileType(mp4('mp42'))?.mime, 'video/mp4');
  assert.equal(detectFileType(mp4('qt  '))?.mime, 'video/quicktime');
  assert.equal(detectFileType(mp4('heic')), null);
  assert.equal(detectFileType(text('<?php echo 1; ?>')), null);
  assert.equal(detectFileType(text('GIF89a......')), null);
  assert.equal(detectFileType(text('%PDF-1.7......')), null);
  assert.equal(detectFileType(bytes()), null);
});

test('validacao do arquivo: vazio, grande demais e extensao enganosa', () => {
  assert.equal((validateUploadedFile(bytes(0xff, 0xd8, 0xff), 0) as { code: string }).code, 'EMPTY_FILE');
  assert.equal((validateUploadedFile(bytes(0xff, 0xd8, 0xff), CONTENT_MAX_FILE_BYTES + 1) as { code: string }).code, 'FILE_TOO_LARGE');
  assert.equal(validateUploadedFile(bytes(0xff, 0xd8, 0xff), CONTENT_MAX_FILE_BYTES).ok, true);
  // "foto.jpg" que na verdade e um script: so o conteudo conta
  assert.equal((validateUploadedFile(text('<script>alert(1)</script>'), 30) as { code: string }).code, 'UNSUPPORTED_FILE_TYPE');
});

test('conjunto de midias por formato', () => {
  assert.equal(canAddMedia('FEED_IMAGE', [], 'IMAGE'), null);
  assert.equal(canAddMedia('FEED_IMAGE', [], 'VIDEO')?.code, 'MEDIA_KIND_NOT_ALLOWED');
  assert.equal(canAddMedia('FEED_IMAGE', ['IMAGE'], 'IMAGE')?.code, 'MEDIA_TOO_MANY');
  assert.equal(canAddMedia('REEL', [], 'IMAGE')?.code, 'MEDIA_KIND_NOT_ALLOWED');
  assert.equal(canAddMedia('REEL', [], 'VIDEO'), null);
  assert.equal(canAddMedia('STORY', [], 'IMAGE'), null);
  assert.equal(canAddMedia('STORY', ['VIDEO'], 'IMAGE')?.code, 'MEDIA_TOO_MANY');
  assert.equal(canAddMedia('CAROUSEL', Array(9).fill('IMAGE'), 'IMAGE'), null);
  assert.equal(canAddMedia('CAROUSEL', Array(10).fill('IMAGE'), 'IMAGE')?.code, 'MEDIA_TOO_MANY');
  assert.deepEqual(validateMediaSet('CAROUSEL', ['IMAGE']).map((p) => p.code), ['MEDIA_TOO_FEW']);
  assert.deepEqual(validateMediaSet('REEL', []).map((p) => p.code), ['MEDIA_MISSING']);
  assert.deepEqual(validateMediaSet('STORY', ['VIDEO']), []);
});

test('mudar formato exige que os arquivos atuais caibam', () => {
  assert.equal(canChangeFormat('REEL', ['IMAGE'])?.code, 'MEDIA_KIND_NOT_ALLOWED');
  assert.equal(canChangeFormat('STORY', ['IMAGE', 'IMAGE'])?.code, 'MEDIA_TOO_MANY');
  assert.equal(canChangeFormat('CAROUSEL', ['IMAGE']), null);
});

test('versao editavel e chave de storage por hash e organizacao', () => {
  assert.equal(isVersionEditable({ sentForApprovalAt: null }), true);
  assert.equal(isVersionEditable({ sentForApprovalAt: new Date() }), false);
  assert.equal(storageKeyFor('org-1', 'abc'), 'org/org-1/sha256/abc');
});

import {
  APPROVAL_DEFAULT_DAYS,
  APPROVAL_MAX_DAYS,
  approvalStatusOf,
  clampApprovalDays,
  linkState,
  validateApprovalInput,
} from '../content/content-model.js';

test('validade do link: padrao 7, maximo 30, minimo 1 (D3)', () => {
  assert.equal(APPROVAL_DEFAULT_DAYS, 7);
  assert.equal(APPROVAL_MAX_DAYS, 30);
  assert.equal(clampApprovalDays(undefined), 7);
  assert.equal(clampApprovalDays(null), 7);
  assert.equal(clampApprovalDays(90), 30);
  assert.equal(clampApprovalDays(0), 1);
  assert.equal(clampApprovalDays(3.9), 3);
});

test('estado do link: ativo, expirado e revogado (revogado prevalece)', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  assert.equal(linkState({ revokedAt: null, expiresAt: '2026-10-14T00:00:00Z' }, now), 'ACTIVE');
  assert.equal(linkState({ revokedAt: null, expiresAt: '2026-10-13T12:00:00Z' }, now), 'EXPIRED');
  assert.equal(linkState({ revokedAt: '2026-10-13T11:00:00Z', expiresAt: '2026-10-14T00:00:00Z' }, now), 'REVOKED');
});

test('decisao: N1 exige nome, contato e declaracao; alteracao exige comentario', () => {
  const base = { decision: 'APPROVED', approverName: 'Maria Souza', approverContact: 'maria@cliente.test', authorityDeclared: true };
  assert.deepEqual(validateApprovalInput(base), []);
  assert.deepEqual(validateApprovalInput({ ...base, authorityDeclared: false }).map((p) => p.field), ['authority']);
  assert.deepEqual(validateApprovalInput({ ...base, approverName: ' ', approverContact: '1' }).map((p) => p.field), ['approverName', 'approverContact']);
  assert.deepEqual(validateApprovalInput({ ...base, decision: 'CHANGES_REQUESTED' }).map((p) => p.field), ['comment']);
  assert.deepEqual(validateApprovalInput({ ...base, decision: 'CHANGES_REQUESTED', comment: 'Trocar a cor do fundo' }), []);
  assert.deepEqual(validateApprovalInput({ ...base, decision: 'TALVEZ' }).map((p) => p.field), ['decision']);
});

test('status interno de aprovacao', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const live = { revokedAt: null, expiresAt: '2026-10-20T00:00:00Z' };
  const dead = { revokedAt: null, expiresAt: '2026-10-01T00:00:00Z' };
  const revoked = { revokedAt: '2026-10-12T00:00:00Z', expiresAt: '2026-10-20T00:00:00Z' };
  assert.equal(approvalStatusOf({ sentForApprovalAt: null, decision: null, activeLink: null, lastLink: null, now }), 'NOT_SENT');
  assert.equal(approvalStatusOf({ sentForApprovalAt: '2026-10-12', decision: null, activeLink: live, lastLink: live, now }), 'AWAITING_CLIENT');
  assert.equal(approvalStatusOf({ sentForApprovalAt: '2026-10-12', decision: null, activeLink: dead, lastLink: dead, now }), 'LINK_EXPIRED');
  assert.equal(approvalStatusOf({ sentForApprovalAt: '2026-10-12', decision: null, activeLink: null, lastLink: revoked, now }), 'LINK_REVOKED');
  assert.equal(approvalStatusOf({ sentForApprovalAt: '2026-10-12', decision: 'APPROVED', activeLink: live, lastLink: live, now }), 'APPROVED');
  assert.equal(approvalStatusOf({ sentForApprovalAt: '2026-10-12', decision: 'CHANGES_REQUESTED', activeLink: null, lastLink: revoked, now }), 'CHANGES_REQUESTED');
});
