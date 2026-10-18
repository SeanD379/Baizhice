# Demo Ready P0 Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five-minute portfolio/interview demo deterministic, offline-capable, isolated from user courses, and incapable of launching known-unavailable AI actions.

**Architecture:** Add one server-owned capability snapshot to the existing workspace response, keep chat draft/source selection in `Workbench`, and introduce a fixed-ID demo workspace service used by two explicit workspace actions: ensure and reset. Demo files are prepared before the database transaction; every database row belonging to the demo course is then rebuilt inside one Prisma transaction. Existing user courses are never selected by name or touched by reset.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, Prisma 6/SQLite, Vitest 5, Radix Dialog.

---

## Fixed decisions and success criteria

- Demo course ID: `demo-probability-v1`; never locate it by course name.
- `ensure-demo` creates the fixed seed only when absent; it must not erase an existing demo session.
- `reset-demo` deletes and recreates only records whose `courseId` is the fixed demo ID.
- The demo flow makes no OpenAI request. Real AI remains available only when `ai_configured === true`.
- Ordinary UI never mentions `.env.local`, environment variables, API keys, or restart commands.
- A failed chat request preserves question text and selected existing materials.
- Verification gate: focused tests, full `npm test`, `npm run check`, `npm run build`, then a manual ten-step demo run with network disabled.

### Task 1: Define public capability and demo identity contracts

**Files:**
- Create: `src/lib/demo-constants.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/app/api/workspace/route.ts`
- Test: `src/lib/workspace-api.test.ts`

- [ ] Write a failing route test that clears `OPENAI_API_KEY`, calls `GET /api/workspace`, and expects:

```ts
expect(body.capabilities).toEqual({
  demo_available: true,
  local_extraction_available: true,
  ai_configured: false,
  ai_unavailable: true,
});
```

- [ ] Add a client-safe constant and narrow types:

```ts
export const DEMO_COURSE_ID = 'demo-probability-v1';
export const DEMO_COURSE_NAME = '概率论 · 完整演示';

export type Capabilities = {
  demo_available: boolean;
  local_extraction_available: boolean;
  ai_configured: boolean;
  ai_unavailable: boolean;
};
export type Workspace = {
  courses: Course[];
  materials: Material[];
  versions: Version[];
  capabilities: Capabilities;
};
```

- [ ] In the server-only workspace route, derive AI state with `openAIConfig()` and include the four booleans in `GET`; do not serialize provider secrets or raw configuration errors.
- [ ] Update the initial `Workbench` state to include the same conservative defaults (`ai_configured: false`, `ai_unavailable: true`).
- [ ] Run `npx vitest run src/lib/workspace-api.test.ts`; expect the new test to pass.
- [ ] Commit: `git add src/lib/demo-constants.ts src/lib/types.ts src/app/api/workspace/route.ts src/lib/workspace-api.test.ts src/components/workbench.tsx && git commit -m "feat: expose safe workspace capabilities"`

### Task 2: Block guaranteed AI failures before submission

**Files:**
- Modify: `src/components/learning-home.tsx`
- Modify: `src/components/learning-home.test.tsx`
- Modify: `src/components/generation-dialog.tsx`
- Modify: `src/components/practice-panel.tsx`
- Modify: `src/lib/openai.ts`
- Modify: `src/lib/openai.test.ts`

