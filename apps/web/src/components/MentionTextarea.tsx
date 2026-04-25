/**
 * <MentionTextarea> — drop-in replacement for a plain `<textarea>` that
 * pops an autocomplete when the user types `@` (agents, by default
 * also tasks via `#` and commits via `[`). The popup is positioned
 * underneath the caret using a hidden mirror div, so it follows the
 * actual cursor — same trick GitHub / Linear / Slack use.
 *
 * The component stays controlled — the parent owns the value. We only
 * intercept keys when the popup is open (↑/↓/Enter/Esc) and rewrite the
 * fragment under the cursor when the user picks a candidate.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref'> & {
  /** Restrict the search by project id (filters tasks + commits). */
  projectId?: string;
  /**
   * Comma-separated mention kinds the popup should search for. Default
   * matches the underlying API ('agent,task,commit').
   */
  types?: string;
};

const TRIGGERS: Record<string, string> = {
  '@': 'agent',
  '#': 'task',
};

interface MatchInfo {
  /** Char that triggered the popup (`@`, `#`). */
  trigger: string;
  /** Index in the value where the trigger sits. */
  start: number;
  /** Substring after the trigger up to the caret. */
  query: string;
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { projectId, types, value, onChange, onKeyDown, className, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current!);

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [results, setResults] = useState<api.MentionCandidate[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const text = (value ?? '') as string;

  /* ---------- detect what's under the caret ---------- */
  function detectMatch(el: HTMLTextAreaElement): MatchInfo | null {
    const caret = el.selectionStart;
    const upto = text.slice(0, caret);
    // Find the latest trigger char in the current word (no spaces between
    // it and the caret).
    for (const t of Object.keys(TRIGGERS)) {
      const idx = upto.lastIndexOf(t);
      if (idx === -1) continue;
      const after = upto.slice(idx + 1);
      if (/\s/.test(after)) continue; // user typed a space, popup gone
      // Also skip if the trigger is preceded by a non-boundary
      // (avoid emails like "user@example.com" turning into mentions
      // when the user simply pastes one).
      const prev = idx > 0 ? text.charAt(idx - 1) : '';
      if (prev && !/[\s\n\r({\[]/.test(prev)) continue;
      return { trigger: t, start: idx, query: after };
    }
    return null;
  }

  /* ---------- search when match changes ---------- */
  useEffect(() => {
    if (!match) {
      setResults([]);
      return;
    }
    const kindForTrigger = TRIGGERS[match.trigger];
    const useTypes = types ?? kindForTrigger ?? 'agent,task,commit';
    let cancelled = false;
    api
      .searchMentions(match.query, { types: useTypes, projectId })
      .then((r) => {
        if (cancelled) return;
        // When triggered by `@`, prefer agents at the top.
        if (match.trigger === '@') r.sort((a, b) => (a.type === 'agent' ? -1 : 1));
        if (match.trigger === '#') r.sort((a, b) => (a.type === 'task' ? -1 : 1));
        setResults(r);
        setActiveIdx(0);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [match?.trigger, match?.query, projectId, types]);

  /* ---------- popup positioning via a hidden mirror ---------- */
  useEffect(() => {
    if (!match || !innerRef.current) {
      setPos(null);
      return;
    }
    const el = innerRef.current;
    const rect = el.getBoundingClientRect();
    const mirror = ensureMirror();
    const cs = window.getComputedStyle(el);
    [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'padding',
      'border',
      'boxSizing',
      'whiteSpace',
      'wordWrap',
      'overflowWrap',
      'tabSize',
      'textTransform',
    ].forEach((p) => {
      // copy by literal style key so TS stays happy
      (mirror.style as unknown as Record<string, string>)[p] = (
        cs as unknown as Record<string, string>
      )[p]!;
    });
    mirror.style.width = `${rect.width}px`;
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.top = '-99999px';
    mirror.style.left = '0';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordBreak = 'break-word';

    const before = text.slice(0, el.selectionStart);
    mirror.textContent = before;
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const top = rect.top + (markerRect.top - mirrorRect.top) - el.scrollTop + 22;
    const left = rect.left + (markerRect.left - mirrorRect.left) - el.scrollLeft;
    setPos({ top, left });
  }, [match, text]);

  /* ---------- input handlers ---------- */
  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange?.(e);
    const m = detectMatch(e.currentTarget);
    setMatch(m);
  }

  function pick(idx: number) {
    const c = results[idx];
    if (!c || !match || !innerRef.current) return;
    const el = innerRef.current;
    const before = text.slice(0, match.start);
    const after = text.slice(el.selectionStart);
    const inserted = `${c.token} `;
    const next = `${before}${inserted}${after}`;
    // Build a synthetic event so the parent's `onChange` runs uniformly.
    const fakeEvent = {
      ...({} as React.ChangeEvent<HTMLTextAreaElement>),
      target: { value: next } as HTMLTextAreaElement,
      currentTarget: { value: next } as HTMLTextAreaElement,
    };
    onChange?.(fakeEvent as React.ChangeEvent<HTMLTextAreaElement>);
    setMatch(null);
    requestAnimationFrame(() => {
      el.focus();
      const caret = before.length + inserted.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (match && results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % results.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        pick(activeIdx);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMatch(null);
        return;
      }
    }
    onKeyDown?.(e);
  }

  function onSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    setMatch(detectMatch(e.currentTarget));
  }

  const popup = useMemo(() => {
    if (!match || !pos || results.length === 0) return null;
    return (
      <div
        role="listbox"
        style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 90 }}
        className="w-72 max-h-72 overflow-auto rounded-xl border border-hairline bg-canvas-raised shadow-2xl"
      >
        {results.map((r, i) => (
          <button
            key={`${r.type}:${r.refId ?? r.token}`}
            type="button"
            role="option"
            aria-selected={i === activeIdx}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseDown={(e) => {
              // Keep textarea focus for the picker click.
              e.preventDefault();
              pick(i);
            }}
            className={[
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition',
              i === activeIdx ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-sheen/[0.05]',
            ].join(' ')}
          >
            <span
              className={[
                'rounded px-1 font-mono text-[10px] tnum',
                r.type === 'agent'
                  ? 'bg-accent/20 text-accent'
                  : r.type === 'task'
                    ? 'bg-ok/15 text-ok'
                    : 'bg-warn/15 text-warn',
              ].join(' ')}
            >
              {r.type}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{r.label}</span>
              {r.subtitle ? <span className="ml-1.5 text-fg-3">· {r.subtitle}</span> : null}
            </span>
            <span className="font-mono text-[10px] text-fg-3">{r.token}</span>
          </button>
        ))}
      </div>
    );
  }, [match, pos, results, activeIdx]);

  return (
    <>
      <textarea
        {...rest}
        ref={innerRef}
        value={text}
        onChange={onInputChange}
        onKeyDown={onKey}
        onSelect={onSelect}
        className={className}
      />
      {popup}
    </>
  );
});

let _mirror: HTMLDivElement | null = null;
function ensureMirror(): HTMLDivElement {
  if (_mirror && document.body.contains(_mirror)) return _mirror;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  _mirror = el;
  return el;
}
