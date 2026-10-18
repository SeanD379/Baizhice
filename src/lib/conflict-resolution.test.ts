import { describe, expect, it } from 'vitest';
import { conflictResolutionUpdate } from './conflict-resolution';

const now = new Date('2026-09-22T00:00:00.000Z');

describe('conflictResolutionUpdate', () => {
  it('adopts an available reference without rewriting the source material', () => {
    expect(conflictResolutionUpdate({ action: 'accept-reference', referenceAvailable: true }, now)).toEqual({
      conflictResolution: 'accepted_reference', conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: now,
    });
  });

  it('rejects reference adoption when the reference is unavailable', () => {
    expect(() => conflictResolutionUpdate({ action: 'accept-reference', referenceAvailable: false }, now)).toThrow('参考资料当前不可用');
  });

  it('stores one predefined pause reason and an optional note', () => {
    expect(conflictResolutionUpdate({ action: 'pause-conflict', reason: 'outdated', note: '课程采用新版定义。' }, now)).toEqual({
      conflictResolution: 'paused', conflictFeedbackReason: 'outdated', conflictFeedbackNote: '课程采用新版定义。', conflictResolvedAt: now,
    });
  });

  it('rejects an unsupported pause reason', () => {
    expect(() => conflictResolutionUpdate({ action: 'pause-conflict', reason: 'other' }, now)).toThrow('提交内容不完整');
  });

  it('reopens a conflict by clearing the previous decision', () => {
    expect(conflictResolutionUpdate({ action: 'reopen-conflict' }, now)).toEqual({
      conflictResolution: null, conflictFeedbackReason: null, conflictFeedbackNote: null, conflictResolvedAt: null,
    });
  });
});
