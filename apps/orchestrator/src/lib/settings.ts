/**
 * Tiny accessor for the `app_settings` table. Use it for anything the
 * operator should edit from the UI rather than from `.env` — OAuth
 * client secrets, webhook secrets, default branch policy, etc.
 *
 * Each key maps to a JSON object; we type-cast on read.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

export interface GithubOauthSettings extends Record<string, unknown> {
  clientId: string;
  clientSecret: string;
  redirectUrl?: string; // optional override; defaults to env GITHUB_OAUTH_REDIRECT_URL
  webhookSecret?: string; // shared between OAuth + App for now
}

export interface GithubAppSettings extends Record<string, unknown> {
  appId: number;
  slug: string;
  name: string;
  clientId: string;
  clientSecret: string;
  privateKey: string; // PEM
  webhookSecret: string;
  htmlUrl: string;
}

export type SettingKey = 'github.oauth' | 'github.app';

/** Generic getter — returns undefined if the row is missing. */
export async function getSetting<T extends Record<string, unknown>>(
  key: SettingKey,
): Promise<T | undefined> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value as T | undefined;
}

/** Upsert a setting and bump updated_at / updated_by. */
export async function setSetting<T extends Record<string, unknown>>(
  key: SettingKey,
  value: T,
  updatedBy: string | null = null,
): Promise<void> {
  const [existing] = await db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  if (existing) {
    await db
      .update(appSettings)
      .set({ value, updatedAt: new Date(), updatedBy })
      .where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, value, updatedBy });
  }
}

export async function deleteSetting(key: SettingKey): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}