- [ ] Add a failing `LearningHome` test with `aiConfigured={false}`. Assert that the textarea/send action is disabled, no `/api/chat` POST occurs, and the page offers “体验完整示例” or existing-material reading instead.
- [ ] Add a configured-state test proving the current text-only send path still POSTs.
- [ ] Add `aiConfigured` and `onOpenDemo` props. Render the composer only when configured; otherwise render a user-facing unavailable card and keep quick prompts visible only as examples, not clickable send actions.
- [ ] Remove the “本机配置方法” disclosure from `GenerationDialog`. Keep a short unavailable explanation and a non-AI alternative.
- [ ] In `PracticePanel`, render the real-generation section only when `data.configured`; existing preset practice remains visible.
- [ ] Change missing-key errors in `src/lib/openai.ts` to the user-safe message `学习助手当前不可用，本次没有发送资料。` Keep HTTP/auth/rate-limit distinctions free of secret/configuration instructions.
- [ ] Extend `openai.test.ts` to assert error strings do not contain `.env`, `OPENAI_API_KEY`, `密钥`, or `重启`.
- [ ] Run `npx vitest run src/components/learning-home.test.tsx src/lib/openai.test.ts`; expect all tests to pass.
- [ ] Run `rg -n "\.env\.local|OPENAI_API_KEY|API 密钥|重启服务" src/components src/app`; expect no ordinary UI matches.
- [ ] Commit: `git add src/components/learning-home.tsx src/components/learning-home.test.tsx src/components/generation-dialog.tsx src/components/practice-panel.tsx src/lib/openai.ts src/lib/openai.test.ts && git commit -m "fix: gate unavailable AI actions"`

### Task 3: Keep chat drafts and select existing sources in context

**Files:**
- Create: `src/components/chat-material-picker.tsx`
- Create: `src/components/chat-material-picker.test.tsx`
- Modify: `src/components/learning-home.tsx`
- Modify: `src/components/learning-home.test.tsx`
- Modify: `src/components/workbench.tsx`
- Modify: `src/app/globals.css`

- [ ] Add a picker component test covering open, checked material state, confirm, cancel, disabled/excluded materials, and focus return supplied by Radix Dialog.
- [ ] Define the lifted draft state in `Workbench`:

```ts
type ChatDraft = { text: string; materialIds: string[] };
const [chatDrafts, setChatDrafts] = useState<Record<string, ChatDraft>>({});
const draftKey = `${courseId}:${activeConversationId ?? 'new'}`;
```

- [ ] Pass current-course materials, controlled draft text, selected IDs, and change handlers into `LearningHome`. Preserve each course/conversation draft while navigating or opening the picker; clear only in `startNewChat` or after a successful send.
- [ ] Replace “选择已有资料” navigation with `ChatMaterialPicker`. List name plus status; exclude `excluded`, `review`, and `stored` rows from selection with an explicit reason.
- [ ] Merge selected existing material IDs with IDs returned by new uploads. Show removable source chips and the selected count in the composer.
- [ ] Move `setDraft('')` and source clearing from pre-request code to the successful response branch. On failure, remove/mark the optimistic item but leave the controlled draft and source selection unchanged.
- [ ] Add regression tests: type a question, select a material, close/reopen picker, assert text remains; force a 503 response, assert text and selected source remain; successful send clears both.
- [ ] Run `npx vitest run src/components/chat-material-picker.test.tsx src/components/learning-home.test.tsx`; expect all tests to pass.
- [ ] Commit: `git add src/components/chat-material-picker.tsx src/components/chat-material-picker.test.tsx src/components/learning-home.tsx src/components/learning-home.test.tsx src/components/workbench.tsx src/app/globals.css && git commit -m "fix: preserve chat drafts and source selection"`

### Task 4: Build an isolated deterministic demo seed and reset

**Files:**
- Create: `src/lib/demo-workspace.ts`
- Create: `src/lib/demo-workspace.test.ts`
- Modify: `src/app/api/workspace/route.ts`
- Modify: `src/lib/content.ts`
- Test: `src/lib/workspace-api.test.ts`

- [ ] Write failing service tests that seed a normal course plus arbitrary records, call reset, and assert the normal course records are byte-for-byte unchanged while the demo course has stable material IDs, one V1 outline, a conflict note, and preset exercise material.
- [ ] Add an idempotency test: edit the demo course, call `ensureDemoWorkspace`, and assert the edit remains; call `resetDemoWorkspace`, and assert the fixed seed returns.
- [ ] Prepare the four sample PDFs with `sampleBytes()` and `writeFile()` before starting the transaction. Use stable file names/hashes under `data/uploads`.
- [ ] Implement `resetDemoWorkspace()` with `db.$transaction`. Delete demo-owned rows in dependency order (`practiceRound`, `practiceSession`, `practiceSet`, `chatMessage` through demo conversations, `conversation`, `version`, `material`), upsert the fixed course, recreate fixed materials, and create V1 using `generateSections` from the two trusted core materials.
- [ ] Keep the conflicting note active (`status: 'review'`) and the exercise source ready so the demo can show both conflict resolution and a later addition. Do not create a completed practice session.
- [ ] Extend the workspace action schema:

