import { Box, Static, Text } from 'ink';
import type { Author, Message } from '../conversation.js';
import { t } from '../i18n.js';
import { Markdown } from './Markdown.js';

const AUTHOR_COLORS: Record<Author, string> = { you: 'white', claude: 'magenta', gpt: 'green' };
const AUTHOR_MARKS: Record<Author, string> = { you: '❯', claude: '⏺', gpt: '⏺' };

type Item = { kind: 'title'; topic: string } | { kind: 'message'; message: Message };

function MessageBlock({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={AUTHOR_COLORS[message.author]} bold>
        {AUTHOR_MARKS[message.author]} {t().authors[message.author]}
      </Text>
      <Box paddingLeft={2} flexDirection="column">
        <Markdown text={message.text} />
        {message.interrupted ? <Text dimColor>{t().interrupted}</Text> : null}
      </Box>
    </Box>
  );
}

/** Printed once into the terminal's own scrollback, so the whole history scrolls and copies natively. */
export function Transcript({ topic, messages }: { topic: string; messages: Message[] }) {
  const items: Item[] = [{ kind: 'title', topic }, ...messages.map((message) => ({ kind: 'message' as const, message }))];
  return (
    <Static items={items}>
      {(item) =>
        item.kind === 'title' ? (
          <Box key="title" marginBottom={1}>
            <Text bold>{t().expertsTitle(item.topic)}</Text>
          </Box>
        ) : (
          <MessageBlock key={item.message.id} message={item.message} />
        )
      }
    </Static>
  );
}
