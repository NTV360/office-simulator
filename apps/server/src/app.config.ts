import type { INestApplication } from '@nestjs/common';

/** How many reverse proxies sit in front (Caddy is one in the Docker stack), so `req.ip` is the real client and not the proxy. */
export function parseTrustProxy(v: string | undefined): boolean | number | string {
  if (v === undefined || v.trim() === '' || v === 'false') return false;
  if (v === 'true') return true;
  return /^\d+$/.test(v.trim()) ? Number(v) : v.trim();
}

/** Settings shared by the real server and by tests that start one. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks(); // lets Docker stop the server cleanly: the world is saved on the way out
  const trust = parseTrustProxy(process.env.TRUST_PROXY);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', trust);
}
