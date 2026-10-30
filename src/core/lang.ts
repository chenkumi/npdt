import path from 'node:path';

export interface LangInfo {
  name: string;
  /** highlight.js language id, if any. */
  hljs?: string;
  /** Line comment prefix. */
  line?: string;
  /** Block comment delimiters. */
  block?: [string, string];
}

const C_LIKE = { line: '//', block: ['/*', '*/'] as [string, string] };

const BY_EXT: Record<string, LangInfo> = {
  js: { name: 'JavaScript', hljs: 'javascript', ...C_LIKE },
  mjs: { name: 'JavaScript', hljs: 'javascript', ...C_LIKE },
  cjs: { name: 'JavaScript', hljs: 'javascript', ...C_LIKE },
  jsx: { name: 'JavaScript', hljs: 'javascript', ...C_LIKE },
  ts: { name: 'TypeScript', hljs: 'typescript', ...C_LIKE },
  tsx: { name: 'TypeScript', hljs: 'typescript', ...C_LIKE },
  mts: { name: 'TypeScript', hljs: 'typescript', ...C_LIKE },
  cts: { name: 'TypeScript', hljs: 'typescript', ...C_LIKE },
  json: { name: 'JSON', hljs: 'json' },
  jsonc: { name: 'JSON', hljs: 'json', ...C_LIKE },
  md: { name: 'Markdown', hljs: 'markdown', block: ['<!--', '-->'] },
  markdown: { name: 'Markdown', hljs: 'markdown', block: ['<!--', '-->'] },
  py: { name: 'Python', hljs: 'python', line: '#' },
  c: { name: 'C', hljs: 'c', ...C_LIKE },
  h: { name: 'C', hljs: 'c', ...C_LIKE },
  cpp: { name: 'C++', hljs: 'cpp', ...C_LIKE },
  cc: { name: 'C++', hljs: 'cpp', ...C_LIKE },
  cxx: { name: 'C++', hljs: 'cpp', ...C_LIKE },
  hpp: { name: 'C++', hljs: 'cpp', ...C_LIKE },
  cs: { name: 'C#', hljs: 'csharp', ...C_LIKE },
  java: { name: 'Java', hljs: 'java', ...C_LIKE },
  go: { name: 'Go', hljs: 'go', ...C_LIKE },
  rs: { name: 'Rust', hljs: 'rust', ...C_LIKE },
  swift: { name: 'Swift', hljs: 'swift', ...C_LIKE },
  kt: { name: 'Kotlin', hljs: 'kotlin', ...C_LIKE },
  php: { name: 'PHP', hljs: 'php', ...C_LIKE },
  rb: { name: 'Ruby', hljs: 'ruby', line: '#' },
  lua: { name: 'Lua', hljs: 'lua', line: '--', block: ['--[[', ']]'] },
  html: { name: 'HTML', hljs: 'xml', block: ['<!--', '-->'] },
  htm: { name: 'HTML', hljs: 'xml', block: ['<!--', '-->'] },
  xml: { name: 'XML', hljs: 'xml', block: ['<!--', '-->'] },
  svg: { name: 'XML', hljs: 'xml', block: ['<!--', '-->'] },
  css: { name: 'CSS', hljs: 'css', block: ['/*', '*/'] },
  scss: { name: 'SCSS', hljs: 'scss', ...C_LIKE },
  less: { name: 'Less', hljs: 'less', ...C_LIKE },
  yaml: { name: 'YAML', hljs: 'yaml', line: '#' },
  yml: { name: 'YAML', hljs: 'yaml', line: '#' },
  toml: { name: 'TOML', hljs: 'ini', line: '#' },
  ini: { name: 'INI', hljs: 'ini', line: ';' },
  conf: { name: 'Config', hljs: 'ini', line: '#' },
  cfg: { name: 'Config', hljs: 'ini', line: ';' },
  sh: { name: 'Shell', hljs: 'bash', line: '#' },
  bash: { name: 'Shell', hljs: 'bash', line: '#' },
  zsh: { name: 'Shell', hljs: 'bash', line: '#' },
  ps1: { name: 'PowerShell', hljs: 'powershell', line: '#', block: ['<#', '#>'] },
  bat: { name: 'Batch', hljs: 'dos', line: '::' },
  cmd: { name: 'Batch', hljs: 'dos', line: '::' },
  sql: { name: 'SQL', hljs: 'sql', line: '--', block: ['/*', '*/'] },
  diff: { name: 'Diff', hljs: 'diff' },
  patch: { name: 'Diff', hljs: 'diff' },
  txt: { name: 'Plain Text' },
  log: { name: 'Plain Text' },
};

const BY_NAME: Record<string, LangInfo> = {
  makefile: { name: 'Makefile', hljs: 'makefile', line: '#' },
  dockerfile: { name: 'Dockerfile', line: '#' },
};

const PLAIN: LangInfo = { name: 'Plain Text' };

/** Every distinct language, for manual selection. */
export const LANGUAGES: LangInfo[] = [
  ...new Map([...Object.values(BY_EXT), ...Object.values(BY_NAME)].map((l) => [l.name, l])).values(),
].sort((a, b) => a.name.localeCompare(b.name));

export function languageByName(name: string): LangInfo | undefined {
  return name === PLAIN.name ? PLAIN : LANGUAGES.find((l) => l.name === name);
}

export function languageFor(file: string | null): LangInfo {
  if (!file) return PLAIN;
  const base = path.basename(file).toLowerCase();
  const byName = BY_NAME[base];
  if (byName) return byName;
  const ext = path.extname(base).slice(1);
  return BY_EXT[ext] ?? PLAIN;
}
