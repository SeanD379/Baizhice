# Demo Ready P2 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make practice history, mobile controls, accessibility, and public capability wording polished enough for portfolio display and live interview use without changing the visual brand.

**Architecture:** Derive compact practice-history summaries from existing immutable history data, progressively disclose full records, and make CSS/component-level responsive fixes at the current breakpoints. Use the fixed demo identity for disclosure. Document capability boundaries in project-facing copy instead of adding settings or new product areas.

**Tech Stack:** React 19, TypeScript, Vitest/jsdom, Radix Dialog, existing CSS variables/media queries.

---

## Fixed decisions and success criteria

- History first level shows date/version, type/count, outcomes, weak topics, and “查看完整作答”.
- Full prompts, answers, citations, timestamps, attempts, and old outline remain in second-level details.
- At 390px, title/actions stack, source inspector is full screen, and no primary action requires horizontal scrolling.
- Keyboard order begins with “跳到主要内容”; all core actions show a visible focus ring.
- Product copy clearly separates implemented, preset-demo, integrated-but-unaccepted, and not-implemented capabilities.

### Task 1: Derive and test compact practice-history summaries

**Files:**
- Modify: `src/lib/practice-history.ts`
- Modify: `src/lib/practice-history.test.ts`
- Modify: `src/components/practice-history.tsx`
- Create: `src/components/practice-history.test.tsx`

- [ ] Add failing pure-function tests for a mixed question set, an unfinished draft, an archived round, a withheld exam, and a missing question snapshot.
- [ ] Export a display-only summary without changing stored history:

```ts
export type PracticeHistorySummary = {
  questionCount: number;
  kinds: string[];
  correct: number;
  needsReview: number;
  selfReviewed: number;
  weakTopics: string[];
  stateLabel: string;
};
```

- [ ] Count only saved results. Deduplicate weak topics, preserve their first occurrence, and use neutral copy when a snapshot is missing or an exam is withheld.
- [ ] Replace each verbose entry summary with date, `V{number}`, types/count, objective/self-review outcome, and at most three weak topics.
- [ ] Add a “查看完整作答” nested disclosure containing all current question/answer/reference/attempt/version details. Preserve the existing privacy behavior for unsubmitted exams.
- [ ] Component-test that full answer/reference text is hidden before expansion and available after expansion.
- [ ] Run `npx vitest run src/lib/practice-history.test.ts src/components/practice-history.test.tsx`; expect all tests to pass.
- [ ] Commit: `git add src/lib/practice-history.ts src/lib/practice-history.test.ts src/components/practice-history.tsx src/components/practice-history.test.tsx && git commit -m "feat: summarize practice history"`

### Task 2: Reorder the practice landing page

**Files:**
- Modify: `src/components/practice-panel.tsx`
- Modify: `src/components/practice-workspace.tsx`
- Modify: `src/components/practice-interactions.test.tsx`
- Modify: `src/app/globals.css`

- [ ] Add a failing interaction test asserting visual/DOM order: start-or-continue, due review, weak topics, recent result, history.
- [ ] Move `PracticeHistory` after `PracticeWorkspace`; it must no longer be the first card.
- [ ] Keep the AI generation block entirely absent when unconfigured. When configured, place it after the existing/preset practice path as a secondary advanced action.
- [ ] Preserve all current scheduling and answer semantics; this task changes composition and labels only.
- [ ] Mark preset questions with visible copy `预设练习 · 用于展示作答、解析与出处流程`.
- [ ] Run `npx vitest run src/components/practice-interactions.test.tsx src/components/practice-workspace.test.tsx`; expect all tests to pass.
- [ ] Commit: `git add src/components/practice-panel.tsx src/components/practice-workspace.tsx src/components/practice-interactions.test.tsx src/app/globals.css && git commit -m "polish: prioritize the practice workflow"`

