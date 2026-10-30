import { spawn } from 'node:child_process';

export interface ClipboardApi {
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

interface Tool {
  cmd: string;
  args: string[];
  /** Encodes the text for stdin. */
  encode?: (text: string) => Buffer;
}

/** Runs a tool, optionally feeding stdin, and resolves with its stdout. Rejects on spawn failure / non-zero exit / timeout. */
function run(tool: Tool, input?: Buffer, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.cmd, tool.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const out: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${tool.cmd} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${tool.cmd} exited with ${code}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const PS = ['-NoProfile', '-NonInteractive', '-Command'];
const utf16 = (t: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]);

function candidates(): { write: Tool[]; read: Tool[] } {
  if (process.platform === 'win32') {
    return {
      // clip.exe understands UTF-16LE when the input starts with a BOM.
      write: [{ cmd: 'clip.exe', args: [], encode: utf16 }],
      read: [{ cmd: 'powershell.exe', args: [...PS, '[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false; Get-Clipboard -Raw'] }],
    };
  }
  if (process.platform === 'darwin') {
    return { write: [{ cmd: 'pbcopy', args: [] }], read: [{ cmd: 'pbpaste', args: [] }] };
  }
  const write: Tool[] = [];
  const read: Tool[] = [];
  if (process.env.WAYLAND_DISPLAY) {
    write.push({ cmd: 'wl-copy', args: [] });
    read.push({ cmd: 'wl-paste', args: ['--no-newline'] });
  }
  if (process.env.DISPLAY) {
    write.push({ cmd: 'xclip', args: ['-selection', 'clipboard', '-in'] }, { cmd: 'xsel', args: ['--clipboard', '--input'] });
    read.push({ cmd: 'xclip', args: ['-selection', 'clipboard', '-out'] }, { cmd: 'xsel', args: ['--clipboard', '--output'] });
  }
  if (process.env.WSL_DISTRO_NAME) {
    write.push({ cmd: 'clip.exe', args: [], encode: utf16 });
    read.push({ cmd: 'powershell.exe', args: [...PS, '[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false; Get-Clipboard -Raw'] });
  }
  return { write, read };
}

async function firstWorking<T>(tools: Tool[], attempt: (t: Tool) => Promise<T>): Promise<T> {
  let last: unknown = new Error('no clipboard tool available');
  for (const t of tools) {
    try {
      return await attempt(t);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/**
 * System clipboard through the platform's native tool, with an OSC 52 fallback for remote sessions
 * (SSH, containers) where none exists. Reads fall back to the last text this process copied.
 */
export function createClipboard(writeRaw: (data: string) => void): ClipboardApi {
  const tools = candidates();
  let last = '';
  return {
    async read() {
      try {
        const text = await firstWorking(tools.read, (t) => run(t));
        // Windows hands back CRLF text with a trailing line break that is not part of the content.
        if (process.platform !== 'win32' && !process.env.WSL_DISTRO_NAME) return text;
        return text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n$/, '');
      } catch {
        return last;
      }
    },
    async write(text) {
      last = text;
      try {
        await firstWorking(tools.write, (t) => run(t, (t.encode ?? ((x: string) => Buffer.from(x, 'utf8')))(text)));
      } catch {
        if (text.length <= 100_000) writeRaw(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
      }
    },
  };
}

export function memoryClipboard(initial = ''): ClipboardApi & { value: string } {
  const c = {
    value: initial,
    async read() {
      return c.value;
    },
    async write(text: string) {
      c.value = text;
    },
  };
  return c;
}
