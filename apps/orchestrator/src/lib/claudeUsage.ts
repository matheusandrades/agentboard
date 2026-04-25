/**
 * Reads Claude Code's local session JSONL files and aggregates token usage.
 *
 * The Claude Code CLI (the host the orchestrator runs through when using
 * subscription mode) writes one JSONL per session at:
 *
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *
 * Each `assistant` line carries `message.usage` with input/output/cache token
 * counts. We walk every project directory, sum tokens per day / model, and
 * surface the result in the same shape the orchestrator's own `usageEvents`
 * table uses — that lets the `/api/usage` endpoint behave like Claude Code's
 * own `/usage` command, even when the orchestrator hasn't run any SDK turns
 * yet.
 *
 * The scanner caches per-file by mtime so repeated calls are cheap.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../logger.js';
import { computeCostMicroUsd } from './pricing.js';
import type { UsageSummary } from './budget.js';

interface SessionTurn {
  ts: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Folder name under ~/.claude/projects/ — used as a coarse "agent" bucket. */
  project: string;
  /** Session id (stem of jsonl filename). */
  sessionId: string;
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  turns: SessionTurn[];
}

const CACHE = new Map<string, CachedFile>();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const PROJECTS_ROOT = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function decodeProject(folder: string): string {
  // Folder names are the cwd with `/` replaced by `-`, prefixed with `-`.
  // We just strip the leading dash and present the trailing segment.
  const cleaned = folder.replace(/^-/, '');
  const parts = cleaned.split('-');
  return parts[parts.length - 1] || folder;
}

async function readSessionFile(path: string, project: string, sessionId: string): Promise<SessionTurn[]> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return [];
  }
  const cached = CACHE.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.turns;
  }

  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    logger.warn({ err, path }, 'claude-usage: failed to read session file');
    return [];
  }

  const turns: SessionTurn[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const message = entry.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    const ts = Date.parse(String(entry.timestamp ?? ''));
    if (!Number.isFinite(ts)) continue;
    turns.push({
      ts,
      model: String(message?.model ?? 'unknown'),
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheCreationTokens: num(usage.cache_creation_input_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      project,
      sessionId,
    });
  }

  CACHE.set(path, { mtimeMs: st.mtimeMs, size: st.size, turns });
  return turns;
}

async function listJsonlFiles(): Promise<Array<{ path: string; project: string; sessionId: string }>> {
  let projectDirs: string[] = [];
  try {
    projectDirs = await readdir(PROJECTS_ROOT);
  } catch {
    return [];
  }
  const out: Array<{ path: string; project: string; sessionId: string }> = [];
  for (const folder of projectDirs) {
    const dir = join(PROJECTS_ROOT, folder);
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue;
      out.push({
        path: join(dir, file),
        project: decodeProject(folder),
        sessionId: file.replace(/\.jsonl$/, ''),
      });
    }
  }
  return out;
}

async function gatherTurns(): Promise<SessionTurn[]> {
  const files = await listJsonlFiles();
  const lists = await Promise.all(files.map((f) => readSessionFile(f.path, f.project, f.sessionId)));
  return lists.flat();
}

/**
 * Build a UsageSummary from Claude Code's local session JSONL files.
 * This is what the user sees with `claude /usage` inside Claude Code itself.
 */
export async function claudeCodeUsageSummary(): Promise<UsageSummary> {
  const turns = await gatherTurns();
  const now = Date.now();

  const totals = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costMicroUsd: 0,
  };
  type Bucket = { tokens: number; cost: number; turns: number };
  const empty = (): Bucket => ({ tokens: 0, cost: 0, turns: 0 });
  const today = empty();
  const week = empty();
  const byProject = new Map<string, { turns: number; total: Bucket; today: Bucket }>();
  const byModel = new Map<string, { turns: number; input: number; output: number; cost: number }>();
  const byDay = new Map<string, { tokens: number; cost: number }>();

  for (const t of turns) {
    const tokens = t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
    const cost = computeCostMicroUsd(t.model, {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cacheCreationTokens: t.cacheCreationTokens,
      cacheReadTokens: t.cacheReadTokens,
    });

    totals.turns += 1;
    totals.inputTokens += t.inputTokens;
    totals.outputTokens += t.outputTokens;
    totals.cacheCreationTokens += t.cacheCreationTokens;
    totals.cacheReadTokens += t.cacheReadTokens;
    totals.totalTokens += tokens;
    totals.costMicroUsd += cost;

    if (now - t.ts < ONE_DAY_MS) {
      today.turns += 1;
      today.tokens += tokens;
      today.cost += cost;
    }
    if (now - t.ts < 7 * ONE_DAY_MS) {
      week.turns += 1;
      week.tokens += tokens;
      week.cost += cost;
    }

    const projKey = t.project;
    const cur = byProject.get(projKey) ?? { turns: 0, total: empty(), today: empty() };
    cur.turns += 1;
    cur.total.tokens += tokens;
    cur.total.cost += cost;
    if (now - t.ts < ONE_DAY_MS) {
      cur.today.tokens += tokens;
      cur.today.cost += cost;
    }
    byProject.set(projKey, cur);

    const m = byModel.get(t.model) ?? { turns: 0, input: 0, output: 0, cost: 0 };
    m.turns += 1;
    m.input += t.inputTokens;
    m.output += t.outputTokens;
    m.cost += cost;
    byModel.set(t.model, m);

    const d = new Date(t.ts);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dCur = byDay.get(dayKey) ?? { tokens: 0, cost: 0 };
    dCur.tokens += tokens;
    dCur.cost += cost;
    byDay.set(dayKey, dCur);
  }

  return {
    mode: 'subscription',
    totals,
    today: { turns: today.turns, totalTokens: today.tokens, costMicroUsd: today.cost },
    week: { turns: week.turns, totalTokens: week.tokens, costMicroUsd: week.cost },
    byAgent: [...byProject.entries()]
      .map(([project, v]) => ({
        agentId: project,
        agentName: project,
        turns: v.turns,
        totalTokens: v.total.tokens,
        todayTokens: v.today.tokens,
        costMicroUsd: v.total.cost,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({
        model,
        turns: v.turns,
        inputTokens: v.input,
        outputTokens: v.output,
        totalTokens: v.input + v.output,
        costMicroUsd: v.cost,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: [...byDay.entries()]
      .map(([day, v]) => ({ day, tokens: v.tokens, costMicroUsd: v.cost }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
