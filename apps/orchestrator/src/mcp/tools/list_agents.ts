import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { err, ok } from '../helpers.js';
import { logger } from '../../logger.js';

export function listAgentsTool(currentAgentId: string) {
  return tool(
    'list_agents',
    'List all known agents (name, role, status). Use this to discover teammates before addressing them.',
    // An empty schema — the SDK requires a zod record even if no args are expected.
    { _unused: z.string().optional() },
    async () => {
      try {
        const rows = await db.query.agents.findMany();
        const simplified = rows.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
          self: a.id === currentAgentId,
        }));
        return ok(JSON.stringify(simplified, null, 2));
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'list_agents tool failed');
        return err(`list_agents failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
