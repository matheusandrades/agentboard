import type { Message, MessageType } from '@/lib/types';
import { relativeTime } from '@/lib/time';

interface Props {
  message: Message;
}

const TYPE_STYLE: Record<MessageType, { pill: string; label: string }> = {
  assignment: { pill: 'pill pill-violet', label: 'Assignment' },
  question:   { pill: 'pill pill-warn',   label: 'Question' },
  answer:     { pill: 'pill pill-ok',     label: 'Answer' },
  review:     { pill: 'pill pill-violet', label: 'Review' },
  handoff:    { pill: 'pill pill-warn',   label: 'Handoff' },
  status:     { pill: 'pill',             label: 'Status' },
  broadcast:  { pill: 'pill',             label: 'Broadcast' },
};

export function MessageBubble({ message }: Props) {
  const style = TYPE_STYLE[message.type] ?? TYPE_STYLE.status;
  return (
    <article
      data-testid={`message-${message.id}`}
      data-type={message.type}
      className="glass-soft p-4"
    >
      <header className="flex items-center gap-3 text-xs">
        <span className={style.pill}>{style.label}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-fg-2">
          <span className="text-fg">{message.from}</span>
          <span className="text-fg-3">→</span>
          <span className="text-fg">{message.to === '*' ? 'everyone' : message.to}</span>
        </span>
        <time className="ml-auto text-fg-3" dateTime={message.createdAt}>
          {relativeTime(message.createdAt)}
        </time>
      </header>
      {message.subject ? (
        <h4 className="mt-3 text-[15px] font-medium tracking-tight text-fg">{message.subject}</h4>
      ) : null}
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">
        {message.content}
      </p>
    </article>
  );
}
