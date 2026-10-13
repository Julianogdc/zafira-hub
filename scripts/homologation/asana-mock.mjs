// ==============================================================================
// Asana SIMULADO para o Browser Gate F6 (Homologation Rehearsal) — somente CI.
// Dados 100% fictícios. Responde só GET; qualquer outro método é recusado (405) e
// contado em /__writes — o gate falha se o Hub tentar escrever no Asana (DEC-ASANA-001).
// Sem dependências: node scripts/homologation/asana-mock.mjs  (porta ASANA_MOCK_PORT, padrão 8080)
// ==============================================================================
import http from 'node:http';

const PORT = Number(process.env.ASANA_MOCK_PORT || 8080);
const TIME_ZONE = 'America/Sao_Paulo';
const writes = [];

const isoDay = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

const people = {
  ana: { gid: 'u-ana', name: 'Ana Gate' },
  bruno: { gid: 'u-bruno', name: 'Bruno Gate' },
};
const sections = {
  'gate-proj-a1': [
    { gid: 'sec-plan', name: 'Planejamento' },
    { gid: 'sec-prod', name: 'Produção' },
    { gid: 'sec-rev', name: 'Revisão' },
    { gid: 'sec-done', name: 'Concluídas' },
  ],
  'gate-proj-b1': [{ gid: 'sec-b', name: 'Fila B' }],
};
const projects = {
  'gate-proj-a1': { gid: 'gate-proj-a1', name: 'F6 Gate Social Media A', color: 'light-blue' },
  'gate-proj-b1': { gid: 'gate-proj-b1', name: 'F6 Gate Projeto Sigiloso B', color: 'light-red' },
};

const task = (projectGid, gid, name, sectionGid, due, extra = {}) => ({
  gid,
  name,
  completed: false,
  due_on: due,
  due_at: null,
  assignee: null,
  permalink_url: `https://app.asana.com/0/${projectGid}/${gid}`,
  notes: 'Tarefa fictícia do Browser Gate F6.',
  tags: [],
  custom_fields: [],
  memberships: [
    {
      project: { gid: projectGid, name: projects[projectGid].name },
      section: sections[projectGid].find((s) => s.gid === sectionGid) ?? null,
    },
  ],
  projects: [{ gid: projectGid }],
  ...extra,
});

const tasks = {
  'gate-proj-a1': [
    task('gate-proj-a1', 'ga-1', 'F6 Gate Roteiro atrasado', 'sec-prod', isoDay(-3), { assignee: people.ana }),
    task('gate-proj-a1', 'ga-2', 'F6 Gate Arte para hoje', 'sec-prod', isoDay(0), { assignee: people.bruno }),
    task('gate-proj-a1', 'ga-3', 'F6 Gate Legendas da semana', 'sec-rev', isoDay(2), { assignee: people.ana }),
    task('gate-proj-a1', 'ga-4', 'F6 Gate Calendário editorial', 'sec-plan', isoDay(10)),
    task('gate-proj-a1', 'ga-5', 'F6 Gate Ideias sem prazo', 'sec-plan', null),
    task('gate-proj-a1', 'ga-6', 'F6 Gate Briefing concluído', 'sec-done', isoDay(-8), { completed: true, assignee: people.bruno }),
  ],
  'gate-proj-b1': [task('gate-proj-b1', 'gb-1', 'F6 Gate Tarefa Sigilosa B', 'sec-b', isoDay(1))],
};
const allTasks = () => Object.values(tasks).flat();

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/__health') return send(res, 200, { ok: true });
  if (path === '/__writes') return send(res, 200, { count: writes.length, writes });

  if (req.method !== 'GET') {
    writes.push({ method: req.method, path, at: new Date().toISOString() });
    console.log(`[asana-mock] ESCRITA RECUSADA: ${req.method} ${path}`);
    return send(res, 405, { errors: [{ message: 'Asana simulado é somente leitura' }] });
  }

  const p = path.replace(/^\/api\/1\.0/, '');
  let m;
  if (p === '/users/me') {
    return send(res, 200, { data: { gid: 'u-gate', name: 'Conta Gate (fictícia)', email: 'gate@asana.invalid', workspaces: [{ gid: 'ws-gate', name: 'Workspace Gate' }] } });
  }
  if (p === '/workspaces') return send(res, 200, { data: [{ gid: 'ws-gate', name: 'Workspace Gate' }] });
  if ((m = p.match(/^\/workspaces\/[^/]+\/tags$/))) return send(res, 200, { data: [] });
  if ((m = p.match(/^\/workspaces\/[^/]+\/users$/)) || p === '/users') return send(res, 200, { data: Object.values(people) });
  if (p === '/projects') return send(res, 200, { data: Object.values(projects) });
  if ((m = p.match(/^\/projects\/([^/]+)$/))) {
    return projects[m[1]] ? send(res, 200, { data: projects[m[1]] }) : send(res, 404, { errors: [{ message: 'Projeto não encontrado' }] });
  }
  if ((m = p.match(/^\/projects\/([^/]+)\/tasks$/))) {
    return projects[m[1]] ? send(res, 200, { data: tasks[m[1]], next_page: null }) : send(res, 404, { errors: [{ message: 'Projeto não encontrado' }] });
  }
  if ((m = p.match(/^\/projects\/([^/]+)\/sections$/))) return send(res, 200, { data: sections[m[1]] ?? [] });
  if ((m = p.match(/^\/tasks\/([^/]+)$/))) {
    const t = allTasks().find((x) => x.gid === m[1]);
    return t ? send(res, 200, { data: t }) : send(res, 404, { errors: [{ message: 'Tarefa não encontrada' }] });
  }
  if ((m = p.match(/^\/tasks\/([^/]+)\/(subtasks|stories|attachments|dependencies|dependents)$/))) {
    if (m[2] === 'stories') {
      return send(res, 200, { data: [{ gid: 'st-1', type: 'comment', text: 'Comentário fictício do gate.', created_at: new Date().toISOString(), created_by: people.ana }] });
    }
    return send(res, 200, { data: [] });
  }
  if (p === '/webhooks') return send(res, 200, { data: [] });

  console.log(`[asana-mock] rota não simulada: GET ${p}`);
  return send(res, 404, { errors: [{ message: `Rota não simulada: ${p}` }] });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[asana-mock] ouvindo na porta ${PORT} (somente leitura, dados fictícios)`));
