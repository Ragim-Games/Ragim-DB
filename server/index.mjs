import { configFromEnv } from './config.mjs';
import { DiscordClient } from './discord.mjs';
import { DiscordStore } from './store.mjs';
import { createApp } from './http.mjs';

const config = configFromEnv();
const store = new DiscordStore(new DiscordClient(config.token), config);
const app = createApp(config, store);
let stopped = false;
let timer;
async function reconcile() {
  if (stopped || !config.token) return;
  await store.reconcile().catch(() => {});
  if (!stopped) timer = setTimeout(reconcile, 60000);
}
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Ragim DB listening on port ${config.port}. Discord configured: ${Boolean(config.token)}`);
  reconcile();
});
function shutdown() {
  stopped = true; clearTimeout(timer);
  app.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
