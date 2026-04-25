import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

import { sendMessageTool } from './tools/send_message.js';
import { readInboxTool } from './tools/read_inbox.js';
import { createTaskTool } from './tools/create_task.js';
import { updateTaskTool } from './tools/update_task.js';
import { askAgentTool } from './tools/ask_agent.js';
import { requestReviewTool } from './tools/request_review.js';
import { commitCodeTool } from './tools/commit_code.js';
import { listAgentsTool } from './tools/list_agents.js';
import { launchPreviewTool, stopPreviewTool } from './tools/launch_preview.js';
import { requestApprovalTool } from './tools/request_approval.js';
import { openPrTool } from './tools/open_pr.js';
import { recordDecisionTool } from './tools/record_decision.js';

/**
 * Build the in-process MCP server for a given agent. Each agent gets a
 * fresh server so every tool closure captures the right agent id.
 */
export function buildMcpServer(agentId: string) {
  return createSdkMcpServer({
    name: 'agentboard',
    version: '0.1.0',
    tools: [
      sendMessageTool(agentId),
      readInboxTool(agentId),
      createTaskTool(agentId),
      updateTaskTool(agentId),
      askAgentTool(agentId),
      requestReviewTool(agentId),
      commitCodeTool(agentId),
      listAgentsTool(agentId),
      launchPreviewTool(agentId),
      stopPreviewTool(agentId),
      requestApprovalTool(agentId),
      openPrTool(agentId),
      recordDecisionTool(agentId),
    ],
  });
}

/**
 * The set of tools the agent is allowed to call, in SDK naming format.
 * Exposed so the runner can pass it to `query({ options: { allowedTools } })`.
 */
export const AGENT_ALLOWED_TOOLS = [
  'mcp__agentboard__send_message',
  'mcp__agentboard__read_inbox',
  'mcp__agentboard__create_task',
  'mcp__agentboard__update_task',
  'mcp__agentboard__ask_agent',
  'mcp__agentboard__request_review',
  'mcp__agentboard__commit_code',
  'mcp__agentboard__list_agents',
  'mcp__agentboard__launch_preview',
  'mcp__agentboard__stop_preview',
  'mcp__agentboard__request_approval',
  'mcp__agentboard__open_pr',
  'mcp__agentboard__record_decision',
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Grep',
  'Glob',
];