### Task 3: Complete the 390px action and source-panel layout

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/workbench.tsx`
- Modify: `src/components/pdf-preview.tsx`

- [ ] At `@media(max-width: 600px)`, make `.page-heading` and `.heading-actions` full-width columns; primary actions use full width and retain at least 44px hit height.
- [ ] Make `.inspector` an inset full-screen drawer at 390px with its own sticky header, safe-area padding, and body scroll containment. Keep the desktop sticky side panel unchanged.
- [ ] Ensure the mobile top bar continues to display menu, truncated course name, and current location.
- [ ] Prevent horizontal overflow from formulas, citation buttons, version rows, modal footers, and PDF controls. Use contained scrolling only for formula/PDF content where shrinking would harm readability.
- [ ] Start `npm run dev`; inspect 390×844 for all four primary views plus the source drawer. Confirm no clipped close/back control and no horizontal page scroll.
- [ ] Inspect 1440px afterward to confirm desktop layout has not regressed.
- [ ] Commit: `git add src/app/globals.css src/components/workbench.tsx src/components/pdf-preview.tsx && git commit -m "fix: complete narrow-screen learning flow"`

### Task 4: Run keyboard, focus, and contrast regression

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/ui/modal.tsx`
- Modify: `src/components/workbench.tsx`
- Test: `src/components/workbench.test.tsx`

- [ ] Add/extend tests asserting the skip link is the first focusable control and targets `#main`, dialog titles/descriptions are present, and status/error feedback uses `role=status`/`role=alert` or an `aria-live` region.
- [ ] Add a global `:focus-visible` rule with a high-contrast outline and offset for buttons, links, inputs, selects, textareas, summaries, and `[tabindex]`; do not remove component focus styles unless replaced.
- [ ] Verify Radix modal open/close restores focus to its trigger. For the custom source inspector, focus its heading/close button on open and return focus to the invoking citation/material row on close.
- [ ] Check all small green text/status tokens against their actual background. Raise low-contrast tokens to an existing darker variable; do not introduce a new palette.
- [ ] Keyboard-run the golden path: Tab from skip link, open/close upload modal, resolve conflict, open source, edit/save, start/answer practice, expand history, reset demo.
- [ ] Run `npx vitest run src/components/workbench.test.tsx`; expect all accessibility assertions to pass.
- [ ] Commit: `git add src/app/globals.css src/components/ui/modal.tsx src/components/workbench.tsx src/components/workbench.test.tsx && git commit -m "fix: strengthen focus and accessible status cues"`

### Task 5: Publish honest demo and portfolio boundaries

**Files:**
- Modify: `README.md`
- Modify: `docs/demo-script.md`
- Modify: `src/components/workbench.tsx`

- [ ] Add a concise capability matrix:

| Boundary | Content |
| --- | --- |
| Implemented | local upload/storage, extraction, PDF preview, exclusion, editing, versions, export, practice records |
| Preset demo | sample classification, conflict, outline, incremental update, preset questions |
| Integrated, not accepted | real model generation, question generation, answer feedback |
| Not implemented | login, sharing, cloud sync |

- [ ] Keep the in-product demo banner short; put implementation detail and limitations in README/demo notes.
- [ ] Add interview talk tracks for the three differentiators: traceable sources, explicit uncertainty/conflict handling, durable personal edits/history.
- [ ] Search public copy for overclaims such as “自动掌握”, “智能评分”, “支持网盘导入”, or claims that preset output is real AI. Replace only confirmed overclaims.
- [ ] Run `npm test && npm run check && npm run build`; expect all commands to pass.
- [ ] Complete the golden flow once at 1440px and once at 390px using keyboard for all core actions. Record final elapsed time and remaining known limitations.
- [ ] Commit: `git add README.md docs/demo-script.md src/components/workbench.tsx && git commit -m "docs: clarify demo and portfolio boundaries"`

## P2 completion gate

- [ ] Practice history is scannable before any nested disclosure opens.
- [ ] Core flow has no horizontal page scroll at 390px.
- [ ] Skip link remains first; focus is visible and restored after dialogs/drawers.
- [ ] Demo/preset/real/unimplemented boundaries are consistent in product, README, and demo script.
- [ ] Full test, type-check, build, desktop demo, and mobile demo all pass.
