# Google / Apple Workbench Visual Refresh Implementation Plan

> **For agentic workers:** Implement task-by-task with test-first changes. Keep every commit scoped to the listed files and preserve unrelated working-tree changes.

**Goal:** Apply the approved C3 visual language, L1 chat-first home, and collapsible sidebar to the LMS shell without changing chat, material, generation, practice, or persistence semantics.

**Architecture:** Keep `Workbench` and `LearningHome` as the existing Client Components. Add the minimum sidebar presentation state to `Workbench`, store only the explicit desktop preference in `localStorage`, and use responsive CSS for viewport defaults. Reuse the existing global stylesheet order; introduce neutral shell/home tokens without restyling legacy content views wholesale.

**Tech Stack:** Next.js 16 App Router, React 19 Client Components, TypeScript, Vitest/jsdom, existing global CSS, Lucide icons.

**Design source:** `docs/superpowers/specs/2026-09-20-google-apple-workbench-visual-refresh-design.md`

---

## Fixed decisions and success criteria

- C3 palette: neutral canvas and surfaces with Google four-color micro-accents only.
- L1 home: chat is the primary task; duplicate module-link cards are removed.
- Sidebar: about 226 px expanded and 72 px collapsed.
- At `>=1280px`, the no-preference default is expanded.
- At `900–1279px`, the no-preference default is collapsed.
- At `<900px`, navigation is a drawer and does not use the desktop collapsed rail.
- Explicit desktop preference survives refresh and does not alter course/view/conversation state.
- Existing chat, upload, privacy, history, error, and navigation behavior remains functional.
- No large blue-purple gradients, glow, looping color animation, bounce, or floating sparkle decoration.

### Task 1: Lock current behavior and add failing shell tests

**Files:**
- Create: `src/components/workbench.test.tsx`
- Modify: `src/components/learning-home.test.tsx`

- [ ] Record a baseline with `npm run check` and `npm test`; note any pre-existing failure before editing.
- [ ] Add a `Workbench` test harness that stubs `/api/workspace` and `/api/chat`, supplies the existing workspace shape, and stubs canvas context only where required by the current course-cover effect.
- [ ] Add failing assertions that the desktop sidebar exposes an expand/collapse control with an accessible name, preserves the active navigation item, and does not change the current view when toggled.
- [ ] Add failing assertions for preference behavior: a valid stored preference is restored, an invalid value falls back safely, and toggling writes only the sidebar preference key.
- [ ] Extend `learning-home.test.tsx` to assert that quick actions populate the composer without submitting, and that the redundant “选择已有资料 / 整理复习材料 / 查看复习练习” home links are absent.
- [ ] Run `npx vitest run src/components/workbench.test.tsx src/components/learning-home.test.tsx`; expect the new assertions to fail for the intended missing behavior.
- [ ] Commit tests only: `git add src/components/workbench.test.tsx src/components/learning-home.test.tsx && git commit -m "test: define refreshed workbench behavior"`.

### Task 2: Implement collapsible desktop navigation

**Files:**
- Modify: `src/components/workbench.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/workbench.test.tsx`

- [ ] Add `PanelLeftClose` and `PanelLeftOpen` from the existing Lucide dependency; do not add a new icon package.
- [ ] Add a single desktop collapsed state to `Workbench`. Read `localStorage` inside an effect because the component already has a `'use client'` boundary and browser APIs must not run during server rendering.
- [ ] Use a project-specific key such as `lms.sidebar.collapsed`. Accept only the serialized boolean values `true` and `false`; ignore all other values.
- [ ] Add the toggle beside the sidebar brand, with `aria-label`, `aria-expanded`, `title`, and a minimum 44 px hit target even when the visible circular control is smaller.
- [ ] Apply a shell class such as `sidebar-collapsed` without changing `view`, `courseId`, `activeConversationId`, or the mobile-menu state.
- [ ] In collapsed mode, keep the brand mark, primary navigation icons, active state, material count indicator, and profile avatar. Hide text, course details, guide content, and conversation titles visually.
- [ ] Give every icon-only navigation item an accessible name and a native or styled tooltip on hover/focus.
- [ ] Animate grid/sidebar width and opacity for about 200 ms. Under `prefers-reduced-motion: reduce`, disable width/position transitions.
- [ ] Update desktop breakpoints: no-preference wide screens render expanded; no-preference 900–1279 px screens render the icon rail; `<900px` continues to use the drawer.
- [ ] Run `npx vitest run src/components/workbench.test.tsx`; expect all shell assertions to pass.
- [ ] Commit: `git add src/components/workbench.tsx src/app/globals.css src/components/workbench.test.tsx && git commit -m "feat: add collapsible workbench navigation"`.

### Task 3: Simplify the home component to the approved L1 flow

**Files:**
- Modify: `src/components/learning-home.tsx`
- Modify: `src/components/learning-home.test.tsx`
- Modify: `src/components/workbench.tsx`

