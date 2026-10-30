import { en, type MsgKey, type Messages } from './locales/en.js';
import zhTW from './locales/zh-TW.js';
import zhCN from './locales/zh-CN.js';
import ja from './locales/ja.js';
import ko from './locales/ko.js';
import es from './locales/es.js';
import fr from './locales/fr.js';
import de from './locales/de.js';
import ptBR from './locales/pt-BR.js';
import ru from './locales/ru.js';

export type { MsgKey, Messages };

/** Language names are shown in their own language so users can always find theirs. */
export const LOCALES = [
  { id: 'en', name: 'English' },
  { id: 'zh-TW', name: '繁體中文' },
  { id: 'zh-CN', name: '简体中文' },
  { id: 'ja', name: '日本語' },
  { id: 'ko', name: '한국어' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'ru', name: 'Русский' },
] as const;

export type LocaleId = (typeof LOCALES)[number]['id'];
export const LOCALE_IDS = LOCALES.map((l) => l.id) as LocaleId[];
export const DEFAULT_LOCALE: LocaleId = 'en';

const TABLES: Record<LocaleId, Messages> = {
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  ja,
  ko,
  es,
  fr,
  de,
  'pt-BR': ptBR,
  ru,
};

let current: LocaleId = DEFAULT_LOCALE;

export function isLocaleId(v: unknown): v is LocaleId {
  return typeof v === 'string' && (LOCALE_IDS as string[]).includes(v);
}

export function getMessages(id: LocaleId): Messages {
  return TABLES[id];
}

/** Map a POSIX/BCP-47 style tag (`zh_TW.UTF-8`, `pt-PT`, `fr_CA`) to a supported locale. */
export function matchLocale(tag: string | undefined): LocaleId | undefined {
  if (!tag) return undefined;
  const norm = tag.replace(/[.@].*$/, '').replace(/_/g, '-').toLowerCase();
  if (!norm || norm === 'c' || norm === 'posix') return undefined;
  const [lang, region] = norm.split('-');
  if (lang === 'zh') {
    return region === 'cn' || region === 'sg' || norm.includes('hans') ? 'zh-CN' : 'zh-TW';
  }
  if (lang === 'pt') return 'pt-BR';
  return LOCALE_IDS.find((id) => id.toLowerCase() === lang);
}

export function detectSystemLocale(env: NodeJS.ProcessEnv = process.env): LocaleId {
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANGUAGE', 'LANG']) {
    const first = env[key]?.split(':')[0];
    const hit = matchLocale(first);
    if (hit) return hit;
  }
  try {
    const hit = matchLocale(Intl.DateTimeFormat().resolvedOptions().locale);
    if (hit) return hit;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

/** Resolve a config value (`auto` or a locale id) to a concrete locale. */
export function resolveLocale(setting: string | undefined): LocaleId {
  if (setting === 'auto') return detectSystemLocale();
  return isLocaleId(setting) ? setting : DEFAULT_LOCALE;
}

export function setLocale(setting: string | undefined): LocaleId {
  current = resolveLocale(setting);
  return current;
}

export function getLocale(): LocaleId {
  return current;
}

export type MsgParams = Record<string, string | number>;

export function format(template: string, params?: MsgParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function t(key: MsgKey, params?: MsgParams): string {
  return format(TABLES[current][key] ?? en[key], params);
}
