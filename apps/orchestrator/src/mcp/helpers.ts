import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agents, type AgentRow } from '../db/schema.js';

/**
 * Tool result shape required by the MCP SDK. We return `any` to avoid
 * fighting the SDK's nested union types — the runtime shape is always
 * `{ content: [{ type: 'text', text }], isError? }` which the SDK
 * validates at call time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ok(text: string): any {
  return { content: [{ type: 'text', text }] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function err(text: string): any {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Resolve an agent row by name (most common case for agent-authored calls),
 * falling back to ID if the string happens to be a UUID.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveAgentByNameOrId(value: string): Promise<AgentRow | null> {
  if (UUID_REGEX.test(value)) {
    const [row] = await db.select().from(agents).where(eq(agents.id, value)).limit(1);
    if (row) return row;
  }
  const [byName] = await db.select().from(agents).where(eq(agents.name, value)).limit(1);
  return byName ?? null;
}

export async function getAgentById(id: string): Promise<AgentRow | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return row ?? null;
}
