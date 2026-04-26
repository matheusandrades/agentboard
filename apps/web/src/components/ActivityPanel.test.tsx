import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ActivityItem as ActivityItemType, Agent } from '@/lib/types';
import { ActivityPanel } from './ActivityPanel';
import { useBoardStore } from '@/lib/store';
import * as api from '@/lib/api';

const sampleAgent: Agent = {
  id: 'agent-1',
  name: 'lucas-frontend',
  role: 'frontend',
  personaPath: 'agents/frontend.md',
  sessionId: null,
  status: 'working',
  worktreePath: null,
  createdAt: new Date().toISOString(),
};

function activityFixtures(): ActivityItemType[] {
  const now = Date.now();
  return [
    {
      id: 1,
      agentId: 'agent-1',
      eventType: 'task.updated',
      payload: { status: 'in_progress' },
      createdAt: new Date(now - 30_000).toISOString(),
    },
    {
      id: 2,
      agentId: 'agent-1',
      eventType: 'message.sent',
      payload: { subject: 'Quick ETA check', messageType: 'status', toAgentId: 'agent-2' },
      createdAt: new Date(now - 90_000).toISOString(),
    },
  ];
}

function resetStore(overrides: Partial<ReturnType<typeof useBoardStore.getState>> = {}) {
  useBoardStore.setState({
    agents: [],
    tasks: [],
    messages: [],
    activity: [],
    commits: [],
    previews: [],
    approvals: [],
    sprints: [],
    loaded: false,
    connectionError: null,
    wsStatus: 'connecting',
    ...overrides,
  });
}

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ActivityPanel pollMs={0} />
    </MemoryRouter>,
  );

describe('ActivityPanel', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listActivity').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the skeleton while initial data loads', () => {
    resetStore({ loaded: false });
    renderPanel();
    expect(screen.getByLabelText('Loading activity')).toBeInTheDocument();
  });

  it('shows the empty state when no events have been recorded', async () => {
    resetStore({ loaded: true });
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByText(/No activity yet — assign a task to wake an agent\./i),
      ).toBeInTheDocument(),
    );
  });

  it('renders activity items when the store has events', async () => {
    resetStore({ loaded: true, agents: [sampleAgent], activity: activityFixtures() });
    vi.spyOn(api, 'listActivity').mockResolvedValue(activityFixtures());
    renderPanel();
    await waitFor(() => {
      // Heading + a feed region
      expect(screen.getByRole('heading', { name: /activity/i })).toBeInTheDocument();
      expect(screen.getByRole('feed')).toBeInTheDocument();
    });
    // Two events — the message subject is exposed as text
    expect(screen.getByText(/Quick ETA check/i)).toBeInTheDocument();
  });
});
