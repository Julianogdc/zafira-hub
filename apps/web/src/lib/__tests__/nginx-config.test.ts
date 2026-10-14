import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '../../..');

test('Nginx Proxy Config (HM-3) — Imagem Web utiliza nginx.conf.template', () => {
  const dockerfile = readFileSync(path.join(webRoot, 'Dockerfile'), 'utf8');

  // Confirmação auditada: Dockerfile copia explicitamente nginx.conf.template para /etc/nginx/templates/
  assert.match(
    dockerfile,
    /COPY\s+apps\/web\/nginx\.conf\.template\s+\/etc\/nginx\/templates\/default\.conf\.template/,
    'Dockerfile do Web deve copiar apps/web/nginx.conf.template para templates do Nginx'
  );
});

test('Nginx Proxy Config (HM-3) — Limite multipart suporta 100 MiB com margem para overhead', () => {
  const template = readFileSync(path.join(webRoot, 'nginx.conf.template'), 'utf8');
  const conf = readFileSync(path.join(webRoot, 'nginx.conf'), 'utf8');

  for (const [filename, content] of [
    ['nginx.conf.template', template],
    ['nginx.conf', conf],
  ]) {
    // Não pode ser apenas 100m (rejeitaria arquivos de 100 MiB com cabeçalhos multipart)
    assert.doesNotMatch(
      content,
      /client_max_body_size\s+100m;/,
      `${filename}: não deve configurar estritamente 100m sem margem para overhead multipart`
    );

    // Deve configurar pelo menos 105m ou 110m (110m configurado)
    const match = content.match(/client_max_body_size\s+(\d+)m;/);
    assert.ok(match, `${filename}: diretiva client_max_body_size deve estar definida com unidade em megabytes (m)`);
    const sizeMb = Number(match[1]);
    assert.ok(sizeMb >= 105 && sizeMb <= 120, `${filename}: client_max_body_size deve estar entre 105m e 120m (atual: ${sizeMb}m)`);

    // Timeouts necessários para uploads de grande porte
    assert.match(content, /client_body_timeout\s+(?:1[2-9]\d|[2-9]\d{2})s;/, `${filename}: client_body_timeout deve ser >= 120s`);
    assert.match(content, /proxy_read_timeout\s+(?:1[2-9]\d|[2-9]\d{2})s;/, `${filename}: proxy_read_timeout deve ser >= 120s`);
    assert.match(content, /proxy_send_timeout\s+(?:1[2-9]\d|[2-9]\d{2})s;/, `${filename}: proxy_send_timeout deve ser >= 120s`);
    assert.match(content, /proxy_connect_timeout\s+(?:[6-9]\d|\d{3,})s;/, `${filename}: proxy_connect_timeout deve ser >= 60s`);

    // Streaming direto sem buffering integral do body
    assert.match(content, /proxy_request_buffering\s+off;/, `${filename}: proxy_request_buffering off deve estar ativo`);
  }
});

test('Nginx Proxy Config (HM-3) — Preservação de cabeçalhos, rotas e ausência de regressão', () => {
  const template = readFileSync(path.join(webRoot, 'nginx.conf.template'), 'utf8');

  // Cabeçalhos de proxy preservados
  assert.match(template, /proxy_set_header\s+Host\s+\$host;/);
  assert.match(template, /proxy_set_header\s+X-Real-IP\s+\$remote_addr;/);
  assert.match(template, /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
  assert.match(template, /proxy_set_header\s+X-Forwarded-Proto\s+\$scheme;/);

  // Rota de upstream /hub-api/ preservada
  assert.match(template, /location\s+\/hub-api\/\s*\{/);
  assert.match(template, /proxy_pass\s+\$\{API_UPSTREAM\}\/;/);

  // Sem regressão de SPA e arquivos estáticos
  assert.match(template, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/);
  assert.match(template, /gzip\s+on;/);
  assert.match(template, /location\s+~\*\s+\\\.\(\?:ico\|css\|js\|gif\|jpe\?g\|png\|woff2\?\|svg\)\$\s*\{/);
});
