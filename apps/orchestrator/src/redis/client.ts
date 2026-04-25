import Redis from 'ioredis';
import { env } from '../config.js';

/**
 * Two separate connections are required by ioredis once you subscribe:
 * a subscriber connection cannot issue normal commands. We also keep one
 * connection for pub/sub publishes to keep responsibilities clear.
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: null,
  enableAutoPipelining: true,
});

export const redisSubscriber = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: null,
});

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
}

export async function pingRedis(): Promise<boolean> {
  try {
    const res = await redis.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}
