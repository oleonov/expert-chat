import { Box, Text, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';

export function InputBar({ hint, onSubmit }: { hint: string; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState('');
  const { stdout } = useStdout();
  const rule = '─'.repeat(Math.max((stdout as { columns?: number }).columns ?? 80, 10));
  const submit = (text: string) => {
    setValue('');
    onSubmit(text);
  };
  return (
    <Box flexDirection="column">
      <Text dimColor>{rule}</Text>
      <Box>
        <Text>{'❯ '}</Text>
        <TextInput value={value} onChange={(text) => setValue(text.replace(/\r?\n/g, ' '))} onSubmit={submit} />
      </Box>
      <Text dimColor>{rule}</Text>
      <Text dimColor>  {hint}</Text>
    </Box>
  );
}
