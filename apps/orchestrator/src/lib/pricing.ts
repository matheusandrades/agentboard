/**
 * Static pricing for the Claude models the agents use, in USD per million
 * tokens. Numbers track Anthropic's published prices for the public API
 * tier — when a customer is using their own Claude Code subscription via
 * `gh`/OAuth, these are accounting-only (no real charge), but they still
 * give a budget signal to the operator.
 *
 * Update this table when a new model lands or pricing changes.
 */

interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Opus 4.7 — flagship
  'claude-opus-4-7': {
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    cacheWriteUsdPerMillion: 18.75,
    cacheReadUsdPerMillion: 1.5,
  },
  // Sonnet 4.6 — balanced
  'claude-sonnet-4-6': {
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheWriteUsdPerMillion: 3.75,
    cacheReadUsdPerMillion: 0.3,
  },
  // Haiku 4.5 — fast
  'claude-haiku-4-5': {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
    cacheWriteUsdPerMillion: 1.25,
    cacheReadUsdPerMillion: 0.1,
  },
};

const FALLBACK: ModelPrice = PRICES['claude-sonnet-4-6']!;

export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Compute the cost of a single turn in micro-USD (10⁶ × dollars). Storing
 * as int makes math + ranking cheap and avoids float drift.
 */
export function computeCostMicroUsd(model: string, usage: UsageBreakdown): number {
  const price = PRICES[model] ?? FALLBACK;
  const dollars =
    (usage.inputTokens * price.inputUsdPerMillion +
      usage.outputTokens * price.outputUsdPerMillion +
      usage.cacheCreationTokens * price.cacheWriteUsdPerMillion +
      usage.cacheReadTokens * price.cacheReadUsdPerMillion) /
    1_000_000;
  return Math.round(dollars * 1_000_000);
}

export const microUsdToDollars = (micro: number): number => micro / 1_000_000;
export const dollarsToMicroUsd = (dollars: number): number => Math.round(dollars * 1_000_000);

export function listModelsWithPricing(): Array<{ model: string; price: ModelPrice }> {
  return Object.entries(PRICES).map(([model, price]) => ({ model, price }));
}

/**
 * Parse a flexible usage payload from any of the SDK's `result` shapes.
 * The exact field names vary across versions — we look defensively.
 */
export function extractUsage(result: unknown): UsageBreakdown {
  const r = result as Record<string, unknown> | null;
  const u = (r?.usage ?? r) as Record<string, unknown> | null;
  return {
    inputTokens: numField(u, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'),
    outputTokens: numField(u, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'),
    cacheCreationTokens: numField(
      u,
      'cache_creation_input_tokens',
      'cacheCreationInputTokens',
      'cache_creation_tokens',
      'cacheCreationTokens',
    ),
    cacheReadTokens: numField(
      u,
      'cache_read_input_tokens',
      'cacheReadInputTokens',
      'cache_read_tokens',
      'cacheReadTokens',
    ),
  };
}

function numField(obj: Record<string, unknown> | null | undefined, ...names: string[]): number {
  if (!obj) return 0;
  for (const n of names) {
    const v = obj[n];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}
