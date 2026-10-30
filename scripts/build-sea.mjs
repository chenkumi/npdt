// Builds a standalone executable (no Node install needed) using Node's single executable applications.
// Requires Node >= 25.5 (ESM entry support + --build-sea). Output: dist-sea/npdt[.exe]
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const exe = process.platform === 'win32' ? 'npdt.exe' : 'npdt';

rmSync('dist-sea', { recursive: true, force: true });
mkdirSync('dist-sea', { recursive: true });

await build({
  entryPoints: ['src/cli.tsx'],
  outfile: 'dist-sea/npdt.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  jsx: 'automatic',
  minify: true,
  alias: { 'react-devtools-core': './scripts/empty-module.mjs' },
  define: { __VERSION__: JSON.stringify(pkg.version), 'process.env.DEV': '"false"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

writeFileSync(
  'dist-sea/sea-config.json',
  JSON.stringify({ main: 'dist-sea/npdt.mjs', mainFormat: 'module', output: `dist-sea/${exe}`, disableExperimentalSEAWarning: true }),
);
execFileSync(process.execPath, ['--build-sea', 'dist-sea/sea-config.json'], { stdio: 'inherit' });
console.log(`built dist-sea/${exe}`);
