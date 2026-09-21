import { app } from './app.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`[Zafira Hub API] Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
