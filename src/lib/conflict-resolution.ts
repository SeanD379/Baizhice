import { z } from 'zod';

export const conflictFeedbackReasons = ['reference_incorrect', 'outdated', 'missing_context', 'teacher_review', 'review_later'] as const;

type ConflictAction =
  | { action: 'accept-reference'; referenceAvailable: boolean }
  | { action: 'pause-conflict'; reason: string; note?: string }
  | { action: 'reopen-conflict' };

export function conflictResolutionUpdate(input: ConflictAction, now = new Date()) {
  if (input.action === 'accept-reference') {
    if (!input.referenceAvailable) throw new Error('参考资料当前不可用，请先补充或恢复参考资料。');
    return { conflictResolution: 'accepted_reference', conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: now };
  }
  if (input.action === 'reopen-conflict') {
    return { conflictResolution: null, conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: null };
  }
  const result = z.object({
    reason: z.enum(conflictFeedbackReasons),
    note: z.string().trim().max(500).optional(),
  }).safeParse(input);
  if (!result.success) throw new Error('提交内容不完整或格式不正确，请检查后重试。');
  return {
    conflictResolution: 'paused',
    conflictFeedbackReason: result.data.reason,
    conflictFeedbackNote: result.data.note || null,
    conflictResolvedAt: now,
  };
}
