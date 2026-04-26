/**
 * Seed activity for the demo/preview build (VITE_DEMO=true).
 *
 * Used only when the launch_preview container runs without a backend so QA
 * + Uma can open /dashboard and see a populated, realistic feed. Covers
 * every event type ActivityItem renders. Timestamps are computed at module
 * load so "12s ago" feels live.
 */
import type { ActivityItem } from '@/lib/types';

const now = Date.now();
const at = (secondsAgo: number): string => new Date(now - secondsAgo * 1000).toISOString();

// Stable agent ids — match the seed agents the orchestrator boots with.
const A = {
  lucas: 'agent-lucas-frontend',
  bruno: 'agent-bruno-backend',
  uma: 'agent-uma-uiux',
  alice: 'agent-alice-pm',
  quin: 'agent-quin-qa',
  sage: 'agent-sage-cybersec',
  leo: 'agent-leo-langs',
  dani: 'agent-dani-dba',
};

export const DEMO_ACTIVITY: ActivityItem[] = [
  {
    id: 30,
    agentId: A.lucas,
    eventType: 'commit.created',
    payload: {
      sha: '8a4f1c0b2d3e5f6a',
      message: 'feat(dashboard): add ActivityPanel with skeleton + empty + 5s poll',
    },
    createdAt: at(8),
  },
  {
    id: 29,
    agentId: A.lucas,
    eventType: 'agent.tool_attempt',
    payload: { tool: 'mcp__agentboard__commit_code', input: { message: 'feat(dashboard): add ActivityPanel' } },
    createdAt: at(15),
  },
  {
    id: 28,
    agentId: A.lucas,
    eventType: 'agent.thinking',
    payload: {
      text: 'Skeleton needs a 200ms delay so fast fetches don’t flash. Empty state copy approved by leo. Let me wire the panel above the 3-col grid so it sits above the fold.',
    },
    createdAt: at(42),
  },
  {
    id: 27,
    agentId: A.uma,
    eventType: 'message.sent',
    payload: {
      subject: 'Activity panel — token check',
      messageType: 'review',
      toAgentId: A.lucas,
    },
    createdAt: at(60),
  },
  {
    id: 26,
    agentId: A.bruno,
    eventType: 'task.updated',
    payload: { status: 'review', title: 'POST /api/activity batches > 100' },
    createdAt: at(95),
  },
  {
    id: 25,
    agentId: A.bruno,
    eventType: 'agent.status',
    payload: { status: 'idle' },
    createdAt: at(120),
  },
  {
    id: 24,
    agentId: A.alice,
    eventType: 'task.created',
    payload: { title: 'Live activity feed on dashboard' },
    createdAt: at(180),
  },
  {
    id: 23,
    agentId: A.sage,
    eventType: 'approval.requested',
    payload: { title: 'Promote new GitHub OAuth scope to prod' },
    createdAt: at(220),
  },
  {
    id: 22,
    agentId: A.alice,
    eventType: 'approval.resolved',
    payload: { status: 'approved', title: 'Hero/footer breakpoint migration' },
    createdAt: at(260),
  },
  {
    id: 21,
    agentId: A.quin,
    eventType: 'message.sent',
    payload: {
      subject: 'Hero/footer @734 verified — passing on iPhone SE',
      messageType: 'handoff',
      toAgentId: A.lucas,
    },
    createdAt: at(330),
  },
  {
    id: 20,
    agentId: A.dani,
    eventType: 'tool_call',
    payload: { tool: 'mcp__agentboard__commit_code', input: { message: 'chore(db): index activity_log(created_at desc)' } },
    createdAt: at(420),
  },
  {
    id: 19,
    agentId: A.lucas,
    eventType: 'agent.status',
    payload: { status: 'working' },
    createdAt: at(540),
  },
  {
    id: 18,
    agentId: A.leo,
    eventType: 'message.sent',
    payload: {
      subject: 'Empty-state copy — sign-off batch 3',
      messageType: 'answer',
      toAgentId: A.lucas,
    },
    createdAt: at(640),
  },
  {
    id: 17,
    agentId: A.uma,
    eventType: 'commit.created',
    payload: {
      sha: 'c1d2e3f4a5b6c7d8',
      message: 'design(tokens): two-tone status pills with color-mix',
    },
    createdAt: at(780),
  },
  {
    id: 16,
    agentId: A.quin,
    eventType: 'session_stop',
    payload: {},
    createdAt: at(900),
  },
];
