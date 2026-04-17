# TimeTrace AI Integration Handoff

Use the canonical UI-facing entrypoint:

`runTimeTraceAnalysis`

Import it from the AI barrel:

```ts
import { runTimeTraceAnalysis } from '../ai';
```

Call it when a document is saved, or when the UI needs to re-evaluate a replayed diff. Do not invent a second checkpoint rule or re-derive state from `features`.

## Input

Pass the current and previous snapshot data:

```ts
runTimeTraceAnalysis({
	filePath,
	language,
	timestamp: new Date().toISOString(),
	previousCode,
	currentCode,
	previousState,
});
```

## Output

The returned object is the stable UI contract:

- `state` drives the severity badge
- `score` is the numeric risk score
- `checkpoint` decides whether a timeline marker exists
- `previousState` shows the prior classification
- `reasons` are short human-readable cause strings
- `analysis` is the primary explanation sentence
- `changedLineRanges` drive code highlighting
- `features` are optional debug/detail data only

## Tiny example

```ts
import { runTimeTraceAnalysis } from '../ai';

const result = runTimeTraceAnalysis({
	filePath: document.uri.fsPath,
	language: document.languageId,
	timestamp: new Date().toISOString(),
	previousCode,
	currentCode: document.getText(),
	previousState,
});

renderSeverityBadge(result.state);

if (result.checkpoint) {
	createTimelineMarker(result);
}

renderExplanation(result.analysis, result.reasons);
highlightChangedLines(result.changedLineRanges);
showDebugDetails(result.features);
```

## What not to do

- Do not re-run your own checkpoint logic.
- Do not infer severity from `features`.
- Do not ignore `state`, `checkpoint`, or `analysis`.
- Do not treat `features` as required UI logic.
- Do not fork the public contract; use the fields as returned.