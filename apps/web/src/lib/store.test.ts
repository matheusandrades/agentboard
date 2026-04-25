import { beforeEach, describe, expect, it } from 'vitest';
import { useBoardStore } from './store';
import type { Agent, Task, UIEvent } from './types';

const AGENT_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = '22222222-2222-2222-2222-222222222222';

function agent(status: Agent['status'] = 'idle'): Agent {
  return {
    id: AGENT_ID,
    name: 'alice-pm',
    role: 'pm',
    personaPath: 'agents/pm.md',
    sessionId: null,
    status,
    worktreePath: null,
    createdAt: new Date().toISOString(),
  };
}

function task(status: Task['status'] = 'todo'): Task {
  return {
    id: TASK_ID,
    sprintId: null,
    title: 'Do stuff',
    description: null,
    status,
    assigneeId: AGENT_ID,
    createdBy: null,
    priority: 3,
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('useBoardStore.applyEvent', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agents: [agent('idle')],
      tasks: [task('todo')],
      messages: [],
      activity: [],
      commits: [],
      sprints: [],
      loaded: true,
      connectionError: null,
      wsStatus: 'open',
    });
  });

  it('updates agent status on agent.status', () => {
    const event: UIEvent = {
      type: 'agent.status',
      agentId: AGENT_ID,
      status: 'working',
      at: new Date().toISOString(),
    };
    useBoardStore.getState().applyEvent(event);
    expect(useBoardStore.getState().agents[0]!.status).toBe('working');
    expect(useBoardStore.getState().activity[0]!.eventType).toBe('agent.status');
  });

  it('moves a task on task.updated', () => {
    const event: UIEvent = {
      type: 'task.updated',
      taskId: TASK_ID,
      status: 'in_progress',
      assigneeId: AGENT_ID,
      at: new Date().toISOString(),
    };
    useBoardStore.getState().applyEvent(event);
    expect(useBoardStore.getState().tasks[0]!.status).toBe('in_progress');
  });

  it('prepends a commit and activity entry on commit.created', () => {
    const event: UIEvent = {
      type: 'commit.created',
      commitId: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
      agentId: AGENT_ID,
      taskId: TASK_ID,
      sha: 'abcdef1234567890',
      branch: 'agent/lucas-frontend',
      filesChanged: 2,
      message: 'feat: login',
      at: new Date().toISOString(),
    };
    useBoardStore.getState().applyEvent(event);
    const state = useBoardStore.getState();
    expect(state.commits[0]!.sha).toBe('abcdef1234567890');
    expect(state.activity[0]!.eventType).toBe('commit.created');
  });

  it('records tool calls on activity events', () => {
    const event: UIEvent = {
      type: 'activity',
      agentId: AGENT_ID,
      tool: 'Write',
      at: new Date().toISOString(),
    };
    useBoardStore.getState().applyEvent(event);
    const state = useBoardStore.getState();
    expect(state.activity[0]!.eventType).toBe('tool_call');
    expect(state.activity[0]!.payload).toMatchObject({ tool: 'Write' });
  });

  it('caps activity to 200 entries', () => {
    for (let i = 0; i < 250; i++) {
      useBoardStore.getState().applyEvent({
        type: 'activity',
        agentId: AGENT_ID,
        tool: `tool-${i}`,
        at: new Date().toISOString(),
      });
    }
    expect(useBoardStore.getState().activity.length).toBe(200);
  });
});
