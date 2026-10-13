import test from 'node:test';
import assert from 'node:assert/strict';
import { contentStageCards, formatStageValue, publishedBarState } from '../content-stages-view';

// F8-3 (DEC-F8-007): contador de Entregas por estágio na tela.

const counts = { received: 3, sent: 2, approved: 1, published: null, publishedSource: 'NOT_INTEGRATED' } as const;

test('quatro cartões na ordem aprovada; Publicados sem dado nunca vira 0', () => {
  const cards = contentStageCards(counts);
  assert.deepEqual(
    cards.map((c) => c.label),
    ['Arquivos recebidos', 'Enviados para aprovação', 'Aprovados pelo cliente', 'Publicados']
  );
  assert.deepEqual(cards.map((c) => c.value), [3, 2, 1, null]);
  const published = cards[3];
  assert.equal(formatStageValue(published.value), '—');
  assert.notEqual(formatStageValue(published.value), '0');
  assert.equal(published.hint, 'Aguardando integração da publicação');
});

test('barra neutra enquanto a publicação não estiver integrada, mesmo sem recebidos', () => {
  assert.equal(publishedBarState(counts).kind, 'NOT_INTEGRATED');
  assert.equal(publishedBarState({ received: 0, published: null }).kind, 'NOT_INTEGRATED');
});

test('barra com dado confiável: proporção limitada e sem divisão por zero', () => {
  assert.deepEqual(publishedBarState({ received: 4, published: 1 }), { kind: 'RATIO', percent: 25, label: '1 de 4 peças publicadas' });
  assert.equal(publishedBarState({ received: 0, published: 0 }).kind, 'EMPTY');
  assert.equal((publishedBarState({ received: 2, published: 5 }) as { percent: number }).percent, 100);
});

test('valores zero reais continuam aparecendo como 0', () => {
  assert.equal(formatStageValue(0), '0');
});
