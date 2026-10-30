import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as typeof import('node-pty');
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');

const root = path.resolve(import.meta.dirname, '../..');
let dir: string;

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, 'node_modules/tsup/dist/cli-default.js')], { cwd: root, stdio: 'ignore' });
  dir = await mkdtemp(path.join(os.tmpdir(), 'npdt-e2e-'));
}, 60_000);
afterAll(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {}));

class App {
  private term = new Terminal({ cols: 100, rows: 30, allowProposedApi: true });
  private proc;
  exited: Promise<number>;
  private done = false;

  constructor(args: string[]) {
    // NPDT_BIN=dist-sea/npdt(.exe) runs the same scenarios against the standalone executable.
    const bin = process.env.NPDT_BIN ? path.resolve(root, process.env.NPDT_BIN) : null;
    this.proc = pty.spawn(bin ?? process.execPath, bin ? args : [path.join(root, 'bin/npdt.js'), ...args], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: dir,
      env: { ...process.env, NPDT_HOME: path.join(dir, 'home') } as Record<string, string>,
    });
    this.proc.onData((d) => this.term.write(d));
    this.exited = new Promise((r) =>
      this.proc.onExit((e) => {
        this.done = true;
        r(e.exitCode);
      }),
    );
  }

  screen(): string {
    const lines: string[] = [];
    const buf = this.term.buffer.active;
    for (let y = 0; y < this.term.rows; y++) lines.push(buf.getLine(y)?.translateToString(true) ?? '');
    return lines.join('\n');
  }

  async waitFor(re: RegExp | string, ms = 8000): Promise<string> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = this.screen();
      if (typeof re === 'string' ? s.includes(re) : re.test(s)) return s;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`timeout waiting for ${re}\n--- screen ---\n${this.screen()}`);
  }

  send(data: string): void {
    this.proc.write(data);
  }

  kill(): void {
    if (this.done) return;
    try {
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }
}

test('open, edit, save and quit in a real pseudo-terminal', async () => {
  const file = path.join(dir, 'hello.txt');
  await writeFile(file, 'first line\n');
  const app = new App(['hello.txt']);
  try {
    const s = await app.waitFor('first line');
    expect(s).toContain('File(F)');
    expect(s).toContain('New Open Save Close | Cut Copy Paste | Undo Redo | Search Replace');
    expect(s).toContain('UTF-8');

    app.send('\x1b[1;5F'); // ctrl+end
    app.send('typed text');
    await app.waitFor('typed text');
    app.send('\x13'); // ctrl+s
    await app.waitFor('Saved hello.txt');
    app.send('\x11'); // ctrl+q
    expect(await Promise.race([app.exited, new Promise((r) => setTimeout(() => r(-1), 8000))])).toBe(0);
    expect(await readFile(file, 'utf8')).toMatch(/first line\r?\ntyped text/);
  } finally {
    app.kill();
  }
}, 40_000);

test('menu opens with F10 and mouse click on toolbar works', async () => {
  const app = new App([]);
  try {
    await app.waitFor('new 1');
    app.send('\x1b[21~'); // F10
    await app.waitFor('Open…');
    app.send('\x1b');
    await new Promise((r) => setTimeout(r, 200));
    expect(app.screen()).not.toContain('Open…');
    app.send('abc');
    await app.waitFor('abc');
    // click "Undo" on the toolbar row
    const row = app.screen().split('\n')[1]!;
    const x = row.indexOf('Undo') + 2;
    app.send(`\x1b[<0;${x};2M\x1b[<0;${x};2m`);
    await app.waitFor(/Length:0/);
    app.send('\x11');
    expect(await Promise.race([app.exited, new Promise((r) => setTimeout(() => r(-1), 8000))])).toBe(0);
  } finally {
    app.kill();
  }
}, 40_000);

test('npdt <missing file> does not create it until saved', async () => {
  const file = path.join(dir, 'later.txt');
  const app = new App(['later.txt']);
  try {
    await app.waitFor('later.txt');
    app.send('x');
    app.send('\x13');
    await app.waitFor('Saved later.txt');
    expect(await readFile(file, 'utf8')).toBe('x');
  } finally {
    app.kill();
  }
}, 30_000);

test('menus can be opened and used with the mouse', async () => {
  const app = new App([]);
  try {
    await app.waitFor('new 1');
    app.send('\x1b[<0;3;1M\x1b[<0;3;1m'); // click "File(F)"
    const s = await app.waitFor('Recent Files…');
    const y = s.split('\n').findIndex((r) => r.includes('Open…'));
    app.send(`\x1b[<0;6;${y + 1}M\x1b[<0;6;${y + 1}m`); // click "Open…"
    await app.waitFor('Open File');
    app.send('\x1b');
    await new Promise((r) => setTimeout(r, 300)); // a bare ESC glued to the next key would parse as Alt+key
    app.send('\x11');
    expect(await Promise.race([app.exited, new Promise((r) => setTimeout(() => r(-1), 8000))])).toBe(0);
  } finally {
    app.kill();
  }
}, 40_000);
