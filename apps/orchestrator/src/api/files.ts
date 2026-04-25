/**
 * Read-only filesystem browser for connected projects. Powers the
 * VSCode-style "Files" tab in /projects/:id — a tree on the left, a
 * syntax-highlighted reader on the right.
 *
 * Backed by the project's local clone path (recorded when the repo was
 * connected). Two endpoints:
 *
 *   GET /api/projects/:id/tree?path=<rel>
 *     -> [{ name, path, type, size?, ignored }]
 *
 *   GET /api/projects/:id/file?path=<rel>
 *     -> { path, size, encoding, content?, language, truncated }
 *
 * Path safety: every request is resolved against the clonePath with
 * `path.resolve` and rejected if the result escapes the clone root. We
 * also forbid absolute-looking inputs and reject the .git directory
 * outright (no value, lots of noise + secrets risk in hooks/config).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { db } from '../db/client.js';
import { projects } from '../db/schema.js';
import { logger } from '../logger.js';

const MAX_FILE_BYTES = 1_000_000; // 1 MB hard cap on what we ship to the browser
const MAX_TREE_ENTRIES = 2000; // huge folders (node_modules) get truncated

const HIDDEN_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.svelte-kit',
  'dist',
  'build',
  '.cache',
  '.parcel-cache',
  'coverage',
  '__pycache__',
]);

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'jsx', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.jsonc': 'json',
  '.md': 'markdown', '.mdx': 'markdown',
  '.html': 'markup', '.htm': 'markup', '.svg': 'markup', '.xml': 'markup',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.toml': 'toml', '.ini': 'ini',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.sql': 'sql',
  '.dockerfile': 'docker',
  '.env': 'bash',
};

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'docker';
  if (lower === 'makefile') return 'makefile';
  if (lower.startsWith('.env')) return 'bash';
  const ext = path.extname(lower);
  return LANG_BY_EXT[ext] ?? 'text';
}

function sanitizeRelative(input: string): string | null {
  // Empty or "/" both mean root.
  const cleaned = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (cleaned === '' || cleaned === '.') return '';
  // Reject anything that tries to escape after normalisation.
  const normalized = path.posix.normalize(cleaned);
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized === '..') return null;
  if (path.isAbsolute(normalized)) return null;
  return normalized;
}

function resolveSafe(rootAbs: string, rel: string): string | null {
  const candidate = path.resolve(rootAbs, rel);
  const rootResolved = path.resolve(rootAbs) + path.sep;
  if (candidate !== path.resolve(rootAbs) && !candidate.startsWith(rootResolved)) return null;
  return candidate;
}

async function isLikelyBinary(absPath: string, sampleSize = 4096): Promise<boolean> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(absPath, 'r');
    const buf = Buffer.alloc(sampleSize);
    const { bytesRead } = await fh.read(buf, 0, sampleSize, 0);
    for (let i = 0; i < bytesRead; i += 1) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fh) await fh.close();
  }
}

async function loadProject(reply: FastifyReply, id: string) {
  if (!z.string().uuid().safeParse(id).success) {
    reply.code(400).send({ error: 'invalid_id' });
    return null;
  }
  const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) {
    reply.code(404).send({ error: 'project_not_found' });
    return null;
  }
  if (!p.clonePath) {
    reply.code(409).send({ error: 'clone_missing' });
    return null;
  }
  try {
    const stat = await fs.stat(p.clonePath);
    if (!stat.isDirectory()) {
      reply.code(409).send({ error: 'clone_not_dir' });
      return null;
    }
  } catch {
    reply.code(409).send({ error: 'clone_missing_on_disk' });
    return null;
  }
  return p;
}

/**
 * Walk the project (skipping HIDDEN_DIRS) collecting up to `limit` file
 * paths whose name or path matches `query`. Used by the Cmd+P quick
 * file picker on the frontend.
 */
