import { and, eq, gte, sum } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agents, usageEvents, type AgentRow } from '../db/schema.js';
import { logger } from '../logger.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_DAILY_CAP_MICRO_USD = Number(
  process.env.DEFAULT_DAILY_COST_CAP_MICRO_USD ?? 25_000_000, // $25/day default per agent
);
const DEFAULT_TOTAL_CAP_MICRO_USD = Number(
  process.env.DEFAULT_TOTAL_COST_CAP_MICRO_USD ?? 0, // 0 = unlimited
);

export interface BudgetCheck {
  allow: boolean;
  /** Reason in human-readable form when allow=false. */
  reason?: string;
  /** What the agent has spent today in micro-USD. */
  spentTodayMicroUsd: number;
  /** What the agent has spent total in micro-USD. */
  spentTotalMicroUsd: number;
  dailyCapMicroUsd: number;
  totalCapMicroUsd: number;
}

async function sumUsage(agentId: string, sinceMs?: number): Promise<number> {
  const conds = [eq(usageEvents.agentId, agentId)];
  if (sinceMs !== undefined) {
    conds.push(gte(usageEvents.endedAt, new Date(sinceMs)));
  }
  const [row] = await db
    .select({ total: sum(usageEvents.costMicroUsd).mapWith(Number) })
    .from(usageEvents)
    .where(and(...conds));
  return row?.total ?? 0;
}

/**
 * Returns whether the agent is allowed to spend more right now. Caps come
 * from (in priority order):
 *   1. agents.daily_cost_cap_micro_usd / total_cost_cap_micro_usd
 *   2. process env DEFAULT_*_COST_CAP_MICRO_USD
 * A `0` cap means "unlimited". A `null` cap means "use default".
 */
export async function checkBudget(agent: Pick<AgentRow, 'id' | 'dailyCostCapMicroUsd' | 'totalCostCapMicroUsd'>): Promise<BudgetCheck> {
  const dailyCap =
    agent.dailyCostCapMicroUsd ?? DEFAULT_DAILY_CAP_MICRO_USD;
  const totalCap =
    agent.totalCostCapMicroUsd ?? DEFAULT_TOTAL_CAP_MICRO_USD;

  const since = Date.now() - ONE_DAY_MS;
  const [spentToday, spentTotal] = await Promise.all([
    sumUsage(agent.id, since),
    sumUsage(agent.id),
  ]);

  if (dailyCap > 0 && spentToday >= dailyCap) {
    return {
      allow: false,
      reason: `Daily cost cap reached (spent $${(spentToday / 1e6).toFixed(2)} of $${(dailyCap / 1e6).toFixed(2)} today). Operator can raise the cap in Settings.`,
      spentTodayMicroUsd: spentToday,
      spentTotalMicroUsd: spentTotal,
      dailyCapMicroUsd: dailyCap,
      totalCapMicroUsd: totalCap,
    };
  }
  if (totalCap > 0 && spentTotal >= totalCap) {
    return {
      allow: false,
      reason: `Lifetime cost cap reached ($${(spentTotal / 1e6).toFixed(2)} of $${(totalCap / 1e6).toFixed(2)}). Operator can raise it in Settings.`,
      spentTodayMicroUsd: spentToday,
      spentTotalMicroUsd: spentTotal,
      dailyCapMicroUsd: dailyCap,
      totalCapMicroUsd: totalCap,
    };
  }

  return {
    allow: true,
    spentTodayMicroUsd: spentToday,
    spentTotalMicroUsd: spentTotal,
    dailyCapMicroUsd: dailyCap,
    totalCapMicroUsd: totalCap,
  };
}

/**
 * Token-first usage summary, modelled after `claude /usage`. We track raw
 * tokens (input + output + cache) as the headline number because, when the
 * orchestrator is running on a Claude Code subscription, dollar amounts are
 * accounting-only — the real budget is the subscription's message cap.
 *
 * The `costMicroUsd` field is still computed and surfaced for operators on
 * a metered Anthropic API key.
 */
export interface UsageSummary {
  /** 'subscription' when running on Claude Code OAuth, 'api' when ANTHROPIC_API_KEY is set. */
  mode: 'subscription' | 'api';

