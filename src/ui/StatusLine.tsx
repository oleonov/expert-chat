import { Text } from 'ink';
import { useEffect, useState } from 'react';
import { budgetExhausted, converged, type ConversationState } from '../conversation.js';
import { t } from '../i18n.js';
import { EXPERT_IDS, type ExpertId } from '../protocol.js';

export interface Activity {
  status: string;
  note: string;
}

const FRAMES = ['◐', '◓', '◑', '◒'];

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % FRAMES.length), 150);
    return () => clearInterval(timer);
  }, []);
  return <Text color="yellow">{FRAMES[frame]}</Text>;
}

const thousands = (tokens: number): string => `${Math.round(tokens / 1000)}k`;

function ExpertStatus({ id, state, activity }: { id: ExpertId; state: ConversationState; activity: Activity }) {
  const expert = state.experts[id];
  const label = t().authors[id];
  if (expert.error) return <Text color="red">✗ {label} {t().errorWord}: {expert.error}</Text>;
  const detail = expert.busy ? activity.status : (expert.lastStatus ? t().statusLabels[expert.lastStatus] : t().waiting);
  return (
    <Text>
      {expert.busy ? <Spinner /> : '○'} {label} {detail}
      {expert.tokens > 0 ? <Text dimColor> · {t().contextWord} {thousands(expert.tokens)}</Text> : null}
      {activity.note ? <Text color="yellow"> · {activity.note}</Text> : null}
    </Text>
  );
}

function banners(state: ConversationState): string[] {
  const busy = EXPERT_IDS.some((id) => state.experts[id].busy);
  return [
    state.paused ? t().paused : '',
    converged(state) && !busy ? t().converged : '',
    budgetExhausted(state) && !busy && !state.paused ? t().yourTurn : '',
  ].filter(Boolean);
}

export function StatusLine({ state, activity }: { state: ConversationState; activity: Record<ExpertId, Activity> }) {
  return (
    <Text>
      {EXPERT_IDS.map((id) => (
        <Text key={id}>
          <ExpertStatus id={id} state={state} activity={activity[id]} />
          {'   '}
        </Text>
      ))}
      <Text dimColor>
        {t().turns(state.turnsSinceUser, state.budget)}
      </Text>
      {banners(state).map((banner) => (
        <Text key={banner} color="yellow" bold>
          {' · '}
          {banner}
        </Text>
      ))}
    </Text>
  );
}
