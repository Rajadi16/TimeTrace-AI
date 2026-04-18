# TimeTrace AI

TimeTrace AI is a VS Code extension that tracks risky code evolution over time. It creates checkpoint history from file saves, identifies likely failure causes, and shows incident lifecycle and cross-file impact in an interactive sidebar.

## What It Solves

Traditional debugging often answers "what is broken now" but not "how this became broken." TimeTrace AI focuses on transition intelligence:

- from stable to risky states,
- from local edits to cross-file impact,
- from isolated signals to a root-cause shortlist.

## Key Capabilities

- Checkpoint timeline across saves (`NORMAL`, `WARNING`, `ERROR`).
- Structured findings generated from code-diff features.
- Root cause ranking with confidence and evidence.
- Incident lifecycle tracking (`open`, `mitigated`, `resolved`).
- Related and impacted file mapping via dependency graph.
- Runtime signal ingestion and correlation into timeline/incidents.
- Code pane with before/after snippets and inferred code path view.

## Requirements

- VS Code engine target: `^1.116.0`.
- Node.js 20+ recommended.
- npm 10+ recommended.

## Commands

- `TimeTrace AI: Focus Sidebar` (`timetrace-ai.openSidebar`)
- `TimeTrace AI: Analyze Current Document` (`timetrace-ai.analyzeCurrentDocument`)
- `TimeTrace AI: Show Latest Analysis` (`timetrace-ai.showLatestAnalysis`)
- `TimeTrace AI: Inject Test Runtime Event` (`timetrace-ai.injectTestRuntimeEvent`)

## Quick Start (Development)

```bash
npm install
npm run compile
```

Then:

1. Open this folder (`timetrace-ai`) in VS Code.
2. Press `F5` to start Extension Development Host.
3. In the host window, open a JS/TS workspace and save files to generate analysis.
4. Open the TimeTrace AI activity bar view.

## How Analysis Works

1. Save event triggers analysis for the active file.
2. Feature extraction detects risky diff patterns.
3. Finding detector emits typed findings.
4. Classifier derives score and risk state.
5. Dependency graph computes related/impacted files.
6. RCA ranking builds probable source list.
7. Incident manager updates lifecycle state.
8. Runtime events are ingested/correlated when available.
9. Timeline items are generated and rendered in sidebar.

## Project Structure

```text
timetrace-ai/
	src/
		extension.ts                # Activation and orchestration
		ai/                         # Analysis + runtime + timeline modules
		test/                       # Extension and engine tests
	media/                        # Webview sidebar JS/CSS/assets
	demo-v3-workspace/            # Scripted demo application
	package.json                  # Extension manifest
```

## Demo Walkthrough

Use the deterministic demo app and script:

- `demo-v3-workspace/README.md`
- `demo-v3-workspace/DEMO_SCRIPT.md`

Recommended sequence:

1. Baseline saves.
2. Null guard removal.
3. Optional chaining/fallback removal.
4. Export signature change.
5. Introduce diagnostic error.
6. Add loop/performance risk.
7. Fix forward and observe incident resolution.

## Scripts

- `npm run compile`: compile TypeScript.
- `npm run watch`: compile in watch mode.
- `npm run lint`: lint extension source.
- `npm run pretest`: compile + lint.
- `npm test`: execute extension tests.

## Packaging

Packaging exclusions are defined in `.vscodeignore`.

Useful commands:

```bash
npx @vscode/vsce ls
npx @vscode/vsce package
```

The package intentionally excludes demo/docs/sandbox assets from distribution.

## Known Notes

- Runtime correlation is heuristic-driven and currently optimized for diagnostic/test-injected events.
- For best demo reliability, apply one scripted change at a time and save after each step.

## Release Notes

### 0.0.1

- V3 sidebar integration with timeline and RCA flows.
- Incident engine with runtime-aware enrichment.
- Unified timeline rendering for checkpoints/incidents/runtime events.

## License

MIT
