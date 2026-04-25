/**
 * Frontend runtime env accessors. Centralized so tests can monkey-patch easily.
 */
export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

export const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3001/ws';
