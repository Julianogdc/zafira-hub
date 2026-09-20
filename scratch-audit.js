const fs = require('fs');
const path = require('path');
const files = [
  'apps/api/src/modules/auth/auth.routes.ts',
  'apps/api/src/modules/clients/clients.routes.ts',
  'apps/api/src/modules/financial/financial.routes.ts',
  'apps/api/src/modules/integrations/asaas/asaas.routes.ts',
  'apps/api/src/modules/integrations/asana/asana.routes.ts',
  'apps/api/src/modules/integrations/postiz/postiz.routes.ts',
  'apps/api/src/routes/health.ts'
];
let report = 'MÓDULO | MÉTODO | PATH EFETIVO | CLASSE | AUTH MECANISMO | PERMISSION | TENANT SOURCE\n---|---|---|---|---|---|---\n';
let unclassified = 0;
let humanRoutes = 0;
let withPermission = 0;
let requireRoleCount = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  let currentClass = 'DESCONHECIDO';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('requireRole')) requireRoleCount++;
    if (line.includes('// CLASSE:')) currentClass = line.split('CLASSE:')[1].trim();
    const match = line.match(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
    if (match) {
      const method = match[1].toUpperCase();
      const url = match[2];
      const module = path.basename(file).replace('.routes.ts', '').replace('.ts', '');
      if (currentClass === 'DESCONHECIDO') unclassified++;
      
      let preHandlerStr = '';
      for(let j=i; j<i+6 && j<lines.length; j++) {
        if(lines[j].includes('preHandler')) { preHandlerStr = lines[j]; break; }
      }
      
      let authMech = 'N/A';
      let permission = 'N/A';
      if (currentClass === 'PUBLIC_INTENTIONAL') authMech = 'Nenhum';
      else if (currentClass === 'MACHINE_AUTHENTICATED') authMech = 'Header/Token/HMAC (Ver Etapa N)';
      else if (currentClass === 'HUMAN_AUTHENTICATED') {
         humanRoutes++;
         if (preHandlerStr.includes('authenticate')) authMech = 'authenticate';
         else authMech = 'authenticate (implícito ou faltante?)';
         const permMatch = preHandlerStr.match(/requirePermission\('([^']+)'\)/);
         if (permMatch) { permission = permMatch[1]; withPermission++; }
         else if (url === '/api/v1/auth/session') permission = 'N/A (Exceção Auth Session)';
      }
      report += `${module} | ${method} | ${url} | ${currentClass} | ${authMech} | ${permission} | URL/Body/Session\n`;
      currentClass = 'DESCONHECIDO';
    }
  }
}
fs.writeFileSync('C:\\Users\\julia\\.gemini\\antigravity-ide\\brain\\5b942a2e-78d1-4a6d-93f7-135ee9191bd1\\scratch\\audit.md', report);
console.log('humanRoutes:', humanRoutes);
console.log('withPermission:', withPermission);
console.log('requireRoleCount:', requireRoleCount);
console.log('unclassified:', unclassified);