async function searchFiles(
  rootAbs: string,
  query: string,
  limit: number,
): Promise<Array<{ path: string; name: string; size: number; score: number }>> {
  const q = query.toLowerCase();
  const results: Array<{ path: string; name: string; size: number; score: number }> = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: rootAbs, rel: '' }];
  while (stack.length && results.length < limit * 4) {
    const { abs, rel } = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (HIDDEN_DIRS.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        stack.push({ abs: childAbs, rel: childRel });
      } else if (e.isFile()) {
        const haystack = childRel.toLowerCase();
        if (q && !haystack.includes(q)) continue;
        let size = 0;
        try {
          const st = await fs.stat(childAbs);
          size = st.size;
        } catch {
          /* skip */
        }
        // Score: filename match wins over path match; closer to the
        // start scores higher; shorter total path scores higher.
        const nameLower = e.name.toLowerCase();
        const nameIdx = nameLower.indexOf(q);
        const pathIdx = haystack.indexOf(q);
        const score =
          (nameIdx === 0 ? 1000 : nameIdx > -1 ? 500 - nameIdx : 0) -
          (pathIdx > -1 ? pathIdx : 0) -
          childRel.length;
        results.push({ path: childRel, name: e.name, size, score });
      }
    }
  }
  return results
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export async function registerFilesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/projects/:id/tree',
    async (req: FastifyRequest<{ Params: { id: string }; Querystring: { path?: string } }>, reply) => {
      const p = await loadProject(reply, req.params.id);
      if (!p) return;

      const rel = sanitizeRelative(req.query.path ?? '');
      if (rel === null) return reply.code(400).send({ error: 'invalid_path' });

      const abs = resolveSafe(p.clonePath!, rel);
      if (!abs) return reply.code(400).send({ error: 'path_escape' });

      try {
        const stat = await fs.stat(abs);
        if (!stat.isDirectory()) {
          return reply.code(400).send({ error: 'not_a_directory' });
        }
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const out: Array<{
          name: string;
          path: string;
          type: 'file' | 'dir';
          size?: number;
          ignored?: boolean;
        }> = [];
        for (const e of entries) {
          const ignored = HIDDEN_DIRS.has(e.name);
          const childRel = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            out.push({ name: e.name, path: childRel, type: 'dir', ignored });
          } else if (e.isFile()) {
            let size: number | undefined;
            try {
              const st = await fs.stat(path.join(abs, e.name));
              size = st.size;
            } catch {
              /* skip */
            }
            out.push({ name: e.name, path: childRel, type: 'file', size, ignored });
          }
          if (out.length >= MAX_TREE_ENTRIES) break;
        }
        // Folders first, then files; case-insensitive name sort.
        out.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        return {
          path: rel,
          truncated: entries.length > out.length,
          entries: out,
        };
      } catch (err) {
        logger.warn({ err, projectId: p.id, rel }, 'tree read failed');
        return reply.code(500).send({ error: 'tree_failed', detail: (err as Error).message });
      }
    },
  );

  app.get(
    '/api/projects/:id/files/search',
    async (
      req: FastifyRequest<{ Params: { id: string }; Querystring: { q?: string; limit?: string } }>,
      reply,
    ) => {
      const p = await loadProject(reply, req.params.id);
      if (!p) return;
      const q = (req.query.q ?? '').trim();
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 30)));
      try {
        const hits = await searchFiles(p.clonePath!, q, limit);
        return { query: q, results: hits };
      } catch (err) {
        logger.warn({ err, projectId: p.id }, 'file search failed');
        return reply.code(500).send({ error: 'search_failed', detail: (err as Error).message });
      }
    },
  );

  app.get(
    '/api/projects/:id/file',
    async (req: FastifyRequest<{ Params: { id: string }; Querystring: { path?: string } }>, reply) => {
      const p = await loadProject(reply, req.params.id);
      if (!p) return;

      const rel = sanitizeRelative(req.query.path ?? '');
      if (rel === null || rel === '') {
        return reply.code(400).send({ error: 'path_required' });
      }
      const abs = resolveSafe(p.clonePath!, rel);
      if (!abs) return reply.code(400).send({ error: 'path_escape' });

      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) return reply.code(400).send({ error: 'not_a_file' });
        if (stat.size > MAX_FILE_BYTES) {
          return {
            path: rel,
            size: stat.size,
            encoding: 'too-large' as const,
            language: detectLanguage(path.basename(abs)),
            truncated: true,
          };
        }
        const binary = await isLikelyBinary(abs);
        if (binary) {
          return {
            path: rel,
            size: stat.size,
            encoding: 'binary' as const,
            language: 'text',
            truncated: false,
          };
        }
        const buf = await fs.readFile(abs);
        return {
          path: rel,
          size: stat.size,
          encoding: 'utf8' as const,
          language: detectLanguage(path.basename(abs)),
          content: buf.toString('utf8'),
          truncated: false,
        };
      } catch (err) {
        logger.warn({ err, projectId: p.id, rel }, 'file read failed');
        return reply.code(500).send({ error: 'file_failed', detail: (err as Error).message });
      }
    },
  );
}
