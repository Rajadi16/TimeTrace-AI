# TimeTrace-AI

TimeTrace AI is a VS Code extension that helps developers understand how code risk evolves over time. It captures save-by-save checkpoints, analyzes change impact, correlates runtime-like signals, and presents root-cause candidates in a timeline-driven sidebar.

## Why TimeTrace AI

Debugging is often slow because teams only see the current broken state, not how the system got there. TimeTrace AI focuses on the path to failure:

- Tracks state transitions (`NORMAL`, `WARNING`, `ERROR`) across file saves.
- Detects risky changes and turns them into structured findings.
- Groups recurring findings into incidents with lifecycle (`open`, `mitigated`, `resolved`).
- Links impacted files using a dependency graph.
- Surfaces probable root causes with confidence and evidence.
- Correlates runtime-like events (for example diagnostics) back to checkpoints/incidents.

## Core Features

- Interactive timeline with checkpoint progression.
- Before/after code pane around risky change locations.
- Root cause analysis (RCA) ranking across related files.
- Incident tracking over multiple saves.
- Runtime event ingestion and correlation.
- Inferred architecture/code-flow visualization.

## Repository Layout

This repository contains the VS Code extension project in a subfolder.

```text
TimeTrace-AI/
	README.md                      # This file
	timetrace-ai/                  # VS Code extension project
		src/                         # Extension backend + analysis engine
			extension.ts               # Activation, orchestration, webview wiring
			ai/                        # Analysis pipeline modules
			test/                      # Test suites
		media/                       # Sidebar webview JS/CSS/assets
		demo-v3-workspace/           # Demo app for live scenarios
		package.json                 # Extension manifest + scripts
		.vscodeignore                # Packaging exclusions
```

## Architecture At A Glance

Save event flow:

1. Extension activates and registers sidebar/commands/listeners.
2. On file save, current and previous snapshots are compared.
3. Analysis engine extracts features and emits findings.
4. Findings are classified into risk state and score.
5. Dependency graph identifies related/impacted files.
6. RCA ranks likely source files with evidence signals.
7. Incident manager opens/updates/resolves incident records.
8. Runtime signals are ingested/correlated and attached.
9. Unified timeline is built and rendered in the sidebar.

Primary modules:

- `src/extension.ts`: orchestration, persistence, UI payloads.
- `src/ai/analyzeChange.ts`: core analysis pipeline.
- `src/ai/featureExtractor.ts`: feature detection from code diffs.
- `src/ai/findingDetector.ts`: maps features to findings.
- `src/ai/classifier.ts`: scoring, state classification, RCA ranking.
- `src/ai/dependencyGraph.ts`: import/export graph + impact traversal.
- `src/ai/incidentManager.ts`: incident lifecycle.
- `src/ai/runtime*`: runtime ingestion, capture, correlation, store.
- `src/ai/timelineBuilder.ts`: unified timeline generation.
- `media/sidebar.js` + `media/sidebar.css`: webview UI.

## Requirements

- macOS, Linux, or Windows.
- Node.js 20+ recommended.
- npm 10+ recommended.
- VS Code compatible with extension engine target (`^1.116.0`).

## Quick Start (Development)

From the repository root:

```bash
cd timetrace-ai
npm install
npm run compile
```

Run extension in development host:

1. Open `timetrace-ai` folder in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. In the new window, open any TypeScript/JavaScript workspace.
4. Open the TimeTrace AI view from the activity bar.

## Extension Commands

Available command IDs:

- `timetrace-ai.openSidebar`
- `timetrace-ai.analyzeCurrentDocument`
- `timetrace-ai.showLatestAnalysis`
- `timetrace-ai.injectTestRuntimeEvent`

You can run them from the VS Code Command Palette.

## Typical Usage Flow

1. Save a file to create/update snapshots.
2. Observe checkpoint and timeline progression.
3. Inspect findings and RCA candidates.
4. Use related/impacted files to navigate blast radius.
5. Review runtime events and incident linkage.
6. Apply fixes and watch incident status move to resolved.

## Demo Workspace

A deterministic demo app is included at:

- `timetrace-ai/demo-v3-workspace`

Recommended demo script:

- `timetrace-ai/demo-v3-workspace/DEMO_SCRIPT.md`

The demo covers:

- null-guard removal,
- optional chaining fallback removal,
- export signature changes,
- diagnostic/runtime correlation,
- loop/performance risk,
- incident lifecycle resolution.

## Scripts

Inside `timetrace-ai`:

- `npm run compile`: compile TypeScript.
- `npm run watch`: watch mode compile.
- `npm run lint`: run ESLint on `src`.
- `npm test`: run extension test suite.
- `npm run pretest`: compile + lint before tests.

## Testing Coverage

Current tests validate:

- analysis pipeline behavior,
- runtime event normalization/correlation,
- diagnostic capture and deduping,
- snapshot and timeline persistence,
- extension payload composition for the code pane.

## Packaging And Publishing

Packaging is controlled by `timetrace-ai/.vscodeignore`.

Notable excluded content includes demo/docs/sandbox assets so the published extension stays lean.

Useful commands (inside `timetrace-ai`):

```bash
npx @vscode/vsce ls
npx @vscode/vsce package
```

Release checklist:

1. Ensure `npm run compile`, `npm run lint`, and tests pass.
2. Verify package contents with `vsce ls`.
3. Bump extension version in `package.json`.
4. Build package and publish via your release process.

## Troubleshooting

- Sidebar appears stale:
	- Run `TimeTrace AI: Show Latest Analysis`.
	- Save the active file again.
- No checkpoints:
	- Confirm file is within an opened workspace and saved.
	- Ensure compile errors are not blocking your demo path assumptions.
- Runtime events not visible:
	- Trigger diagnostics or run `TimeTrace AI: Inject Test Runtime Event`.
- Demo drift/confusion:
	- Reset demo files to baseline and re-run the scripted step order.

## Security And Privacy Notes

- Analysis is local to the workspace context/state used by the extension.
- Runtime signals in current implementation are derived from local event inputs (for example diagnostics/test injections).
- Review source before production deployment in sensitive environments.

## License

This project is licensed under MIT (see extension metadata in `timetrace-ai/package.json`).
