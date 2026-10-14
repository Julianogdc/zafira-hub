import { app } from './app.js';
import { asanaMirrorScheduler } from './modules/integrations/asana/mirror/asana-mirror.scheduler.js';
import { googleCalendarScheduler } from './modules/integrations/google-calendar/google-calendar.scheduler.js';
import { automationScheduler } from './modules/onboarding/automation.scheduler.js';
import { publicationScheduler } from './modules/content/publication/publication.scheduler.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';

// F6-IMP.8 — encerra o agendador do espelho do Asana junto com o servidor.
app.addHook('onClose', async () => asanaMirrorScheduler.stop());
app.addHook('onClose', async () => googleCalendarScheduler.stop());
app.addHook('onClose', async () => automationScheduler.stop());
app.addHook('onClose', async () => publicationScheduler.stop());

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`[Zafira Hub API] Server listening at http://${HOST}:${PORT}`);
    // F6-IMP.8 — agendador do espelho do Asana; só liga com ASANA_MIRROR_SCHEDULE_ENABLED=true
    asanaMirrorScheduler.start(app.log);
    // F7-3a - agendador da agenda Google; so liga com GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED=true
    googleCalendarScheduler.start(app.log);
    // F7-4a - despachante das automacoes n8n; so liga com N8N_DISPATCH_ENABLED=true
    automationScheduler.start(app.log);
    // F8-4a - despachante de publicacoes; so liga com PUBLICATION_DISPATCH_ENABLED=true
    publicationScheduler.start(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
