import { afterEach, expect, test } from 'vitest';
import { parseConfig } from '../src/core/config/config.js';
import {
  DEFAULT_LOCALE,
  LOCALES,
  detectSystemLocale,
  format,
  getMessages,
  matchLocale,
  setLocale,
  t,
  type LocaleId,
} from '../src/core/i18n.js';
import { en } from '../src/core/locales/en.js';

afterEach(() => setLocale('en'));

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const enKeys = Object.keys(en).sort();

test('at least 10 languages, English is the default', () => {
  expect(LOCALES.length).toBeGreaterThanOrEqual(10);
  expect(DEFAULT_LOCALE).toBe('en');
  expect(parseConfig({}).config.language).toBe('en');
});

test.each(LOCALES.map((l) => l.id))('%s defines exactly the English keys with the same placeholders', (id: LocaleId) => {
  const m = getMessages(id) as Record<string, string>;
  expect(Object.keys(m).sort()).toEqual(enKeys);
  for (const key of enKeys) {
    expect(typeof m[key]).toBe('string');
    expect(m[key]!.length, `${id}:${key} is empty`).toBeGreaterThan(0);
    expect(placeholders(m[key]!), `${id}:${key} placeholders`).toEqual(placeholders((en as Record<string, string>)[key]!));
  }
});

test('translations are not just copies of English (except shared words)', () => {
  const same = (id: LocaleId) => enKeys.filter((k) => (getMessages(id) as Record<string, string>)[k] === (en as Record<string, string>)[k]);
  for (const l of LOCALES) {
    if (l.id === 'en') continue;
    expect(same(l.id).length, `${l.id} leaves too many keys untranslated: ${same(l.id).join(', ')}`).toBeLessThan(enKeys.length / 5);
  }
});

test('t() interpolates and follows setLocale', () => {
  expect(t('msg.saved', { name: 'a.txt' })).toBe('Saved a.txt');
  setLocale('zh-TW');
  expect(t('msg.saved', { name: 'a.txt' })).toBe('已儲存 a.txt');
  setLocale('de');
  expect(t('menu.file')).toBe('Datei');
});

test('unknown placeholders are left intact', () => {
  expect(format('a {x} {y}', { x: 1 })).toBe('a 1 {y}');
});

test('setLocale falls back to English for invalid values', () => {
  expect(setLocale('xx')).toBe('en');
  expect(setLocale(undefined)).toBe('en');
});

test('system locale detection', () => {
  expect(matchLocale('zh_TW.UTF-8')).toBe('zh-TW');
  expect(matchLocale('zh_CN.UTF-8')).toBe('zh-CN');
  expect(matchLocale('zh-Hans')).toBe('zh-CN');
  expect(matchLocale('pt_PT')).toBe('pt-BR');
  expect(matchLocale('fr_CA.UTF-8')).toBe('fr');
  expect(matchLocale('ja-JP')).toBe('ja');
  expect(matchLocale('C')).toBeUndefined();
  expect(matchLocale('tlh')).toBeUndefined();
  expect(detectSystemLocale({ LANG: 'ko_KR.UTF-8' })).toBe('ko');
  expect(detectSystemLocale({ LC_ALL: 'es_ES.UTF-8', LANG: 'de_DE.UTF-8' })).toBe('es');
  expect(setLocale('auto')).toBe(detectSystemLocale());
});

test('config accepts language ids and the legacy "classic" theme', () => {
  expect(parseConfig({ language: 'ru' }).config.language).toBe('ru');
  expect(parseConfig({ language: 'auto' }).config.language).toBe('auto');
  const bad = parseConfig({ language: 'klingon' });
  expect(bad.config.language).toBe('en');
  expect(bad.warnings).toHaveLength(1);
  expect(parseConfig({ theme: 'classic' }).config.theme).toBe('light');
  expect(parseConfig({ theme: 'dark' }).config.theme).toBe('dark');
});
