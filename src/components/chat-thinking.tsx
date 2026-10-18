'use client';

import { useEffect, useState } from 'react';
import ThoughtLine from './react-bits/ThoughtLine';
import LatticeLoader, { type LatticeStatus } from './react-bits/LatticeLoader';

export type ChatRun = {
  id: number;
  startedAt: number;
  finishedAt?: number;
  status: LatticeStatus;
  label: string;
  steps: string[];
  messageId?: string;
};

export function ChatThinking({ run }: { run: ChatRun }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (run.status !== 'working') return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [run.id, run.status]);
  const elapsed = Math.max(0, ((run.finishedAt ?? now) - run.startedAt) / 1000);
  const doneLabel = run.status === 'error' ? '未完成 · 用时' : '已完成 · 用时';

  return <div className="chat-process" data-run-status={run.status}>
    <ThoughtLine label={run.label} doneLabel={doneLabel} working={run.status === 'working'}
      steps={run.steps} failedStepIndex={run.status === 'error' ? run.steps.length - 1 : -1}
      elapsed={elapsed} showTimer={false} glyph="none" color="var(--theme-secondary)" fontSize={14} settleDuration={350}
      header={<LatticeLoader status={run.status} grid={4} pattern="sweep" glow showTimer elapsed={elapsed}
        label={run.label} doneLabel="已完成 · 用时" errorLabel="未完成 · 用时" color="currentColor"/>}/>
  </div>;
}
