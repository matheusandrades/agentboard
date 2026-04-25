import { create } from 'zustand';
import type {
  Agent,
  AgentMessage,
  Task,
  UIEvent,
  ActivityItem,
  Commit,
  Preview,
  Approval,
  Sprint,
} from './types';
import * as api from './api';
import { getWSClient } from './ws';

const MAX_ACTIVITY = 200;

export interface BoardState {
  agents: Agent[];
  tasks: Task[];
  messages: AgentMessage[];
  activity: ActivityItem[];
  commits: Commit[];
  previews: Preview[];
  approvals: Approval[];
  sprints: Sprint[];
  loaded: boolean;
  connectionError: string | null;
  wsStatus: 'connecting' | 'open' | 'closed';

  // actions
  loadAll(): Promise<void>;
  applyEvent(event: UIEvent): void;
  initSync(): () => void;
  setAgents(agents: Agent[]): void;
  setTasks(tasks: Task[]): void;
  setMessages(messages: AgentMessage[]): void;
  appendMessage(message: AgentMessage): void;
  setSprints(sprints: Sprint[]): void;
  setConnectionError(msg: string | null): void;
}

function upsertBy<T extends { id: string }>(list: T[], next: T): T[] {
  const idx = list.findIndex((x) => x.id === next.id);
  if (idx === -1) return [...list, next];
  const copy = list.slice();
  const prev = copy[idx];
  copy[idx] = prev ? { ...prev, ...next } : next;
  return copy;
}

export const useBoardStore = create<BoardState>((set, get) => ({
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

  setAgents: (agents) => set({ agents }),
  setTasks: (tasks) => set({ tasks }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setSprints: (sprints) => set({ sprints }),
  setConnectionError: (connectionError) => set({ connectionError }),

  async loadAll() {
    try {
      const [agents, tasks, messages, activity, sprints, commits, previews, approvals] =
        await Promise.all([
          api.listAgents(),
          api.listTasks(),
          api.listMessages(),
          api.listActivity(MAX_ACTIVITY),
          api.listSprints(),
          api.listCommits(),
          api.listPreviews(),
          api.listApprovals(),
        ]);
      set({
        agents,
        tasks,
        messages,
        activity,
        sprints,
        commits,
        previews,
        approvals,
        loaded: true,
        connectionError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load data';
      set({ connectionError: msg, loaded: true });
    }
  },

  applyEvent(event) {
    const state = get();
    switch (event.type) {
      case 'agent.status': {
        set({
          agents: state.agents.map((a) =>
            a.id === event.agentId ? { ...a, status: event.status } : a,
          ),
          activity: prependActivity(state.activity, {
            id: Date.now(),
            agentId: event.agentId,
            eventType: 'agent.status',
            payload: { status: event.status },
            createdAt: event.at,
          }),
        });
        break;
      }
      case 'task.updated': {
        const existing = state.tasks.find((t) => t.id === event.taskId);
        if (existing) {
          const next: Task = {
            ...existing,
            status: event.status,
            assigneeId: event.assigneeId,
            updatedAt: event.at,
          };
          set({ tasks: upsertBy(state.tasks, next) });
        } else {
          // We don't have the task yet — do a best-effort refetch later.
          void api
            .listTasks()
            .then((tasks) => set({ tasks }))
            .catch(() => undefined);
        }
        break;
      }
      case 'task.created': {
        // The event carries only minimal info; refetch to pick up the full row.
        void api
          .listTasks()
          .then((tasks) => set({ tasks }))
          .catch(() => undefined);
        break;
      }
      case 'message.sent': {
        // Pull the full message list in the background (cheap for MVP).
        void api
          .listMessages()
          .then((messages) => set({ messages }))
          .catch(() => undefined);
        set({
          activity: prependActivity(state.activity, {
            id: Date.now(),
            agentId: event.fromAgentId,
            eventType: 'message.sent',
            payload: {
              messageId: event.messageId,
              toAgentId: event.toAgentId,
              messageType: event.messageType,
              subject: event.subject,
            },
            createdAt: event.at,
          }),
        });
        break;
      }
      case 'commit.created': {
        const commit: Commit = {
          id: event.commitId,
          agentId: event.agentId,
          taskId: event.taskId,
          sha: event.sha,
          branch: event.branch ?? null,
          message: event.message,
          filesChanged: event.filesChanged ?? null,
          createdAt: event.at,
        };
        // Guard against duplicates if we also happened to refetch commits.
        const existsIdx = state.commits.findIndex((c) => c.id === commit.id);
        const nextCommits =
          existsIdx === -1
            ? [commit, ...state.commits].slice(0, 500)
            : state.commits.map((c) => (c.id === commit.id ? commit : c));
        set({
          commits: nextCommits,
          activity: prependActivity(state.activity, {
            id: Date.now(),
            agentId: event.agentId,
            eventType: 'commit.created',
            payload: { sha: event.sha, taskId: event.taskId, message: event.message },
            createdAt: event.at,
          }),
        });
        break;
      }
      case 'activity': {
        set({
          activity: prependActivity(state.activity, {
            id: Date.now(),
            agentId: event.agentId,
            eventType: 'tool_call',
            payload: { tool: event.tool },
            createdAt: event.at,
          }),
        });
        break;
      }
      case 'agent.thinking': {
        set({
          activity: prependActivity(state.activity, {
            id: Date.now(),
            agentId: event.agentId,
            eventType: 'agent.thinking',
            payload: { text: event.text },
            createdAt: event.at,
          }),
        });
        break;
      }
      case 'agent.tool_attempt': {
        set({
          activity: prependActivity(state.activity, {
            id: Date.now(),
            agentId: event.agentId,
            eventType: 'agent.tool_attempt',
            payload: { tool: event.tool, input: event.input },
            createdAt: event.at,
          }),
        });
        break;
      }
      case 'approval.requested':
      case 'approval.resolved': {
        // Simplest: refetch the approvals list when any approval changes.
        // Volume is tiny and this keeps reducer logic honest.
        void api
          .listApprovals()
          .then((approvals) => set({ approvals }))
          .catch(() => undefined);
        set({
          activity: prependActivity(state.activity, {
            id: Date.now(),
            agentId: event.agentId,
            eventType: event.type,
            payload:
              event.type === 'approval.requested'
                ? { approvalId: event.approvalId, title: event.title }
                : { approvalId: event.approvalId, status: event.status },
            createdAt: event.at,
          }),
        });
        break;
      }
      default: {
        // exhaustiveness check
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  },

  initSync() {
    const ws = getWSClient();
    void get().loadAll();

    const offEvent = ws.subscribe((event) => {
      get().applyEvent(event);
    });
    const offStatus = ws.onStatus((status) => {
      set({ wsStatus: status });
      if (status === 'closed') {
        set({ connectionError: 'WebSocket disconnected — retrying…' });
      } else if (status === 'open') {
        set({ connectionError: null });
      }
    });

    return () => {
      offEvent();
      offStatus();
    };
  },
}));

function prependActivity(list: ActivityItem[], item: ActivityItem): ActivityItem[] {
  const next = [item, ...list];
  if (next.length > MAX_ACTIVITY) next.length = MAX_ACTIVITY;
  return next;
}
