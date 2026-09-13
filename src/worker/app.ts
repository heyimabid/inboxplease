import { cors } from 'hono/cors';
import { privacyRoutes } from './routes/privacy';
import { analyticsRoutes } from './routes/analytics';
import { validateEnv } from './env';
import { rateLimit } from './services/rate-limit';
import { bodyLimit } from 'hono/body-limit';
import { customerImageRoutes, mockImageRoutes } from './routes/customer-images';
import { orderRoutes } from './routes/orders';
import { conversationRoutes, mockRoutes, customerRoutes } from './routes/conversations';
import { pageRoutes } from './routes/facebook-pages';
import { webhookRoutes } from './routes/webhooks-meta';
import { oauthRoutes } from './meta/oauth';
import { authjsRoutes } from './authjs';
import { workspaceRoutes } from './routes/workspaces';
import { productRoutes } from './routes/products';
import { settingsRoutes } from './routes/settings';
import { imageRoutes, mediaRoutes } from './routes/images';
import { authRoutes } from './routes/auth';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import type { AppContext } from './services/sessions';
import { AppError } from './shared/errors';
import { log } from './shared/logger';
export const app = new Hono<AppContext>();
app.use(
  '*',
  cors({
    origin: (origin, c) => (origin === c.env.APP_ORIGIN ? origin : ''),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Auth-Return-Redirect'],
    maxAge: 600,
  }),
);
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.header('X-Request-ID', c.get('requestId'));
  await next();
});
app.use(
  '*',
  secureHeaders({
    crossOriginResourcePolicy: 'same-site',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'blob:', 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    referrerPolicy: 'no-referrer',
  }),
);
app.onError((error, c) => {
  if (error instanceof ZodError)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the submitted fields',
          fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      422,
    );
  if (error instanceof AppError)
    return c.json(
      { success: false, error: { code: error.code, message: error.message } },
      error.status,
    );
  log('request_failed', { requestId: c.get('requestId'), errorCategory: 'internal' });
  return c.json(
    {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    },
    500,
  );
});
app.use('/api/*', async (c, next) => {
  validateEnv(c.env);
  c.header('Cache-Control', 'no-store');
  await rateLimit(c.env, `api:${c.req.header('CF-Connecting-IP') ?? 'local'}`, 300);
  await next();
});
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 10000000,
    onError: (c) =>
      c.json(
        { success: false, error: { code: 'TOO_LARGE', message: 'Request body is too large' } },
        413,
      ),
  }),
);
app.use('/auth/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
for (const path of ['/authjs/*', '/facebook/*']) {
  app.use(path, async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.use(
    path,
    bodyLimit({
      maxSize: 32000,
      onError: (c) =>
        c.json(
          { success: false, error: { code: 'TOO_LARGE', message: 'Request body is too large' } },
          413,
        ),
    }),
  );
}
app.route('/auth/privacy', privacyRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/authjs', authjsRoutes);
app.route('/facebook', oauthRoutes);
app.route('/facebook/pages', pageRoutes);
app.route('/auth', authRoutes);
app.route('/api/facebook/pages', pageRoutes);
app.route('/webhooks/meta', webhookRoutes);
app.route('/api/workspaces', workspaceRoutes);
app.route('/api/customer-images', customerImageRoutes);
app.route('/api/mock/image', mockImageRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/conversations', conversationRoutes);
app.route('/api/mock', mockRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/products', productRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/images', imageRoutes);
app.route('/media', mediaRoutes);
app.get('/api/health', (c) =>
  c.json({ success: true, data: { service: 'InboxPlease', mode: c.env.APP_MODE } }),
);
app.notFound((c) =>
  c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404),
);