```ts
z.object({ action: z.literal('ensure-demo') }),
z.object({ action: z.literal('reset-demo') }),
```

Return `{ courseId: DEMO_COURSE_ID, reset: boolean }`. Both actions must pass `checkOrigin`.
- [ ] Reject `import-samples` unless `courseId === DEMO_COURSE_ID`; ordinary courses must receive a user-facing instruction to open the isolated demo instead.
- [ ] Run `npx vitest run src/lib/demo-workspace.test.ts src/lib/workspace-api.test.ts`; expect all tests to pass.
- [ ] Commit: `git add src/lib/demo-workspace.ts src/lib/demo-workspace.test.ts src/app/api/workspace/route.ts src/lib/content.ts src/lib/workspace-api.test.ts && git commit -m "feat: isolate and reset demo workspace"`

### Task 5: Add demo entry, disclosure, and reset controls

**Files:**
- Modify: `src/components/workbench.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/workbench.test.tsx`

- [ ] Add a component test that clicks “体验完整示例”, expects `ensure-demo`, switches to `demo-probability-v1`, and shows the persistent preset-demo disclosure.
- [ ] Add a destructive-confirmation test for “重置演示进度”; assert the reset action is impossible outside the fixed demo ID.
- [ ] Implement `openDemo()` and `resetDemo()` through the existing `run()` wrapper. After either action, reload, clear only demo-local UI state, then `navigate('library', DEMO_COURSE_ID)`.
- [ ] Show this persistent banner only in the demo course: `当前为预设中文演示，用于展示资料核对、引用、版本和练习流程，不代表真实模型内容质量。`
- [ ] Put reset behind a confirmation modal naming the demo course and explaining that personal demo edits/conversations/answers will be removed; never present it for regular courses.
- [ ] Remove or redirect all ordinary-course “中文演示资料” import controls to “体验完整示例”.
- [ ] Run `npx vitest run src/components/workbench.test.tsx`; expect all tests to pass.
- [ ] Commit: `git add src/components/workbench.tsx src/components/workbench.test.tsx src/app/globals.css && git commit -m "feat: add deterministic demo entry and reset"`

### Task 6: Lock the golden demo and run release checks

**Files:**
- Create: `docs/demo-script.md`
- Modify: `README.md`

- [ ] Document the exact ten-step script from the approved design, expected UI state after each step, a five-minute target, and a fallback sentence for explaining preset content.
- [ ] Add a pre-demo checklist: reset demo, disable network, use a clean browser session, verify viewport at desktop and 390px, and confirm no regular course changes.
- [ ] Run `npm test`; expect zero failures.
- [ ] Run `npm run check`; expect exit code 0.
- [ ] Run `npm run build`; expect exit code 0.
- [ ] Start with `npm run dev`, disable network after load, reset the demo, and manually complete all ten steps. Confirm no request to `api.openai.com` in the browser network log.
- [ ] Refresh after personal edit and after one practice answer; confirm persistence. Reset; confirm V1/no answers and untouched regular course data.
- [ ] Record actual elapsed time and any deviation in `docs/demo-script.md`.
- [ ] Commit: `git add docs/demo-script.md README.md && git commit -m "docs: lock the five-minute demo flow"`

## P0 completion gate

- [ ] `rg -n "import-samples" src` shows the route guard and no ordinary-course import action.
- [ ] `rg -n "\.env\.local|OPENAI_API_KEY|API 密钥|重启服务" src/components src/app` returns no user-facing setup copy.
- [ ] Reset-isolation tests prove non-demo rows remain unchanged.
- [ ] Chat failure tests prove drafts and source choices remain.
- [ ] Offline manual demo completes in five minutes without dead ends.

