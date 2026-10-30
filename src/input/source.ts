import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { InputParser, type InputEvent } from './parser.js';

export interface InputOptions {
  mouse: boolean;
  kittyKeyboard: boolean;
}

const ENABLE_PASTE = '\x1b[?2004h';
const DISABLE_PASTE = '\x1b[?2004l';
// 1003 = report all motion (needed for hover effects); it also covers drag reporting.
const ENABLE_MOUSE = '\x1b[?1003h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1003l\x1b[?1002l';
// kitty keyboard protocol: push "disambiguate escape codes" so Ctrl+Shift+<key> becomes reportable.
const PUSH_KITTY = '\x1b[>1u';
const POP_KITTY = '\x1b[<u';

/**
 * Owns the terminal input side: raw mode, bracketed paste, mouse reporting and key parsing.
 * Ink only renders; it receives an inert stdin so it never competes for input bytes.
 */
export class InputSource extends EventEmitter<{ event: [InputEvent] }> {
  /** Stream handed to Ink: looks like a TTY but never produces data. */
  readonly inkStdin: Readable & { isTTY: boolean; setRawMode(mode: boolean): void; ref(): void; unref(): void };
  private readonly parser = new InputParser();
  private started = false;
  private wasRaw = false;
  private readonly onData = (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const ev of this.parser.feed(text)) this.emit('event', ev);
  };
  private readonly onExit = () => this.stop();

  constructor(
    private readonly opts: InputOptions,
    private readonly stdin: NodeJS.ReadStream = process.stdin,
    private readonly stdout: NodeJS.WriteStream = process.stdout,
  ) {
    super();
    const inert = new Readable({ read() {} }) as InputSource['inkStdin'];
    inert.isTTY = true;
    inert.setRawMode = () => {};
    inert.ref = () => {};
    inert.unref = () => {};
    this.inkStdin = inert;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.wasRaw = this.stdin.isRaw ?? false;
    this.stdin.setRawMode?.(true);
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', this.onData);
    this.stdin.resume();
    let seq = ENABLE_PASTE;
    if (this.opts.mouse) seq += ENABLE_MOUSE;
    if (this.opts.kittyKeyboard) seq += PUSH_KITTY;
    this.stdout.write(seq);
    process.on('exit', this.onExit);
  }

  /** Restores every terminal mode we changed. Safe to call more than once. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    process.off('exit', this.onExit);
    this.stdin.off('data', this.onData);
    let seq = DISABLE_PASTE;
    if (this.opts.mouse) seq += DISABLE_MOUSE;
    if (this.opts.kittyKeyboard) seq += POP_KITTY;
    try {
      this.stdout.write(seq);
      this.stdin.setRawMode?.(this.wasRaw);
    } catch {
      /* terminal already gone */
    }
    this.stdin.pause();
  }
}