  totals: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    costMicroUsd: number;
  };
  today: {
    turns: number;
    totalTokens: number;
    costMicroUsd: number;
  };
  week: {
    turns: number;
    totalTokens: number;
    costMicroUsd: number;
  };
  byAgent: Array<{
    agentId: string;
    agentName: string;
    turns: number;
    totalTokens: number;
    todayTokens: number;
    costMicroUsd: number;
  }>;
  byModel: Array<{
    model: string;
    turns: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costMicroUsd: number;
  }>;
  byDay: Array<{ day: string; tokens: number; costMicroUsd: number }>;
}

export async function spendSummary(): Promise<UsageSummary> {
  const mode: 'subscription' | 'api' = process.env.ANTHROPIC_API_KEY ? 'api' : 'subscription';
  const allEvents = await db.select().from(usageEvents);

  // In subscription mode, fall back to Claude Code's own session JSONL logs
  // when the orchestrator hasn't recorded any turns yet. That mirrors what
  // the user sees with `claude /usage` from the CLI.
  if (mode === 'subscription' && allEvents.length === 0) {
    try {
      const { claudeCodeUsageSummary } = await import('./claudeUsage.js');
      return await claudeCodeUsageSummary();
    } catch (err) {
      logger.warn({ err }, 'failed to read claude code usage logs, returning empty summary');
    }
  }

  const allAgents = await db.select().from(agents);
  const nameById = new Map(allAgents.map((a) => [a.id, a.name]));

  const now = Date.now();
  const dayMs = ONE_DAY_MS;
  const weekMs = 7 * dayMs;

  type Bucket = { tokens: number; cost: number; turns: number };
  const empty = (): Bucket => ({ tokens: 0, cost: 0, turns: 0 });

  const totals = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costMicroUsd: 0,
  };
  const today = empty();
  const week = empty();
  const byAgent = new Map<string, { turns: number; total: Bucket; today: Bucket }>();
  const byModel = new Map<string, { turns: number; input: number; output: number; cost: number }>();
  const byDay = new Map<string, { tokens: number; cost: number }>();

  for (const e of allEvents) {
    const tokens =
      e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheReadTokens;
    totals.turns += 1;
    totals.inputTokens += e.inputTokens;
    totals.outputTokens += e.outputTokens;
    totals.cacheCreationTokens += e.cacheCreationTokens;
    totals.cacheReadTokens += e.cacheReadTokens;
    totals.totalTokens += tokens;
    totals.costMicroUsd += e.costMicroUsd;

    const t = new Date(e.endedAt).getTime();
    if (now - t < dayMs) {
      today.turns += 1;
      today.tokens += tokens;
      today.cost += e.costMicroUsd;
    }
    if (now - t < weekMs) {
      week.turns += 1;
      week.tokens += tokens;
      week.cost += e.costMicroUsd;
    }

    if (e.agentId) {
      const cur = byAgent.get(e.agentId) ?? { turns: 0, total: empty(), today: empty() };
      cur.turns += 1;
      cur.total.tokens += tokens;
      cur.total.cost += e.costMicroUsd;
      if (now - t < dayMs) {
        cur.today.tokens += tokens;
        cur.today.cost += e.costMicroUsd;
      }
      byAgent.set(e.agentId, cur);
    }

    const m = byModel.get(e.model) ?? { turns: 0, input: 0, output: 0, cost: 0 };
    m.turns += 1;
    m.input += e.inputTokens;
    m.output += e.outputTokens;
    m.cost += e.costMicroUsd;
    byModel.set(e.model, m);

    const d = new Date(e.endedAt);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dCur = byDay.get(dayKey) ?? { tokens: 0, cost: 0 };
    dCur.tokens += tokens;
    dCur.cost += e.costMicroUsd;
    byDay.set(dayKey, dCur);
  }

  return {
    mode,
    totals,
    today: { turns: today.turns, totalTokens: today.tokens, costMicroUsd: today.cost },
    week: { turns: week.turns, totalTokens: week.tokens, costMicroUsd: week.cost },
    byAgent: [...byAgent.entries()]
      .map(([id, v]) => ({
        agentId: id,
        agentName: nameById.get(id) ?? '?',
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

export { logger as _logger };
