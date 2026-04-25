import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  agents,
  tasks,
  messages,
  commits,
  sprints,
  activityLog,
  type AgentRow,
  type TaskRow,
  type MessageRow,
  type CommitRow,
  type ActivityRow,
  type SprintRow,
} from './schema.js';

describe('schema', () => {
  it('exposes all expected tables', () => {
    expect(agents).toBeDefined();
    expect(tasks).toBeDefined();
    expect(messages).toBeDefined();
    expect(commits).toBeDefined();
    expect(sprints).toBeDefined();
    expect(activityLog).toBeDefined();
  });

  it('types compile: AgentRow has expected shape', () => {
    expectTypeOf<AgentRow>().toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf<AgentRow>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<AgentRow>().toHaveProperty('sessionId').toEqualTypeOf<string | null>();
    expectTypeOf<AgentRow>().toHaveProperty('worktreePath').toEqualTypeOf<string | null>();
  });

  it('types compile: TaskRow nullable fields', () => {
    expectTypeOf<TaskRow>().toHaveProperty('assigneeId').toEqualTypeOf<string | null>();
    expectTypeOf<TaskRow>().toHaveProperty('sprintId').toEqualTypeOf<string | null>();
  });

  it('types compile: MessageRow has jsonb metadata', () => {
    expectTypeOf<MessageRow>().toHaveProperty('metadata');
  });

  it('types compile: other rows', () => {
    expectTypeOf<CommitRow>().toHaveProperty('sha').toEqualTypeOf<string>();
    expectTypeOf<SprintRow>().toHaveProperty('status').toEqualTypeOf<string>();
    expectTypeOf<ActivityRow>().toHaveProperty('eventType').toEqualTypeOf<string>();
  });
});
