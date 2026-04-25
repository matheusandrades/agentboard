import { describe, expect, it } from 'vitest';
import { AgentMessageSchema, MessageTypeSchema, NewMessageSchema } from './messages';

describe('MessageTypeSchema', () => {
  it('accepts all valid types', () => {
    const types = ['assignment', 'question', 'answer', 'handoff', 'status', 'review', 'broadcast'];
    for (const t of types) expect(() => MessageTypeSchema.parse(t)).not.toThrow();
  });

  it('rejects unknown types', () => {
    expect(() => MessageTypeSchema.parse('random')).toThrow();
  });
});

describe('AgentMessageSchema', () => {
  const base = {
    id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
    from: 'alice-pm',
    to: 'lucas-frontend',
    type: 'assignment' as const,
    subject: 'Implement login form',
    content: 'Please build the login UI according to the mockups',
    createdAt: new Date().toISOString(),
  };

  it('parses a minimal valid message', () => {
    expect(() => AgentMessageSchema.parse(base)).not.toThrow();
  });

  it('accepts broadcast recipient', () => {
    expect(() => AgentMessageSchema.parse({ ...base, to: '*' })).not.toThrow();
  });

  it('rejects empty content', () => {
    expect(() => AgentMessageSchema.parse({ ...base, content: '' })).toThrow();
  });
});

describe('NewMessageSchema', () => {
  it('omits id and createdAt', () => {
    const { success } = NewMessageSchema.safeParse({
      from: 'alice-pm',
      to: 'quin-qa',
      type: 'review',
      subject: 'Review needed',
      content: 'Take a look please',
    });
    expect(success).toBe(true);
  });
});
