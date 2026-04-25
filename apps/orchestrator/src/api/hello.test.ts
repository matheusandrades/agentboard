import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { registerHelloRoute } from './hello.js';
import { __resetHelloCache } from '../services/hello.js';

const FIXTURE_HTML = `<!doctype html>
<html><head><title>Hello — Test</title></head>
<body><main>Hello, test world.</main></body></html>
`;

let tmpDir: string;
let fixturePath: string;
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await registerHelloRoute(f);
  await f.ready();
  return f;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hello-route-'));
  fixturePath = path.join(tmpDir, 'hello.html');
  await fs.writeFile(fixturePath, FIXTURE_HTML, 'utf-8');
  process.env.HELLO_HTML_PATH = fixturePath;
});

afterAll(async () => {
  delete process.env.HELLO_HTML_PATH;
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(async () => {
  __resetHelloCache();
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('GET /hello', () => {
  it('returns 200 with text/html and the page body (happy path)', async () => {
    const res = await app.inject({ method: 'GET', url: '/hello' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html; charset=utf-8/);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.body).toContain('<title>Hello — Test</title>');
    expect(res.body).toContain('Hello, test world.');
  });

  it('serves identical bytes on repeat requests (cache works)', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/hello' });
    const r2 = await app.inject({ method: 'GET', url: '/hello' });

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r2.body).toBe(r1.body);
  });

  it('continues to serve the cached page even if the file is later removed', async () => {
    // Prime cache
    const r1 = await app.inject({ method: 'GET', url: '/hello' });
    expect(r1.statusCode).toBe(200);

    // Delete the underlying file — cache should make the next request fine.
    await fs.rm(fixturePath, { force: true });

    const r2 = await app.inject({ method: 'GET', url: '/hello' });
    expect(r2.statusCode).toBe(200);
    expect(r2.body).toBe(r1.body);

    // Restore file for other tests.
    await fs.writeFile(fixturePath, FIXTURE_HTML, 'utf-8');
  });

  it('returns 500 with a structured error when the file cannot be read', async () => {
    // Reset cache and point at a non-existent path before building app.
    __resetHelloCache();
    await app.close();
    const prev = process.env.HELLO_HTML_PATH;
    process.env.HELLO_HTML_PATH = path.join(tmpDir, 'does-not-exist.html');
    app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/hello' });

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = res.json();
    expect(body).toMatchObject({
      error: 'hello_unavailable',
      message: expect.any(String),
    });

    // Restore for any later tests.
    process.env.HELLO_HTML_PATH = prev;
    __resetHelloCache();
  });
});
