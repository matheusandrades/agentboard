import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import type { Message, MessageType } from '@/lib/types';

function msg(type: MessageType): Message {
  return {
    id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
    from: 'alice-pm',
    to: 'lucas-frontend',
    type,
    subject: `Subject ${type}`,
    content: `Content for ${type}`,
    createdAt: new Date().toISOString(),
  };
}

const EXPECTED_LABEL: Record<MessageType, string> = {
  assignment: 'Assignment',
  question: 'Question',
  answer: 'Answer',
  review: 'Review',
  handoff: 'Handoff',
  status: 'Status',
  broadcast: 'Broadcast',
};

describe('<MessageBubble>', () => {
  it('renders from → to labels and subject', () => {
    render(<MessageBubble message={msg('assignment')} />);
    expect(screen.getByText('alice-pm')).toBeInTheDocument();
    expect(screen.getByText('lucas-frontend')).toBeInTheDocument();
    expect(screen.getByText('Subject assignment')).toBeInTheDocument();
    expect(screen.getByText('Content for assignment')).toBeInTheDocument();
  });

  it('uses "everyone" for broadcast', () => {
    const m = { ...msg('broadcast'), to: '*' as const };
    render(<MessageBubble message={m} />);
    expect(screen.getByText('everyone')).toBeInTheDocument();
  });

  it('tags each message with its type and shows the type label', () => {
    for (const type of Object.keys(EXPECTED_LABEL) as MessageType[]) {
      const { unmount } = render(<MessageBubble message={msg(type)} />);
      const article = screen.getByTestId(`message-${msg(type).id}`);
      expect(article.getAttribute('data-type')).toBe(type);
      expect(screen.getByText(EXPECTED_LABEL[type])).toBeInTheDocument();
      unmount();
    }
  });
});
