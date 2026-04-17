# TimeTrace AI V2 Core Schema Spec

This document reflects the currently implemented backend contracts.

## Canonical runtime contract

Use `runTimeTraceAnalysis` from [src/ai/runTimeTraceAnalysis.ts](../src/ai/runTimeTraceAnalysis.ts).

Output type: `TimeTraceAnalysisResult`

Fields:
- `schemaVersion: '2.0'` - schema marker for consumers.
- `checkpointId: string` - deterministic checkpoint id generated per analysis run.
- `state: 'NORMAL' | 'WARNING' | 'ERROR'` - aggregate file risk state.
- `score: number` - aggregate weighted score from all findings.
- `checkpoint: boolean` - true when `previousState !== state`.
- `previousState` - previous file state used for transition logic.
- `reasons: string[]` - surfaced-file reason strings derived from findings.
- `analysis: string` - summary sentence for human-facing explanation.
- `changedLineRanges: number[][]` - changed line ranges from diff detector.
- `features: FeatureSet` - deterministic feature extraction output, debug/details oriented.
- `findings: Finding[]` - atomic findings, can include multiple entries per analysis.
- `impactedFiles: string[]` - direct dependents of changed file when export changes are detected.
- `relatedFiles: string[]` - surfaced file + impacted files + root-cause candidate files.
- `probableRootCauses: RootCauseCandidate[]` - ranked candidate causes.
- `incidents: Incident[]` - incident timeline/state set returned after incident update.

Note:
- `confidence` exists in internal `AnalyzeChangeOutput` but is intentionally stripped in `TimeTraceAnalysisResult`.

## Finding

Type: `Finding` in [src/ai/types.ts](../src/ai/types.ts).

Fields:
- `id` - deterministic per-finding id.
- `type` - one of:
  - `SyntaxFailure`
  - `SemanticDiagnostic`
  - `RemovedNullGuard`
  - `RemovedOptionalChaining`
  - `RemovedFallback`
  - `RemovedTryCatch`
  - `IncreasedNesting`
  - `AddedLoopRisk`
  - `AddedTodoHack`
  - `ChangedExportSignature`
  - `DownstreamDependencyRisk`
- `severity` - `LOW | MEDIUM | HIGH`.
- `confidence` - deterministic confidence score for this finding.
- `filePath` - file where the finding is attached.
- `changedLineRanges` - line ranges relevant to this finding.
- `message` - short explanation.
- `evidence` - supporting evidence list.
- `relatedSymbol` - optional symbol name where relevant.
- `timestamp` - checkpoint timestamp.

## RootCauseCandidate

Type: `RootCauseCandidate` in [src/ai/types.ts](../src/ai/types.ts).

Fields:
- `filePath` - candidate root file.
- `relatedSymbol` - optional upstream symbol hint.
- `reason` - why this file is a candidate.
- `confidence` - deterministic confidence used for ranking.
- `supportingFindingIds` - evidence links to finding ids.

Ranking behavior (implemented):
- Local top-severity surfaced-file finding is always considered.
- Upstream imported files are added when surfaced file has symptom findings and upstream history includes `ChangedExportSignature`.
- Upstream confidence is boosted by temporal proximity.
- Final list is sorted descending by confidence and capped to 5.

## Incident

Type: `Incident` in [src/ai/types.ts](../src/ai/types.ts), updated in [src/ai/incidentEngine.ts](../src/ai/incidentEngine.ts).

Fields:
- `incidentId` - deterministic id derived from surfaced file path.
- `status` - `open | mitigated | resolved`.
- `surfacedFile` - primary surfaced file.
- `surfacedCheckpointId` - latest checkpoint id where incident was touched.
- `linkedFindingIds` - cumulative finding ids associated to incident.
- `probableRootCauses` - current ranked candidate list.
- `relatedFiles` - correlated file set.
- `timelineTrail` - ordered history events with checkpoint/state/note.
- `summary` - latest incident summary text.

Lifecycle meaning (current behavior):
- `open`: current analysis has findings and `state !== NORMAL`.
- `mitigated`: current analysis has findings but `state === NORMAL`.
- `resolved`: current analysis has no findings and an existing incident for surfaced file exists.

## Workspace graph

Types: `WorkspaceDependencyGraph` and `WorkspaceDependencyNode` in [src/ai/types.ts](../src/ai/types.ts), built in [src/ai/workspaceGraph.ts](../src/ai/workspaceGraph.ts).

Node fields:
- `filePath`
- `imports` - resolved workspace-relative file imports (relative imports only).
- `exports` - parsed exported symbol names.
- `directDependents` - reverse edges populated from imports.

Graph fields:
- `generatedAt`
- `files: Record<string, WorkspaceDependencyNode>`

## Authoritative vs compatibility fields

Authoritative V2 fields for new consumers:
- `schemaVersion`
- `checkpointId`
- `findings`
- `probableRootCauses`
- `incidents`
- `impactedFiles`
- `relatedFiles`

Compatibility fields retained for existing UI/commands:
- `state`
- `score`
- `checkpoint`
- `previousState`
- `reasons`
- `analysis`
- `changedLineRanges`
- `features`

## Known current limitations (actual implementation)

- Dependency graph resolves relative imports only; package imports are not linked.
- Export change detection is signature-text comparison, not full TS type-checker semantic diff.
- Incident identity is file-derived, so cross-file incident clustering is intentionally simple.
- `incidents` are returned in runtime output but not part of internal `AnalyzeChangeOutput` type.
- `TimeTraceAnalysisResult` strips top-level `confidence`; use per-finding/root-cause confidence values.
