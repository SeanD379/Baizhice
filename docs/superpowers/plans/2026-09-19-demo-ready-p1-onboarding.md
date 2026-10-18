# Demo Ready P1 Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a first-time student understand the product and reach the correct next action from an empty course, uploaded material, conflict state, outline state, or active practice state.

**Architecture:** Replace the AI-first home with a pure, tested state selector plus a small `LearningDashboard`; retain `LearningHome` as the secondary assistant view. Keep upload processing in `Workbench`, but return successful uploads to the library and track newly added IDs for visual confirmation. Fix TXT semantics at the segmentation boundary so blank lines never become fake failed positions.

**Tech Stack:** React 19, Next.js 16 client components, Vitest/jsdom, Node test runner for extraction, existing CSS system.

---

## Fixed decisions and success criteria

- Home has one primary action per state; “体验完整示例” remains secondary.
- Priority order: no materials → unresolved issues → no outline → active/due practice → continue outline.
- AI assistant is a secondary view and is hidden from primary navigation when unavailable.
- Successful upload closes the dialog, opens the library, and highlights the returned material IDs.
- Blank TXT lines do not create positions, do not count toward the 50-segment limit, and do not cause `partial`.

### Task 1: Model the home state as a pure function

**Files:**
- Create: `src/lib/home-state.ts`
- Create: `src/lib/home-state.test.ts`
- Modify: `src/lib/types.ts`

- [ ] Write table-driven failing tests for `empty`, `issues`, `needs-outline`, `continue-practice`, `due-review`, and `continue-outline`.
- [ ] Define a minimal input/output contract:

```ts
export type HomeState = {
  kind: 'empty' | 'issues' | 'needs-outline' | 'continue-practice' | 'due-review' | 'continue-outline';
  title: string;
  description: string;
  action: 'upload' | 'review-issues' | 'prepare' | 'practice' | 'outline';
  actionLabel: string;
};
```

- [ ] Keep the function deterministic and UI-free. Pass booleans/counts rather than importing Prisma or fetching inside it.
- [ ] Explicitly test precedence: issues beat outline generation; unfinished practice beats generic outline continuation; due review beats generic continuation only when there is no unfinished set.
- [ ] Run `npx vitest run src/lib/home-state.test.ts`; expect all cases to pass.
- [ ] Commit: `git add src/lib/home-state.ts src/lib/home-state.test.ts src/lib/types.ts && git commit -m "feat: define state-based learning home"`

### Task 2: Replace the AI-first page with the state-based dashboard

**Files:**
- Create: `src/components/learning-dashboard.tsx`
- Create: `src/components/learning-dashboard.test.tsx`
- Modify: `src/components/workbench.tsx`
- Modify: `src/app/globals.css`

- [ ] Write component tests for the six states. Each test must find exactly one primary button and assert its callback.
- [ ] Build the empty-course three-step guide with the approved sequence: import → verify extraction/conflicts → organize cited study material.
- [ ] Include two empty-state choices: primary “上传我的资料” and secondary “体验独立的概率论示例”.
- [ ] Add `assistant` to `View`, rename `home` to “学习首页”, and render `LearningHome` only for `view === 'assistant'`.
- [ ] Show “学习助手” as a secondary nav item only when `workspace.capabilities.ai_configured`; direct URLs to `view=assistant` must fall back to home when unavailable.
- [ ] Feed practice state through the existing `/api/practice` result or reuse `StudyProgress`; do not invent a second scheduling algorithm.
- [ ] Keep the existing demo disclosure and P0 entry/reset behavior unchanged.
- [ ] Run `npx vitest run src/components/learning-dashboard.test.tsx src/lib/home-state.test.ts`; expect all tests to pass.
- [ ] Commit: `git add src/components/learning-dashboard.tsx src/components/learning-dashboard.test.tsx src/components/workbench.tsx src/app/globals.css && git commit -m "feat: guide students from course state"`

### Task 3: Finish uploads in the library with visible confirmation

**Files:**
- Modify: `src/components/workbench.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/workbench.test.tsx`

