import { Box, Text, useApp, useWindowSize } from 'ink';
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import type { Session } from '../core/session.js';
import type { InputSource } from '../input/source.js';
import { renderFrame } from '../ui/frame.js';
import type { Run } from '../ui/screen.js';

function RunText({ run }: { run: Run }) {
  const st = run.style;
  return (
    <Text
      color={st.fg}
      backgroundColor={st.bg}
      bold={st.bold}
      dimColor={st.dim}
      italic={st.italic}
      underline={st.underline}
      inverse={st.inverse}
    >
      {run.text}
    </Text>
  );
}

export function App({ session, input }: { session: Session; input?: InputSource | undefined }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  useSyncExternalStore(session.subscribe, session.getVersion);

  useLayoutEffect(() => {
    session.setSize(columns, rows);
  }, [session, columns, rows]);

  useEffect(() => {
    if (!input) return;
    const handler = (ev: Parameters<Session['handleInput']>[0]) => session.handleInput(ev);
    input.on('event', handler);
    return () => void input.off('event', handler);
  }, [session, input]);

  const title = `${session.title}${session.dirty ? '*' : ''} - npdt`;
  useEffect(() => {
    if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${title}\x07`);
  }, [title]);

  useEffect(() => {
    if (session.exitRequested) exit();
  });

  const lines = renderFrame(session).rows();
  return (
    <Box flexDirection="column">
      {lines.map((runs, y) => (
        <Text key={y} wrap="truncate">
          {runs.map((r, i) => (
            <RunText key={i} run={r} />
          ))}
        </Text>
      ))}
    </Box>
  );
}
