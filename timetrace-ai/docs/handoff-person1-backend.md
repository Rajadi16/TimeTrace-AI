# Person 1 Backend Handoff (Workspace Intelligence)

This handoff is grounded in the current implementation.

## Your scope

You own:
- workspace dependency graph quality
- incident lifecycle correctness
- root-cause candidate ranking quality
- persistence shape stability for backend outputs

Primary code paths:
- [src/extension.ts](../src/extension.ts)
- [src/ai/workspaceGraph.ts](../src/ai/workspaceGraph.ts)
- [src/ai/analyzeChange.ts](../src/ai/analyzeChange.ts)
- [src/ai/incidentEngine.ts](../src/ai/incidentEngine.ts)
- [src/ai/snapshotStore.ts](../src/ai/snapshotStore.ts)

## Authoritative fields you should preserve

Treat these as source-of-truth V2 outputs:
- `schemaVersion`
- `checkpointId`
- `findings`
- `probableRootCauses`
- `incidents`
- `impactedFiles`
- `relatedFiles`

Do not remove compatibility fields used by current flows:
- `state`, `score`, `checkpoint`, `previousState`, `reasons`, `analysis`, `changedLineRanges`, `features`

## Current incident lifecycle rules

Implemented in [src/ai/incidentEngine.ts](../src/ai/incidentEngine.ts):
- If findings exist and `state !== NORMAL`: status becomes `open`.
- If findings exist and `state === NORMAL`: status becomes `mitigated`.
- If no findings for an existing incident id: status becomes `resolved` and a resolving timeline event is appended.
- Incident id is derived from surfaced file path (`incident_<sanitized-file-suffix>`).

Implication:
- Incident grouping is currently per surfaced file, not global cross-file clustering.

## Current root-cause ranking rules

Implemented in [src/ai/analyzeChange.ts](../src/ai/analyzeChange.ts):
- Candidate 1: top local surfaced-file finding by severity.
- Additional candidates: upstream imports when surfaced file shows a symptom (`SyntaxFailure` or `SemanticDiagnostic`) and upstream history has `ChangedExportSignature`.
- Temporal boost: stronger confidence for recent upstream events.
- Output sorted descending confidence and capped to 5.

## Dependency impact meaning

- `ChangedExportSignature` finding is emitted on the changed file when export signatures differ.
- `impactedFiles` is populated from graph `directDependents`.
- `DownstreamDependencyRisk` findings are added for each impacted dependent file.
- `relatedFiles` combines surfaced file + impacted files + root-cause candidate file paths.

## What not to break

- Keep `runTimeTraceAnalysis` as the canonical contract surface.
- Keep deterministic, explainable scoring/ranking behavior.
- Keep snapshot + latest analysis + incidents persistence backward compatible.
- Keep `saveTimelineCheckpoint` and `getTimelineHistory` in `SnapshotStore` (legacy compatibility).
- Keep compile/lint/tests green.

## Practical next backend increments

- Improve import resolution beyond relative paths (without changing output field names).
- Strengthen exported-shape change detection while preserving finding type names.
- Add optional richer incident correlation keys, but do not remove current file-derived incident ids until UI is migrated.
