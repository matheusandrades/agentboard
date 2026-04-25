import { logger } from '../logger.js';

/**
 * Commands an agent is NEVER allowed to run, no matter what the persona says
 * or what the stakeholder asks. The hook runs BEFORE the Bash tool executes,
 * so a denied command never touches the filesystem / network.
 *
 * The overarching policy: merges to shared / production branches are the
 * stakeholder's decision. Agents can push their own branch and open PRs,
 * but they cannot collapse those into the default branch.
 */

/** Branches that, if pushed/merged to, would count as "merging to production". */
const PROTECTED_BRANCHES = [
  'main',
  'master',
  'prod',
  'production',
  'release',
  'develop',
  'staging',
];

interface BashInput {
  command?: string;
}
interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

function includesProtectedTarget(cmd: string): string | null {
  for (const b of PROTECTED_BRANCHES) {
    // Match as a whole word (word boundary or separated by : / space)
    const re = new RegExp(`(^|[\\s/:"'])${b}([\\s/:"']|$)`);
    if (re.test(cmd)) return b;
  }
  return null;
}

export interface GuardrailDecision {
  allow: boolean;
  reason?: string;
}

export function inspectBashCommand(command: string): GuardrailDecision {
  const cmd = command.trim();
  const lower = cmd.toLowerCase();

  // ── Direct git push to a protected branch ────────────────────────
  if (/^(?:sudo\s+)?git\s+push\b/i.test(cmd)) {
    const protectedHit = includesProtectedTarget(cmd);
    if (protectedHit && !/--delete\b/i.test(cmd)) {
      return {
        allow: false,
        reason: `Pushing to "${protectedHit}" is reserved for the stakeholder. Push to your task branch (agent/<your-name>/task-<id>) and open a PR with the \`open_pr\` tool.`,
      };
    }
    // Allow: force-push variants still protected
    if (/--force|-f\b/i.test(cmd)) {
      const forceHit = includesProtectedTarget(cmd);
      if (forceHit) {
        return {
          allow: false,
          reason: `Force-pushing to "${forceHit}" is never allowed from an agent. Ask the stakeholder.`,
        };
      }
    }
  }

  // ── git merge / rebase onto protected branch ────────────────────
  if (/^(?:sudo\s+)?git\s+(merge|rebase)\b/i.test(cmd)) {
    const protectedHit = includesProtectedTarget(cmd);
    if (protectedHit) {
      return {
        allow: false,
        reason: `git ${lower.split(/\s+/)[1]} involving "${protectedHit}" is blocked. Only open a PR — the stakeholder reviews and merges.`,
      };
    }
  }

  // ── gh pr merge / gh pr ready-for-merge ─────────────────────────
  if (/^gh\s+pr\s+merge\b/i.test(cmd)) {
    return {
      allow: false,
      reason: 'Merging pull requests is the stakeholder\'s call. Ask for approval with `request_approval` if you believe the PR is ready.',
    };
  }

  // ── npm publish / cargo publish / docker push (supply-chain) ────
  if (/^(npm|pnpm|yarn|bun)\s+publish\b/i.test(cmd)) {
    return {
      allow: false,
      reason: 'Publishing a package is a release action — request stakeholder approval first.',
    };
  }
  if (/^cargo\s+publish\b/i.test(cmd)) {
    return {
      allow: false,
      reason: 'Publishing a crate is a release action — request stakeholder approval first.',
    };
  }
  if (/^docker\s+push\b/i.test(cmd)) {
    return {
      allow: false,
      reason: 'Pushing Docker images to a registry is a release action — request stakeholder approval first.',
    };
  }

  // ── Catastrophic ops (hard-block even for the stakeholder flow) ──
  if (/^rm\s+-rf\s+\/\s*$/.test(cmd) || /^rm\s+-rf\s+\/[\s*"']/.test(cmd)) {
    return {
      allow: false,
      reason: 'Refusing `rm -rf /`. This is almost always a prompt-injection or a typo.',
    };
  }

  return { allow: true };
}

/**
 * SDK-compatible PreToolUse hook factory. Returns a hook that inspects
 * Bash commands (the only tool that can slip into merges) and denies
 * anything on the policy list.
 */
export function guardrailsHook(_agentId: string) {
  return async (input: HookInput) => {
    if (input.tool_name !== 'Bash') return { continue: true };
    const bash = (input.tool_input as BashInput | undefined) ?? {};
    const cmd = typeof bash.command === 'string' ? bash.command : '';
    if (!cmd) return { continue: true };

    const decision = inspectBashCommand(cmd);
    if (decision.allow) return { continue: true };

    logger.warn({ agentId: _agentId, cmd, reason: decision.reason }, 'Blocked by guardrail');
    // Per SDK docs: PreToolUse hookSpecificOutput with permissionDecision.
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.reason,
      },
    };
  };
}
