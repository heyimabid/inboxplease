import { maintenance } from './services/maintenance';
import { consume } from './queues/consumer';
import { app } from './app';
import type { Env } from './env';
export default {
  queue: consume,
  async scheduled(_controller: ScheduledController, env: Env) {
    await maintenance(env);
  },
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (env.API_ORIGIN && url.origin === env.API_ORIGIN) return app.fetch(request, env, ctx);
    if (
      ['/api/', '/auth/', '/authjs/', '/facebook/', '/webhooks/', '/media/'].some((p) =>
        path.startsWith(p),
      )
    )
      return env.API_ORIGIN
        ? new Response('Use the API hostname', { status: 404 })
        : app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
export { ConversationDO } from './durable-objects/conversation-do';
