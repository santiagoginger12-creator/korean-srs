// App-level settings beyond the M1 `Settings` (events.ts is frozen; D22 lets any key through
// validation and replay ignores what it doesn't understand). Replay folds these LWW like the rest.

import { coerceSetting, defaultSettings, type EventPayload, type SettingKey, type Settings } from './events.ts';

/**
 * Namespace for extension data kept in `settings.set` events (D22): LWW per key, no coercion,
 * exposed raw as `DerivedState.ext`. Writing `null` deletes a key.
 */
export const EXT_PREFIX = 'ext.';

export interface ExtraSettings {
  /** Variants-inbox entries the owner dismissed (review.answer event ids). Replay takes the union of every write (grow-only set), so dismissals from two devices merge. */
  'inbox.dismissed': string[];
  /** Speak the Korean answer after a correct production answer. */
  'tts.autoplay': boolean;
  /** speechSynthesis rate, 0.5–1.5. */
  'tts.rate': number;
  /** SpeechSynthesisVoice.voiceURI; '' = first Korean voice. */
  'tts.voiceURI': string;
  /** Daily grammar-lesson allowance on the separate grammar path (0–50). Counts against the one review budget. */
  'grammar.dailyLessons': number;
  /** Grammar paced on its own path (stages, lessons, allowance). false = the pre-split combined behaviour. */
  'grammar.separatePath': boolean;
  /** Hanja as lesson nodes (the old WaniKani-style radicals layer). Off by default (D63). */
  'hanja.lessons': boolean;
}
export type AppSettings = Settings & ExtraSettings;
export type AppSettingKey = keyof AppSettings;

export const EXTRA_SETTING_DEFAULTS: Readonly<ExtraSettings> = Object.freeze({
  'inbox.dismissed': [] as string[],
  'tts.autoplay': false,
  'tts.rate': 1,
  'tts.voiceURI': '',
  'grammar.dailyLessons': 3,
  'grammar.separatePath': true,
  'hanja.lessons': false,
});

export function defaultAppSettings(): AppSettings {
  return { ...defaultSettings(), ...EXTRA_SETTING_DEFAULTS, 'inbox.dismissed': [] };
}

/** Like `coerceSetting`, plus the extra keys. Returns undefined for unknown keys or invalid values. */
export function coerceAppSetting<K extends AppSettingKey>(key: K, value: unknown): AppSettings[K] | undefined;
export function coerceAppSetting(key: string, value: unknown): unknown;
export function coerceAppSetting(key: string, value: unknown): unknown {
  switch (key) {
    case 'inbox.dismissed':
      return Array.isArray(value) && value.every((x) => typeof x === 'string' && x.length > 0)
        ? [...new Set(value as string[])] : undefined;
    case 'tts.autoplay': return typeof value === 'boolean' ? value : undefined;
    case 'tts.rate': return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 1.5 ? value : undefined;
    case 'tts.voiceURI': return typeof value === 'string' && value.length <= 512 ? value : undefined;
    case 'grammar.dailyLessons': return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 50 ? value : undefined;
    case 'grammar.separatePath': return typeof value === 'boolean' ? value : undefined;
    case 'hanja.lessons': return typeof value === 'boolean' ? value : undefined;
    default: return coerceSetting(key as SettingKey, value);
  }
}

/** A typed `settings.set` payload for any app setting (the frozen event type only names M1 keys). */
export function settingPayload<K extends AppSettingKey>(key: K, value: AppSettings[K]): EventPayload {
  return { type: 'settings.set', key: key as SettingKey, value };
}

/** A `settings.set` payload for an `ext.` key (`null` deletes it). */
export function extPayload(key: string, value: unknown): EventPayload {
  if (!key.startsWith(EXT_PREFIX) || key.length <= EXT_PREFIX.length) throw new Error(`extPayload: "${key}" is not an ext. key`);
  return { type: 'settings.set', key: key as SettingKey, value };
}
