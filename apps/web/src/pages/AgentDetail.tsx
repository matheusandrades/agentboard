import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';
import { AgentAvatar } from '@/components/AgentAvatar';
import { MessageBubble } from '@/components/MessageBubble';
import { ActivityItem } from '@/components/ActivityItem';
import {
  AGENT_ROLES,
  DEFAULT_EFFORT,
  DEFAULT_MAX_TURNS,
  DEFAULT_MODEL,
  type AgentEffort,
  type AgentModel,
} from '@agentboard/shared';
import { STATUS_DOT, ROLE_TINT } from '@/lib/roles';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';

type Tab = 'persona' | 'rules' | 'settings' | 'conversation' | 'commits' | 'activity';

const MODEL_OPTIONS: { value: AgentModel; label: string; hint: string }[] = [
  { value: 'claude-opus-4-7',   label: 'Opus 4.7',   hint: 'Deepest reasoning · slowest · most expensive' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Balanced · default for most work' },
  { value: 'claude-haiku-4-5',  label: 'Haiku 4.5',  hint: 'Fastest · cheapest · short turns' },
];
const EFFORT_OPTIONS: { value: AgentEffort; label: string; hint: string }[] = [
  { value: 'off',    label: 'Off',    hint: 'No extended thinking' },
  { value: 'low',    label: 'Low',    hint: 'Minimal reasoning · fastest' },
  { value: 'medium', label: 'Medium', hint: 'Moderate reasoning' },
  { value: 'high',   label: 'High',   hint: 'Heavy reasoning' },
  { value: 'xhigh',  label: 'X-High', hint: 'Very heavy reasoning' },
  { value: 'max',    label: 'Max',    hint: 'Maximum effort · select models only' },
];

export function AgentDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const agents = useBoardStore((s) => s.agents);
  const messages = useBoardStore((s) => s.messages);
  const activity = useBoardStore((s) => s.activity);
  const commits = useBoardStore((s) => s.commits);
  const tasks = useBoardStore((s) => s.tasks);
  const setAgents = useBoardStore((s) => s.setAgents);

  const agent = agents.find((a) => a.id === id);
  const [tab, setTab] = useState<Tab>('persona');

  const [persona, setPersona] = useState('');
  const [personaLoaded, setPersonaLoaded] = useState(false);
  const [personaDirty, setPersonaDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);

  const [rules, setRules] = useState('');
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Per-agent runtime tuning
  const [model, setModel] = useState<AgentModel>(DEFAULT_MODEL);
  const [maxTurns, setMaxTurns] = useState<number>(DEFAULT_MAX_TURNS);
  const [effort, setEffort] = useState<AgentEffort>(DEFAULT_EFFORT);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (!agent) return;
    setEditName(agent.name);
    setModel((agent.model as AgentModel | null | undefined) ?? DEFAULT_MODEL);
    setMaxTurns(agent.maxTurns ?? DEFAULT_MAX_TURNS);
    setEffort((agent.extendedThinking as AgentEffort | null | undefined) ?? DEFAULT_EFFORT);
    setPersonaLoaded(false);
    setPersonaDirty(false);
    setPersona('');
    setRulesLoaded(false);
    setRulesDirty(false);
    setRules('');
    (async () => {
      try {
        const content = await api.getPersona(agent.id);
        setPersona(content);
      } catch (err) {
        setPersonaError(err instanceof Error ? err.message : 'Failed to load persona');
      } finally {
        setPersonaLoaded(true);
      }
    })();
    (async () => {
      try {
        const content = await api.getRules(agent.id);
        setRules(content);
      } catch (err) {
        setRulesError(err instanceof Error ? err.message : 'Failed to load rules');
      } finally {
        setRulesLoaded(true);
      }
    })();
  }, [agent?.id]);

  const settingsDirty =
    agent &&
    (((agent.model as AgentModel | null | undefined) ?? DEFAULT_MODEL) !== model ||
      (agent.maxTurns ?? DEFAULT_MAX_TURNS) !== maxTurns ||
      ((agent.extendedThinking as AgentEffort | null | undefined) ?? DEFAULT_EFFORT) !== effort);

  async function saveSettings() {
    if (!agent || savingSettings || !settingsDirty) return;
    setSavingSettings(true);
    try {
      const updated = await api.updateAgent(agent.id, { model, maxTurns, extendedThinking: effort });
      setAgents(agents.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSettings(false);
    }
  }

  const conversation = useMemo(() => {
    if (!agent) return [];
    return messages
      .filter((m) => m.from === agent.name || m.to === agent.name)
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages, agent]);

  const agentActivity = useMemo(
    () => (agent ? activity.filter((a) => a.agentId === agent.id) : []),
    [activity, agent],
  );

  const agentCommits = useMemo(
    () => (agent ? commits.filter((c) => c.agentId === agent.id) : []),
    [commits, agent],
  );

  const currentTask = useMemo(
    () =>
      agent
        ? tasks.find(
            (t) =>
              t.assigneeId === agent.id && (t.status === 'in_progress' || t.status === 'review'),
          )
        : undefined,
    [tasks, agent],
  );

  if (!agent) {
    return (
      <div className="p-8 text-sm text-fg-2">
        Agent not found.{' '}
        <Link to="/agents" className="text-violet hover:underline">
          Back to list
        </Link>
      </div>
    );
  }

  const title = AGENT_ROLES[agent.role]?.title ?? agent.role;
  const status = STATUS_DOT[agent.status];
  const tint = ROLE_TINT[agent.role];

  async function savePersona() {
    if (!agent || saving) return;
    setSaving(true);
    setPersonaError(null);
    try {
      const updated = await api.updatePersona(agent.id, persona);
      setAgents(agents.map((a) => (a.id === updated.id ? updated : a)));
      setPersonaDirty(false);
    } catch (err) {
      setPersonaError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function saveRules() {
    if (!agent || savingRules) return;
    setSavingRules(true);
    setRulesError(null);
    try {
      const updated = await api.updateRules(agent.id, rules);
      setAgents(agents.map((a) => (a.id === updated.id ? updated : a)));
      setRulesDirty(false);
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingRules(false);
    }
  }

  async function resetRulesToTemplate() {
    if (!agent) return;
    if (!confirm('Reset rules to the bundled template for this role? Your edits will be lost.')) return;
    setSavingRules(true);
    setRulesError(null);
    try {
      const updated = await api.resetRules(agent.id);
      setAgents(agents.map((a) => (a.id === updated.id ? updated : a)));
      const fresh = await api.getRules(agent.id);
      setRules(fresh);
      setRulesDirty(false);
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setSavingRules(false);
    }
  }

  async function rename() {
    if (!agent || renaming) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === agent.name) return;
    setRenaming(true);
    try {
      const updated = await api.updateAgent(agent.id, { name: trimmed });
      setAgents(agents.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Rename failed');
      setEditName(agent.name);
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    if (!agent || deleting) return;
    if (!confirm(`Delete "${agent.name}"? This removes the agent, its worktree, and any custom persona file.`)) return;
    setDeleting(true);
    try {
      await api.deleteAgent(agent.id);
      setAgents(agents.filter((a) => a.id !== agent.id));
      navigate('/agents');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Hero header */}
      <header className="relative bloom border-b border-hairline px-8 pt-10 pb-6">
        <Link to="/agents" className="eyebrow inline-flex items-center gap-1 hover:text-fg">
          ← Back to agents
        </Link>
        <div className="mt-4 flex items-start gap-6">
          <AgentAvatar agent={agent} size="xl" showStatus />
          <div className="min-w-0 flex-1">
            <span className={['eyebrow', tint ?? ''].join(' ')}>{title}</span>
            <input
              className="mt-1 w-full border-0 bg-transparent p-0 text-display-lg font-medium tracking-tight text-fg focus:ring-0"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditName(agent.name);
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-fg-2">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={[
                    'h-1.5 w-1.5 rounded-full',
                    status.color,
                    status.pulse ? 'animate-breath' : '',
                  ].join(' ')}
                />
                {status.label}
              </span>
              <span className="text-fg-3">·</span>
              <span className="font-mono text-fg-3">
                {agent.sessionId ? `session ${agent.sessionId.slice(0, 8)}…` : 'no session yet'}
              </span>
              {agent.worktreePath ? (
                <>
                  <span className="text-fg-3">·</span>
                  <span className="font-mono text-fg-3">{agent.worktreePath.replace(/^.*\/workspace\//, 'workspace/')}</span>
                </>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete agent'}
          </button>
        </div>

        {/* Tabs */}
        <nav className="mt-8 flex items-center gap-1">
          <TabButton active={tab === 'persona'} onClick={() => setTab('persona')}>
            Persona
          </TabButton>
          <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>
            Rules
          </TabButton>
          <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
            Settings
          </TabButton>
          <TabButton active={tab === 'conversation'} onClick={() => setTab('conversation')}>
            Conversations ({conversation.length})
          </TabButton>
          <TabButton active={tab === 'commits'} onClick={() => setTab('commits')}>
            Commits ({agentCommits.length})
          </TabButton>
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
            Activity ({agentActivity.length})
          </TabButton>
        </nav>
      </header>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'persona' ? (
          <div className="px-8 py-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-medium tracking-tight text-fg">System prompt</h3>
                <p className="mt-1 text-[12px] text-fg-2">
                  This is the full text injected as <code className="font-mono">systemPrompt</code> on every turn.
                  Editing it changes how the agent behaves immediately — the next dispatch will use the new version.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {personaDirty ? <span className="pill pill-warn">unsaved</span> : null}
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setPersona(persona); setPersonaDirty(false); }} disabled={!personaDirty}>
                  Revert
                </button>
                <button type="button" className="btn btn-sm" onClick={savePersona} disabled={!personaDirty || saving}>
                  {saving ? 'Saving…' : 'Save persona'}
                </button>
              </div>
            </div>
            {personaError ? (
              <div className="mb-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
                {personaError}
              </div>
            ) : null}
            <textarea
              className="textarea min-h-[520px]"
              value={persona}
              onChange={(e) => {
                setPersona(e.target.value);
                setPersonaDirty(true);
              }}
              disabled={!personaLoaded}
              placeholder={personaLoaded ? '' : 'Loading persona…'}
            />
            <p className="mt-3 text-[11px] text-fg-3 font-mono">
              File: {agent.personaPath}
            </p>
          </div>
        ) : null}

        {tab === 'rules' ? (
          <div className="px-8 py-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-[15px] font-medium tracking-tight text-fg">Operating rules</h3>
                <p className="mt-1 max-w-2xl text-[12px] text-fg-2">
                  Hard guardrails appended to the system prompt after the persona. Use this for
                  things that must always hold — coding standards, escalation paths, branch rules,
                  forbidden actions. Defaults are pre-loaded for the <code className="font-mono">{agent.role}</code>{' '}
                  role; edit freely or restore the template anytime.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {rulesDirty ? <span className="pill pill-warn">unsaved</span> : null}
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={resetRulesToTemplate}
                  disabled={savingRules}
                  title="Reset to the bundled template for this role"
                >
                  Reset to template
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={saveRules}
                  disabled={!rulesDirty || savingRules}
                >
                  {savingRules ? 'Saving…' : 'Save rules'}
                </button>
              </div>
            </div>
            {rulesError ? (
              <div className="mb-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
                {rulesError}
              </div>
            ) : null}
            <textarea
              className="textarea min-h-[520px]"
              value={rules}
              onChange={(e) => {
                setRules(e.target.value);
                setRulesDirty(true);
              }}
              disabled={!rulesLoaded}
              placeholder={rulesLoaded ? 'No rules yet — your agent will only follow the persona.' : 'Loading rules…'}
            />
            <p className="mt-3 text-[11px] text-fg-3">
              Tip — keep rules short and unambiguous. They override the persona when the two
              conflict, and they are sent on every turn (cached when possible).
            </p>
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="px-8 py-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-medium tracking-tight text-fg">Runtime settings</h3>
                <p className="mt-1 text-[12px] text-fg-2">
                  Controls which Claude model this agent uses and how hard it thinks. Takes effect on the next turn.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settingsDirty ? <span className="pill pill-warn">unsaved</span> : null}
                <button type="button" className="btn btn-sm" onClick={saveSettings} disabled={!settingsDirty || savingSettings}>
                  {savingSettings ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            </div>

            <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
              <div>
                <span className="eyebrow mb-2 block">Model</span>
                <div className="space-y-2">
                  {MODEL_OPTIONS.map((m) => (
                    <label
                      key={m.value}
                      className={[
                        'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                        model === m.value
                          ? 'border-violet/50 bg-violet-soft'
                          : 'border-hairline bg-sheen/[0.02] hover:border-hairline-strong',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="model"
                        className="mt-0.5 text-violet focus:ring-violet"
                        checked={model === m.value}
                        onChange={() => setModel(m.value)}
                      />
                      <div>
                        <div className="text-[13px] font-medium text-fg">{m.label}</div>
                        <div className="text-[11px] text-fg-2">{m.hint}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <span className="eyebrow mb-2 block">Extended thinking (effort)</span>
                <div className="space-y-2">
                  {EFFORT_OPTIONS.map((e) => (
                    <label
                      key={e.value}
                      className={[
                        'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                        effort === e.value
                          ? 'border-violet/50 bg-violet-soft'
                          : 'border-hairline bg-sheen/[0.02] hover:border-hairline-strong',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="effort"
                        className="mt-0.5 text-violet focus:ring-violet"
                        checked={effort === e.value}
                        onChange={() => setEffort(e.value)}
                      />
                      <div>
                        <div className="text-[13px] font-medium text-fg">{e.label}</div>
                        <div className="text-[11px] text-fg-2">{e.hint}</div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="mt-5">
                  <span className="eyebrow mb-2 block">
                    Max turns per invocation · <span className="tnum text-fg">{maxTurns}</span>
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(Number(e.target.value))}
                    className="w-full accent-violet"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-fg-3">
                    <span>5</span>
                    <span>50</span>
                    <span>100</span>
                  </div>
                  <p className="mt-2 text-[11px] text-fg-2">
                    Hard ceiling on how many back-and-forth turns the SDK can run before stopping. Higher = more autonomy, more cost.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'conversation' ? (
          <div className="space-y-3 px-8 py-6">
            {conversation.length === 0 ? (
              <p className="text-[13px] text-fg-3">No messages yet.</p>
            ) : (
              conversation.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            {currentTask ? (
              <aside className="glass-soft mt-6 p-4">
                <span className="eyebrow">Currently working on</span>
                <h4 className="mt-2 text-[15px] font-medium text-fg">{currentTask.title}</h4>
                {currentTask.description ? (
                  <p className="mt-1 text-[12.5px] text-fg-2">{currentTask.description}</p>
                ) : null}
                <p className="mt-2 text-[11px] text-fg-3">
                  status: {currentTask.status} · priority P{currentTask.priority}
                </p>
              </aside>
            ) : null}
          </div>
        ) : null}

        {tab === 'commits' ? (
          <ul className="divide-y divide-hairline">
            {agentCommits.length === 0 ? (
              <li className="px-8 py-6 text-[13px] text-fg-3">No commits yet.</li>
            ) : (
              agentCommits.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-8 py-3 hover:bg-sheen/[0.02]">
                  <Link to={`/commits?focus=${c.id}`} className="pill tnum font-mono">
                    {c.sha.slice(0, 7)}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{c.message}</span>
                  <span className="shrink-0 text-[11px] text-fg-3">{relativeTime(c.createdAt)}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}

        {tab === 'activity' ? (
          <ul>
            {agentActivity.length === 0 ? (
              <li className="px-8 py-6 text-[13px] text-fg-3">No activity yet.</li>
            ) : (
              agentActivity.map((a) => <ActivityItem key={a.id} item={a} agent={agent} />)
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-4 py-1.5 text-[12px] transition duration-200',
        active
          ? 'border-violet/50 bg-violet-soft text-fg shadow-glow-sm'
          : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
