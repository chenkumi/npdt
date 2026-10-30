import { promises as fs } from 'node:fs';
import { render } from 'ink';
import { App } from './app/App.js';
import { loadConfig, loadState } from './core/config/config.js';
import { ENCODINGS, type EncodingId } from './core/fs/encoding.js';
import { Session } from './core/session.js';
import { InputSource } from './input/source.js';
import { createClipboard } from './platform/clipboard.js';

declare const __VERSION__: string;
const pkg = { version: typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev' };

const HELP = `npdt ${pkg.version} - Notepad Terminal

Usage:
  npdt                       open an empty document
  npdt <file>                open <file>, or create it on first save
  npdt <file>:<line>[:<col>] open at a position

Options:
  --encoding <id>   force an encoding (${ENCODINGS.map((e) => e.id).join(', ')})
  --no-mouse        disable mouse support
  -v, --version     print version
  -h, --help        show this help

Press F10 or Alt+F/E/S/V/N for menus, Ctrl+Q to quit.`;

interface Args {
  file?: string;
  line?: number;
  col?: number;
  encoding?: EncodingId;
  noMouse: boolean;
}

async function parseArgs(argv: string[]): Promise<Args | number> {
  const args: Args = { noMouse: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      return 0;
    }
    if (a === '-v' || a === '--version') {
      console.log(pkg.version);
      return 0;
    }
    if (a === '--no-mouse') args.noMouse = true;
    else if (a === '--encoding') {
      const id = argv[++i];
      if (!ENCODINGS.some((e) => e.id === id)) {
        console.error(`npdt: unknown encoding "${id ?? ''}"`);
        return 2;
      }
      args.encoding = id as EncodingId;
    } else if (a.startsWith('-') && a !== '-') {
      console.error(`npdt: unknown option "${a}"\n\n${HELP}`);
      return 2;
    } else if (args.file === undefined) {
      const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(a);
      if (m && !(await fs.stat(a).then(() => true, () => false))) {
        args.file = m[1]!;
        args.line = Number(m[2]);
        if (m[3]) args.col = Number(m[3]);
      } else args.file = a;
    } else {
      console.error('npdt: only one file can be opened at a time');
      return 2;
    }
  }
  return args;
}

async function main(): Promise<number> {
  const parsed = await parseArgs(process.argv.slice(2));
  if (typeof parsed === 'number') return parsed;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('npdt requires an interactive terminal.');
    return 1;
  }

  const { config, warnings } = await loadConfig();
  if (parsed.noMouse) config.mouse = false;
  const { recent, views } = await loadState();
  const input = new InputSource({ mouse: config.mouse, kittyKeyboard: config.kittyKeyboard });
  let unmount = () => {};
  const session = new Session({
    config,
    warnings,
    recent,
    views,
    clipboard: createClipboard((data) => process.stdout.write(data)),
    onExit: () => unmount(),
  });
  session.size = { cols: process.stdout.columns, rows: process.stdout.rows };

  try {
    if (parsed.file) {
      await session.openPath(parsed.file, parsed.encoding);
      if (parsed.line) session.doc.moveTo({ line: parsed.line - 1, col: (parsed.col ?? 1) - 1 });
      session.ensureCursorVisible();
    } else {
      await session.offerRecovery(null);
    }
  } catch (e) {
    console.error(`npdt: ${(e as Error).message}`);
    return 1;
  }

  const restoreAndExit = (code: number) => () => {
    input.stop();
    process.exit(code);
  };
  process.on('SIGTERM', restoreAndExit(143));
  process.on('SIGHUP', restoreAndExit(129));
  process.on('uncaughtException', (err) => {
    input.stop();
    console.error(err);
    process.exit(1);
  });

  input.start();
  const app = render(<App session={session} input={input} />, {
    stdin: input.inkStdin as unknown as NodeJS.ReadStream,
    alternateScreen: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  unmount = () => app.unmount();
  await app.waitUntilExit();
  input.stop();
  return 0;
}

process.exitCode = await main();
process.exit();
