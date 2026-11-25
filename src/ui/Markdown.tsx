import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

const INLINE = /(\*\*(?:[^*\n]|\*(?!\*))+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/;
const FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s+/;
const BULLET = /^(\s*)[-*]\s+/;

function inline(line: string): ReactNode[] {
  return line.split(INLINE).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <Text key={index} bold>{inline(part.slice(2, -2))}</Text>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <Text key={index} color="cyan">{part.slice(1, -1)}</Text>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    // A web source keeps its address so it can be opened; a file link is shown by its name alone.
    if (link) {
      const [, label, target = ''] = link;
      return <Text key={index} color="cyan">{/^https?:/.test(target) ? `${label} (${target})` : label}</Text>;
    }
    return part;
  });
}

function renderLine(line: string, inFence: boolean, key: number): ReactNode {
  if (inFence) return <Text key={key} color="cyan">{`  ${line}`}</Text>;
  // Ink gives an empty Text no height, so a blank line needs a space to keep paragraphs apart.
  if (line.trim() === '') return <Text key={key}> </Text>;
  if (HEADING.test(line)) return <Text key={key} bold>{inline(line.replace(HEADING, ''))}</Text>;
  const bullet = BULLET.exec(line);
  const body = bullet ? `${bullet[1]}• ${line.slice(bullet[0].length)}` : line;
  return <Text key={key}>{inline(body)}</Text>;
}

/** The Markdown experts actually write: headings, bold, inline code, links, bullets and fenced code. */
export function Markdown({ text }: { text: string }) {
  let inFence = false;
  const lines: ReactNode[] = [];
  text.split('\n').forEach((line, index) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    lines.push(renderLine(line, inFence, index));
  });
  return <Box flexDirection="column">{lines}</Box>;
}