- [ ] Add a failing test that uploads two files, captures returned material IDs, and expects the dialog to close, view to become `library`, and both rows to receive a temporary `is-new` treatment.
- [ ] Change the secondary footer label from “完成并返回” to “完成上传并查看资料”. Disable it until every queued item is `done` or intentionally removed.
- [ ] Collect successful returned IDs during `uploadFiles()`. After reload, close the dialog, navigate to library, set `recentMaterialIds`, and announce the count through the existing toast/`aria-live` region.
- [ ] Give each highlighted row a textual “刚刚添加” label so the state is not conveyed by color alone. Clear highlights when the course changes or the user opens another upload batch.
- [ ] Provide one next action per new row based on state: view extracted text, retry extraction, or inspect an issue.
- [ ] Run `npx vitest run src/components/workbench.test.tsx`; expect the upload regression to pass.
- [ ] Commit: `git add src/components/workbench.tsx src/components/workbench.test.tsx src/app/globals.css && git commit -m "fix: return completed uploads to the library"`

### Task 4: Stop treating TXT blank lines as failed positions

**Files:**
- Modify: `scripts/document-formats.mjs`
- Modify: `scripts/extraction.node.mjs`
- Modify: `src/components/extracted-content.tsx`

- [ ] Add a failing extraction test for `第一段\n\n第二段\n   \n第三段`. Expect three extracted pages/positions, `pageCount === 3`, and `state === 'complete'`.
- [ ] Add a limit regression with more than 50 non-empty lines separated by blanks. Assert blanks neither consume the limit nor hide the `hasMore` warning for real content.
- [ ] Filter whitespace-only TXT lines before passing items to `takeSegments`. Preserve the original order of non-empty lines; position numbering may be compact because TXT has no source page number.
- [ ] Keep genuine truncation, processing failure, timeout, and non-empty failed segments as `partial`.
- [ ] Narrow the UI warning copy to `提取不完整：存在未识别内容、处理失败或超出限制。` so it no longer labels intentional blank space as failure.
- [ ] Run `npm run test:extraction`; expect all Node extraction tests to pass.
- [ ] Run `npx vitest run src/lib/upload-format.test.ts`; expect all format tests to pass.
- [ ] Commit: `git add scripts/document-formats.mjs scripts/extraction.node.mjs src/components/extracted-content.tsx && git commit -m "fix: ignore blank TXT lines during extraction"`

### Task 5: Consolidate labels and verify first-use comprehension

**Files:**
- Modify: `src/components/workbench.tsx`
- Modify: `src/components/learning-dashboard.tsx`
- Modify: `src/components/learning-home.tsx`
- Modify: `src/app/globals.css`
- Modify: `docs/demo-script.md`

- [ ] Replace remaining primary labels: “AI 学习” → “学习首页”, “新对话” → “学习助手”, “从真实资料补充” → “从新资料更新提纲”.
- [ ] Remove duplicate buttons with the same outcome from a single state. Keep one filled primary action; render alternatives as secondary/ghost actions.
- [ ] Verify an empty newly created course never opens the assistant automatically and the probability sample cannot be imported into it.
- [ ] Run `rg -n "AI 学习|从真实资料补充|完成并返回" src`; expect no obsolete user-facing matches.
- [ ] Run `npm test && npm run check && npm run build`; expect all commands to pass.
- [ ] Manually create a blank course and time an unprompted walkthrough: the upload and full-demo entries must be locatable within 30 seconds.
- [ ] Add the checked first-use path to `docs/demo-script.md`.
- [ ] Commit: `git add src/components/workbench.tsx src/components/learning-dashboard.tsx src/components/learning-home.tsx src/app/globals.css docs/demo-script.md && git commit -m "polish: clarify first-use learning flow"`

## P1 completion gate

- [ ] Every home-state fixture produces one and only one primary action.
- [ ] New courses open the three-step guide, not chat.
- [ ] Upload completes in the library with textual confirmation.
- [ ] TXT blank-line regression passes and no false partial warning appears.
- [ ] Desktop first-use check reaches upload or demo in under 30 seconds.