- [ ] Remove the three navigation-only callbacks from `LearningHomeProps` and from the `Workbench` call site: `onLibrary`, `onPrepare`, and `onPractice`.
- [ ] Remove the `chat-related-links` block and the now-unused `FolderInput` import. Do not change sidebar navigation or the `showRange` workflow elsewhere.
- [ ] Keep the three prompt-generating quick actions, but align labels with the approved language: explain a concept, organize key points, and generate practice from material. Each button only sets the draft.
- [ ] Keep existing conversation loading, new-chat, submission, attachment, drag/drop, error, privacy, and scroll behavior unchanged.
- [ ] Make the empty-state copy concise and human: one primary heading, one supporting sentence, prompt suggestions, then the composer.
- [ ] Run `npx vitest run src/components/learning-home.test.tsx`; expect prompt, send, and no-duplicate-link assertions to pass.
- [ ] Commit: `git add src/components/learning-home.tsx src/components/learning-home.test.tsx src/components/workbench.tsx && git commit -m "refactor: focus the learning home on chat"`.

### Task 4: Apply the C3 visual system to the shell and chat home

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/learning.css`
- Modify: `src/components/workbench.tsx`
- Modify: `src/components/learning-home.tsx`
- Test: `src/components/learning-home.test.tsx`

- [ ] Add neutral shell/home tokens without globally remapping every legacy green token: canvas `#F8F9FA`, surface `#FFFFFF`, main text `#202124`, secondary text `#5F6368`, weak surface `#F1F3F4`, line `#DADCE0`, focus/link blue `#1A73E8` / `#0B57D0`.
- [ ] Keep semantic warning, error, and success colors separate from Google four-color accents.
- [ ] Add a small four-color accent to the project brand mark or an equivalent non-semantic detail. Do not place four colors behind text or controls.
- [ ] Restyle the shell: white sidebar, subtle border, neutral active item, lighter top bar, increased content breathing room, and restrained shadow only for true floating elements.
- [ ] Restyle the empty chat home to match the approved sample: centered title/supporting copy, prompt chips, and one prominent 24 px-radius composer.
- [ ] Use approximately 12 px radius for compact navigation, 16 px/full radius for chips, and 24 px for the composer/floating surfaces.
- [ ] Use a dark graphite primary send action; reserve blue for focus, links, and selected feedback.
- [ ] Restyle conversation messages, attachment chips, thinking, error, and disclosure states without changing their DOM roles or messages.
- [ ] Make the welcome region collapse naturally once messages exist; keep the composer usable and visible with long conversations.
- [ ] Add focused component assertions only where DOM semantics change; do not test pixel values in jsdom.
- [ ] Run `npx vitest run src/components/learning-home.test.tsx src/components/workbench.test.tsx`; expect all focused tests to pass.
- [ ] Commit: `git add src/app/globals.css src/app/learning.css src/components/workbench.tsx src/components/learning-home.tsx src/components/learning-home.test.tsx src/components/workbench.test.tsx && git commit -m "style: apply neutral Google inspired workbench"`.

### Task 5: Complete responsive, keyboard, and visual verification

**Files:**
- Modify if required: `src/app/globals.css`
- Modify if required: `src/app/learning.css`
- Modify if required: `src/components/workbench.tsx`
- Modify if required: `src/components/learning-home.tsx`
- Test: `src/components/workbench.test.tsx`
- Test: `src/components/learning-home.test.tsx`

- [ ] Add or finish tests for keyboard activation of the sidebar toggle, visible/semantic active navigation, prompt-to-composer focus flow, and mobile drawer behavior.
- [ ] Verify `aria-current`, `aria-label`, focus restoration, error `role=alert`, status live regions, and the existing skip link.
- [ ] Verify 200% browser zoom does not hide the sidebar control, composer, attachment removal, or send button.
- [ ] Verify `prefers-reduced-motion: reduce` disables nonessential transitions.
- [ ] Run `npm test`; expect the full Vitest suite to pass.
- [ ] Run `npm run check`; expect TypeScript to pass.
- [ ] Run `npm run build`; expect the Next.js production build and CSS ordering to pass.
- [ ] Start the app with `npm run dev` and capture screenshots at 1440×900, 1024×768, and 390×844.
- [ ] At 1440 px, verify expanded and collapsed states, persisted preference, history navigation, empty chat, populated chat, attachment, loading, and error states.
- [ ] At 1024 px, verify the no-preference icon rail and temporary expansion without horizontal page scroll.
- [ ] At 390 px, verify the drawer, course-title truncation, prompt chip overflow/wrapping, attachment list, composer, and software keyboard-safe spacing.
- [ ] Compare the screenshots against the approved visual summary. Reject large gradients, decorative glow, duplicate module entry cards, excessive shadows, or loss of neutral hierarchy.
- [ ] If verification requires CSS-only corrections, keep them in this task and rerun focused tests plus the production build.
- [ ] Commit the verified finish: `git add src/app/globals.css src/app/learning.css src/components/workbench.tsx src/components/learning-home.tsx src/components/workbench.test.tsx src/components/learning-home.test.tsx && git commit -m "polish: verify responsive workbench refresh"`.

## Completion gate

- [ ] C3 palette and L1 hierarchy match the approved design at desktop and mobile sizes.
- [ ] Sidebar expansion, collapse, responsive defaults, persistence, tooltips, and keyboard behavior work.
- [ ] No duplicate module navigation remains in the empty chat home.
- [ ] Chat submission, attachments, history, errors, privacy copy, and current navigation still work.
- [ ] Existing non-home views remain functional and are not unintentionally restyled wholesale.
- [ ] Focused tests, full tests, type-check, production build, and three viewport visual checks pass.
