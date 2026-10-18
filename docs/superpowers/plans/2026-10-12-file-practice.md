# File-based Knowledge Practice Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task by task. The user approved the in-chat design and requested implementation in this chat.

**Goal:** Open collected materials by filename, select knowledge or questions, prepare missing answers and explanations, review AI results, then enter practice.

**Architecture:** Extend the existing practice hub and original-question bank. Notebook source blocks provide file associations; original bank analysis fills only selected questions. Knowledge generation produces up to five reviewable variants in the same bank, using the existing structured question validator and practice engine.

**Tech Stack:** Next.js, React, Prisma, Vitest, Playwright, existing React Bits SpotlightCard and LatticeLoader.

**Spec:** User-approved design in this conversation: file list → card selection → answer preparation and review → practice. Back navigation and selection must survive refresh. No recent-material block.

## Global Constraints

- Modify canonical main checkout at C:/Users/13150/.claude/projects/LMS and use port 4175.
- Preserve all existing uncommitted work; no commits, pushes, cleanup or resets.
- Keep original answers and existing completed generations; only fill missing fields.
- User-facing names are AI 助手. New generated questions require review before practice.
- Keep existing per-round limits: 10 original questions and 5 variants; up to 12 selected knowledge points.
- Validate selected file, course, current sources and exam protection before paid generation or practice.
- Verify using mocked AI and temporary databases; never generate paid answers or modify real user materials for tests.

## Review Focus

- Same-named files remain separate and only explicitly collected questions enter the file library.
- A source change, pending review or unfinished exam prevents answer disclosure and practice preparation.
- Answer generation sends only selected incomplete questions and preserves existing answers.
- Partial failures keep completed content, permit retry and never silently enter practice with missing answers.
- Mixed selections contain exactly the selected original questions and the reviewed newly generated knowledge questions.

### Task 1: File library and routing

**Files:** src/lib/practice-hub.ts, src/lib/practice-hub-store.ts, src/components/practice-hub.tsx and associated tests.
**Interfaces:** HubKnowledge.materialIds, StudyQuestion.collected, collectedPracticeFiles(summary), activity=file and fromFile navigation.

- [x] Write and run failing tests for source grouping, duplicate names and route roundtrip.
- [x] Map source-block references to notebook knowledge, group by material ID and render file rows with counts.
- [x] Verify pure grouping tests and hub API tests; preserve other hub sections.

### Task 2: Generate reviewable practice from selected knowledge

**Files:** src/lib/knowledge-practice-store.ts, src/app/api/question-banks/route.ts, src/lib/question-bank-types.ts, src/lib/original-practice-store.ts and tests.
**Interfaces:** generateKnowledgePractice(courseId,materialId,pageIds) → {bank,questionIds}; reviewKnowledgePractice(courseId,bankId,revision,questionIds) → bank. POST actions generate-knowledge and review-knowledge.

- [x] Write and run failing tests for selected-only generation, current source validation, review and changed-source rejection.
- [x] Reuse questionsSchema, validateQuestions and adoptStudyQuestions; mark new variants as pending practice review.
- [x] Reject pending questions from new rounds. Approve only the explicitly reviewed IDs using bank revision checks.
- [x] Verify isolated database tests and existing original-practice tests.

### Task 3: File content and preparation flow

**Files:** src/components/file-practice.tsx, src/components/practice-activity.tsx, src/components/workbench.tsx, src/app/practice-hub.css and tests.

- [x] Write and run failing component tests for selection, missing-answer gating, generation failure and exact round IDs.
- [x] Render knowledge/question SpotlightCards with separate selections and sessionStorage recovery.
- [x] Reuse selected bank analysis, poll real completion counts with LatticeLoader, show generated answers for review and preserve retry state.
- [x] Open only the selected prepared IDs with original-load; return to the same file from practice.
- [x] Verify component tests, navigation tests and types.

### Task 4: Integration verification and review

- [x] Verify desktop, tablet and mobile file entry, batch choice, refresh, progress, failure/retry, review and return with mocked browser mutations.
- [x] Run relevant tests, full test suite with four workers, type checks and one isolated production build.
- [x] Restore build-generated project settings to their pre-build contents.
- [x] Review the final change against the five failure modes above and record results here.

## Completion evidence

- Full Vitest suite: 656/656 passed; current FilePractice regression suite: 9/9 passed. Tests used mocked AI and temporary databases.
- TypeScript check passed. Isolated production build at .next-file-practice-check passed after the final CSS change; generated tsconfig.json and next-env.d.ts restored and hash-verified.
- Browser: 35 workflow checks passed, including real collected-file entry and mocked selected-only preparation, progress animation, review, mixed selection, retry, return, keyboard tabs, responsive layout and exam protection. Every browser mutation was intercepted; no paid generation or user-material writes.
- Additional rendered hover checks at 390, 768 and 1413 px passed with 11.05:1 contrast. Desktop, review and mobile screenshots inspected.
- Fresh read-only reviewer closed the exam race, cancellation recovery, notebook-source drift, AI explanation provenance, stale-card selection and late duplicate-response findings; no remaining findings.
- Mechanical UI scan reported only the pre-existing hub-book-cover inset accent at practice-hub.css:23. This unchanged neighboring design was retained.