# TimeTrace AI

> Rewind code risk, not just code history.

TimeTrace AI is a VS Code extension that helps developers explain how a bug emerged, not only where it appears now. It builds save-by-save checkpoints, detects risky changes, correlates runtime-like signals, and surfaces probable root causes in a clean timeline interface.

## The Idea

Most tools show the current error state. TimeTrace AI shows the transition to failure.

- What changed.
- Why risk increased.
- Which files are affected.
- Which location is most likely the source.

## Why It Stands Out

- Timeline-first debugging across file saves.
- AI-style findings with transparent evidence.
- Incident lifecycle tracking from `open` to `resolved`.
- Root-cause ranking across related modules.
- Runtime signal correlation to strengthen confidence.
- Clean, focused VS Code sidebar UX.

## Product Snapshot

TimeTrace AI watches save events and produces a structured analysis package:

1. Checkpoint state (`NORMAL`, `WARNING`, `ERROR`)
2. Findings with severity, confidence, and line ranges
3. Root-cause candidates with evidence
4. Related and impacted files from dependency graph
5. Incident updates and runtime-linked timeline items

## Architecture

```text
Save Event
	-> Feature Extraction
	-> Finding Detection
	-> Risk Classification
	-> Dependency Impact Mapping
	-> Root Cause Ranking
	-> Incident Lifecycle Update
	-> Runtime Correlation
	-> Unified Timeline + Sidebar Render
```

### Core Components

- `timetrace-ai/src/extension.ts`
	- Activation, event wiring, webview payload orchestration.
- `timetrace-ai/src/ai/*`
	- Analysis engine (features, findings, scoring, RCA, incidents, runtime, timeline).
- `timetrace-ai/media/sidebar.js` and `timetrace-ai/media/sidebar.css`
	- Sidebar rendering and interaction logic.
- `timetrace-ai/demo-v3-workspace`
	- Deterministic demo scenarios for judges and live walkthroughs.

## Repository Structure

```text
TimeTrace-AI/
	README.md
	timetrace-ai/
		src/
			extension.ts
			ai/
			test/
		media/
		demo-v3-workspace/
		package.json
		.vscodeignore
```

## Quick Start

```bash
cd timetrace-ai
npm install
npm run compile
```

Launch in VS Code:

1. Open folder `timetrace-ai`
2. Press `F5` to run Extension Development Host
3. Open any JS/TS project and save a file
4. Open TimeTrace AI from the activity bar

## Commands

- `timetrace-ai.openSidebar`
- `timetrace-ai.analyzeCurrentDocument`
- `timetrace-ai.showLatestAnalysis`
- `timetrace-ai.injectTestRuntimeEvent`

## Demo Flow For Judges

Use the scripted demo workspace:

- `timetrace-ai/demo-v3-workspace/README.md`
- `timetrace-ai/demo-v3-workspace/DEMO_SCRIPT.md`

Suggested narrative:

1. Start from baseline saves.
2. Introduce a guard-removal regression.
3. Trigger cross-file contract drift.
4. Show runtime-linked evidence in timeline.
5. Fix forward and show incident resolution.

## Scripts

Inside `timetrace-ai`:

- `npm run compile`
- `npm run watch`
- `npm run lint`
- `npm run pretest`
- `npm test`

## Packaging

Use `vsce` inside `timetrace-ai`:

```bash
npx @vscode/vsce ls
npx @vscode/vsce package
```

Package scope is controlled via `timetrace-ai/.vscodeignore`.

## Tech Stack

- TypeScript
- VS Code Extension API
- Webview (HTML/CSS/JS)
- Lightweight static analysis heuristics
- Runtime signal normalization and correlation

## Current Status

- Functional V3 timeline and RCA flow is implemented.
- Runtime correlation is heuristic-driven and continuously improvable.
- Demo workspace is included for reproducible evaluations.

## License

MIT
