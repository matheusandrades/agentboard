import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useBoardStore } from '@/lib/store';
import * as api from '@/lib/api';
import type { UsageSummary } from '@/lib/types';

const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};
const fmtUsd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

export function Usage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const agents = useBoardStore((s) => s.agents);

  async function load() {
    try {
      setData(await api.usage());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const peakDay = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, ...data.byDay.map((d) => d.tokens));
  }, [data]);

  const isSub = data?.mode === 'subscription';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Usage"
        title="How hard the team is working"
        subtitle={
          data ? (
            isSub ? (
              <span className="text-fg-2">
                Authenticated via <span className="text-fg">Claude Code subscription</span> — token
                counts shown; dollar amounts not tracked since billing is your subscription.
              </span>
            ) : (
              <span className="text-fg-2">
                Authenticated via <span className="text-fg">Anthropic API key</span> — costs are
                metered against console.anthropic.com pricing.
              </span>
            )
          ) : null
        }
        actions={
          <button type="button" className="btn-ghost btn-sm" onClick={load}>
            ↻ Refresh
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {loading || !data ? (
          <p className="text-[13px] text-fg-3">Loading…</p>
        ) : (
          <div className="space-y-6">
            {/* Headline cards */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="Today"
                value={fmtTokens(data.today.totalTokens)}
                hint={`${data.today.turns} turn${data.today.turns === 1 ? '' : 's'}${isSub ? '' : ` · ${fmtUsd(data.today.costMicroUsd)}`}`}
              />
              <Stat
                label="This week"
                value={fmtTokens(data.week.totalTokens)}
                hint={`${data.week.turns} turns${isSub ? '' : ` · ${fmtUsd(data.week.costMicroUsd)}`}`}
              />
              <Stat
                label="All time"
                value={fmtTokens(data.totals.totalTokens)}
                hint={`${data.totals.turns} turns${isSub ? '' : ` · ${fmtUsd(data.totals.costMicroUsd)}`}`}
              />
            </div>

            {/* Token breakdown */}
            <section>
              <h3 className="eyebrow mb-2">Token mix (all time)</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <SmallStat label="Input" value={fmtTokens(data.totals.inputTokens)} />
                <SmallStat label="Output" value={fmtTokens(data.totals.outputTokens)} />
                <SmallStat label="Cache write" value={fmtTokens(data.totals.cacheCreationTokens)} />
                <SmallStat label="Cache read" value={fmtTokens(data.totals.cacheReadTokens)} />
              </div>
            </section>

            {/* Daily sparkline */}
            <section>
              <h3 className="eyebrow mb-2">Daily trend (tokens)</h3>
              {data.byDay.length === 0 ? (
                <p className="text-[12px] text-fg-3">No usage yet.</p>
              ) : (
                <div className="rounded-xl border border-hairline bg-sheen/[0.02] p-4">
                  <div className="flex items-end gap-1 h-32">
                    {data.byDay.slice(-30).map((d) => {
                      const h = Math.max(2, (d.tokens / peakDay) * 120);
                      return (
                        <div
                          key={d.day}
                          className="group relative flex-1"
                          title={`${d.day} · ${fmtTokens(d.tokens)} tokens${isSub ? '' : ` · ${fmtUsd(d.costMicroUsd)}`}`}
                        >
                          <div
                            className="w-full rounded-sm bg-accent/60 transition group-hover:bg-accent"
                            style={{ height: `${h}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-fg-3 font-mono">
                    <span>{data.byDay[0]?.day ?? ''}</span>
                    <span>{data.byDay[data.byDay.length - 1]?.day ?? ''}</span>
                  </div>
                </div>
              )}
            </section>

            {/* By agent */}
            <section>
              <h3 className="eyebrow mb-2">By agent</h3>
              {data.byAgent.length === 0 ? (
                <p className="text-[12px] text-fg-3">No usage recorded yet.</p>
              ) : (
                <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
                  {data.byAgent.map((a) => {
                    const peakAgent = data.byAgent[0]!.totalTokens;
                    const widthPct = peakAgent ? (a.totalTokens / peakAgent) * 100 : 0;
                    const found = agents.find((x) => x.id === a.agentId);
                    return (
                      <li key={a.agentId} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Link
                            to={`/agents/${a.agentId}`}
                            className="min-w-0 flex-1 truncate text-[13px] text-fg hover:underline"
                          >
                            {a.agentName}
                          </Link>
                          {found?.model ? (
                            <span className="pill text-[10px]">{found.model}</span>
                          ) : null}
                          <span className="font-mono text-[11px] text-fg-3 tnum">
                            {a.turns}t
                          </span>
                          <span className="font-mono text-[12px] tnum text-fg">
                            {fmtTokens(a.totalTokens)}
                          </span>
                          {!isSub ? (
                            <span className="font-mono text-[10px] text-fg-3 tnum w-14 text-right">
                              {fmtUsd(a.costMicroUsd)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-sheen/[0.05]">
                          <div className="h-full bg-accent/70" style={{ width: `${widthPct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* By model */}
            <section>
              <h3 className="eyebrow mb-2">By model</h3>
              <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
                {data.byModel.map((m) => (
                  <li key={m.model} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2">
                    <span className="font-mono text-[12px] text-fg">{m.model}</span>
                    <span className="font-mono text-[11px] text-fg-3 tnum">{m.turns}t</span>
                    <span className="font-mono text-[12px] tnum text-fg-2">
                      <span className="text-fg-3">in</span> {fmtTokens(m.inputTokens)}
                    </span>
                    <span className="font-mono text-[12px] tnum text-fg-2">
                      <span className="text-fg-3">out</span> {fmtTokens(m.outputTokens)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-sheen/[0.02] p-5">
      <span className="eyebrow block">{label}</span>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[32px] tracking-tight tnum text-fg">{value}</span>
        <span className="text-[10px] text-fg-3">tokens</span>
      </div>
      {hint ? <p className="mt-1 text-[10px] text-fg-3 font-mono">{hint}</p> : null}
    </div>
  );
}
function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-sheen/[0.02] p-3">
      <span className="eyebrow block">{label}</span>
      <span className="mt-0.5 block font-mono text-[16px] tnum text-fg">{value}</span>
    </div>
  );
}
