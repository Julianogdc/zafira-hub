$ErrorActionPreference = "Stop"
npm run typecheck:contracts
npm run typecheck:domain
npm run prisma:generate
npm run build:web
npm run build:api
npm run test:domain
npm test
