import fs from 'node:fs/promises';
import path from 'node:path';

import { paths } from '../config.js';
import { logger } from '../logger.js';

/**
 * Service for serving the static "Hello World" HTML page authored by the
 * frontend team. Loads the file lazily on first request, then keeps it in
 * memory for the lifetime of the process.
 *
 * Path resolution:
 *   1. HELLO_HTML_PATH env var (absolute), if set.
 *   2. Otherwise: <workspaceRoot>/lucas-frontend/hello.html
 *
 * The frontend artifact lives in the lucas-frontend workspace by team
 * convention. The env var escape hatch lets ops override without a code
 * change (e.g. for tests, or once the file moves to a stable location).
 */

const DEFAULT_RELATIVE_PATH = path.join('lucas-frontend', 'hello.html');

function resolveHelloHtmlPath(): string {
  const fromEnv = process.env.HELLO_HTML_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return path.join(paths.workspaceRoot, DEFAULT_RELATIVE_PATH);
}

let cached: { path: string; html: string } | null = null;

/**
 * Returns the Hello World HTML body. Throws if the file cannot be read.
 *
 * Caches in-memory after the first successful read so subsequent requests
 * are zero-IO. Callers can pass `{ refresh: true }` to bypass the cache.
 */
export async function getHelloHtml(opts: { refresh?: boolean } = {}): Promise<string> {
  if (cached && !opts.refresh) return cached.html;

  const filePath = resolveHelloHtmlPath();
  try {
    const html = await fs.readFile(filePath, 'utf-8');
    cached = { path: filePath, html };
    return html;
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to read hello.html');
    throw err;
  }
}

/** Test-only: drop the in-memory cache. */
export function __resetHelloCache(): void {
  cached = null;
}

/** Test/diagnostic: returns the resolved path without reading the file. */
export function getHelloHtmlPath(): string {
  return resolveHelloHtmlPath();
}
