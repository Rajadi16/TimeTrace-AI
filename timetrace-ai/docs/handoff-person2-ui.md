# Person 2 UI Handoff (Sidebar/Timeline)

This handoff maps UI behavior to the currently implemented runtime contract.

## Canonical payload to consume

Use output from `runTimeTraceAnalysis` in [src/ai/runTimeTraceAnalysis.ts](../src/ai/runTimeTraceAnalysis.ts).

Required top-level fields:
- `schemaVersion`
- `checkpointId`
- `state`
- `score`
- `checkpoint`
- `analysis`
- `reasons`
- `changedLineRanges`
- `findings`
- `probableRootCauses`
- `incidents`
- `impactedFiles`
- `relatedFiles`

## Exact field-to-UI mapping

Severity/header strip:
- badge color and label from `state`
- numeric indicator from `score`
- transition copy from `previousState` + `analysis`

Code highlight panel:
- use `changedLineRanges`

Findings list (main V2 panel):
- list each `findings[]` item
- show `type`, `severity`, `message`
- expandable details: `evidence`, `relatedSymbol`, `confidence`, `filePath`, `timestamp`
- group by `filePath` first, then severity descending

Incident panel:
- render each `incidents[]` item as a card/story
- title from `incidentId` or `summary`
- status chip from `status`
- surfaced context from `surfacedFile` + `surfacedCheckpointId`
- timeline from `timelineTrail` events (`timestamp`, `state`, `note`)

Root-cause panel:
- render `probableRootCauses[]` as ranked rows
- show `filePath`, `reason`, `confidence`
- optionally show `relatedSymbol`
- allow jump to supporting findings via `supportingFindingIds`

## How to render multiple findings correctly

- Never assume one finding per checkpoint.
- Never collapse to only `analysis`/`reasons`.
- Treat `findings[]` as primary issue inventory.
- Allow mixed severity and mixed filePath values in one result.

## relatedFiles vs impactedFiles

- `impactedFiles`: direct dependents of the changed file, dependency-risk oriented subset.
- `relatedFiles`: broader correlated set for this checkpoint (surfaced file + impacted files + root-cause candidate files).

UI guidance:
- show `impactedFiles` as "Potentially impacted dependents".
- show `relatedFiles` as "Incident context files".

## What not to rely on

- Do not rely on top-level `confidence` (not present in runtime result).
- Do not infer severity from raw `features`; use `findings` and `state`.
- Do not assume incident ids represent full cross-file clustering.
- Do not assume graph includes package/non-relative imports.

## Compatibility behavior to keep

Current commands and existing panels may still use:
- `state`, `score`, `checkpoint`, `analysis`, `reasons`, `changedLineRanges`, `features`

When adding V2 UI sections, keep old sections functional until migration is complete.
