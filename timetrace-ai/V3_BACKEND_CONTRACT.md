# TimeTrace AI V3 Backend Contract

**Version:** V3  
**Status:** Stable for Frontend Integration  
**Last Updated:** 2025-04-18

---

## Overview

This document defines the canonical data contract for the TimeTrace AI V3 analysis engine. It specifies:
- The authoritative result shapes returned by the backend
- V2 backward-compatible vs. V3 new fields
- What the UI *must* consume for V3 functionality
- What's legacy compatibility behavior vs. canonical
- Runtime event integration and timeline publishing

This contract is **implementation-grounded** and reflects the actual backend code in `src/ai/`.

---

## Canonical Entrypoint

### Function
```typescript
export function runTimeTraceAnalysis(
  input: TimeTraceAnalysisInput,
  context?: TimeTraceAnalysisV3Context,
): TimeTraceAnalysisResult
```

**File:** `src/ai/runTimeTraceAnalysis.ts`

**When Called:** Every time a TypeScript/JavaScript file is saved in the workspace.

**Who Calls It:** `extension.ts` → `analyzeDocument()` function

**Inputs:**
- `input: TimeTraceAnalysisInput` — File details (path, language, code before/after)
- `context?: TimeTraceAnalysisV3Context` — Optional runtime/checkpoint/incident context

---

## Canonical Result Contract

### TimeTraceAnalysisResult (Full Shape)

```typescript
export interface TimeTraceAnalysisResult {
  // ---- V2: Backward-compatible fields (MUST keep these) ----
  state: AnalysisState;                           // 'NORMAL' | 'WARNING' | 'ERROR'
  score: number;                                  // 0..100 confidence
  checkpoint: boolean;                            // Did state change?
  previousState: AnalysisState;
  reasons: string[];                              // Why this state?
  analysis: string;                               // Human summary
  changedLineRanges: number[][];                  // Changed lines [[start, end], ...]
  features: FeatureSet;                           // Syntax, null checks, loops, etc.
  findings: Finding[];                            // Detected issues this save
  probableRootCauses: RootCauseCandidate[];      // Ranked root causes (6 signals)
  incidents: Incident[];                          // Open/mitigated/resolved issues
  impactedFiles: string[];                        // Files affected by exports
  relatedFiles: string[];                         // Contextually related files

  // ---- V3: New runtime-aware fields ----
  runtimeEvents: RuntimeEvent[];                  // Enriched runtime events (NEW)
  timelineItems: TimelineItem[];                  // Unified chronological timeline (NEW)
}
```

**Location:** `src/ai/runTimeTraceAnalysis.ts`

---

## V2 Fields (Backward Compatible)

### state: AnalysisState
```typescript
type AnalysisState = 'NORMAL' | 'WARNING' | 'ERROR';
```
- **NORMAL:** No issues detected
- **WARNING:** Minor issues (cosmetic, TODO comments, etc.)
- **ERROR:** Syntax errors, null check removed, logic issue

**Source:** `src/ai/classifier.ts` → `classifyFindings()`

---

### findings: Finding[]
```typescript
interface Finding {
  id: string;                    // Deterministic: `${kind}:${filePath}:${lineRange?.[0]}` 
  kind: FindingKind;             // E.g., 'syntax_error', 'null_check_removed'
  severity: 'error' | 'warning' | 'info';
  message: string;               // User-readable
  evidence: string;              // Why this finding was raised
  confidence: number;            // 0..1
  lineRange?: [number, number];  // [start, end] 1-indexed
  relatedSymbol?: string;        // Function/export name
  filePath: string;
  timestamp: string;             // ISO 8601
}
```

**Source:** `src/ai/findingDetector.ts`

---

### probableRootCauses: RootCauseCandidate[]
```typescript
interface RootCauseCandidate {
  filePath: string;
  relatedSymbol?: string;       // Function/class/export
  confidence: number;           // 0..1, normalized
  signals: string[];            // Transparent ranking factors
}
```

**Ranking Signals (from `src/ai/classifier.ts`):**
1. Same file as findings
2. Findings severity  
3. Recency (saved recently)
4. Downstream impact (exports changed)
5. V3: Runtime event correlation
6. V3: RCA confidence boost from runtime context

**Source:** `src/ai/classifier.ts` → `rankRootCauses()`

---

### incidents: Incident[]
```typescript
interface Incident {
  id: string;                    // Stable ID
  status: 'open' | 'mitigated' | 'resolved';
  title: string;                 // Short description
  openedAt: string;              // ISO 8601 when first detected
  updatedAt: string;
  resolvedAt?: string;
  findings: string[];            // Finding IDs within this incident
  impactedFiles: string[];       // Files affected
  relatedFiles: string[];        // Contextually tied files
  
  // ---- V3 fields (new) ----
  runtimeEventIds?: string[];    // Runtime event IDs linked to this incident
  runtimeConfirmed?: boolean;    // true if any runtime event confirmed it
  lastRuntimeEventAt?: string;   // Most recent linked runtime event timestamp
  runtimeEvidenceCount?: number; // Count of linked runtime events
}
```

**Source:** `src/ai/incidentManager.ts` → `updateIncidents()`

---

## V3 New Fields (Runtime-Aware)

### runtimeEvents: RuntimeEvent[]

**Definition:**
```typescript
interface RuntimeEvent {
  id: string;                           // Deterministic ID
  type: 'RuntimeError' | 'UnhandledRejection' | 'ConsoleError' | 'NetworkFailure';
  message: string;                      // Error message
  stack?: string;                       // Stack trace (V8 format)
  filePath?: string;                    // Where the error originated (best-effort)
  line?: number;                        // Line number
  column?: number;                      // Column number
  functionName?: string;                // Function name (parsed from stack)
  timestamp: string;                    // ISO 8601
  severity: 'warning' | 'error';
  
  // ---- Correlation fields ----
  relatedCheckpointId?: string;         // Linked checkpoint (if correlated)
  relatedIncidentId?: string;           // Linked incident
  relatedFindingIds?: string[];         // Related findings
  evidence?: string[];                  // Human-readable correlation signals
  raw?: Record<string, unknown>;        // Original event data (for debugging)
}
```

**Source:** `src/ai/runtimeTypes.ts` and `src/ai/runtimeIngestion.ts`

**How Runtime Events Are Created:**

1. **Ingestion:** Raw runtime data (error objects, promise rejections, console logs, network failures) is passed to `ingestRuntimeEvent()`.

2. **Normalization:** Stack traces are parsed, file/line/column extracted.

3. **Correlation:** Events are linked to nearby checkpoints (within 5 minutes, same file).

4. **Enrichment:** As incidents are updated, runtime events are linked with confidence scoring.

5. **Timeline:** Events are merged into unified chronological timeline.

**Correlation Heuristics** (from `src/ai/runtimeCorrelation.ts`):
- Same file as checkpoint → +5 points
- Within 0-60s of checkpoint → +4 points
- Within 0-300s of checkpoint → +2 points
- Error occurred after checkpoint → +3 points
- Incidents linked to findings that match error context → +3 points

---

### timelineItems: TimelineItem[]

**Definition:**
```typescript
type TimelineItem = 
  | {
      kind: 'checkpoint';
      checkpointId: string;         // Stable checkpoint ID (timestamp)
      timestamp: string;            // ISO 8601
      filePath: string;
      state: AnalysisState;         // State at this checkpoint
    }
  | {
      kind: 'runtimeEvent';
      runtimeEventId: string;
      timestamp: string;
      filePath?: string;
      eventType: RuntimeEventType;
      message: string;
      severity: 'warning' | 'error';
      relatedCheckpointId?: string; // Which checkpoint is this linked to?
      relatedIncidentId?: string;   // Which incident is this linked to?
    }
  | {
      kind: 'incidentUpdate';
      incidentId: string;
      timestamp: string;
      status: 'open' | 'mitigated' | 'resolved';
      summary: string;              // What changed?
      runtimeConfirmed?: boolean;
    };
```

**Source:** `src/ai/timelineBuilder.ts` → `buildTimelineItems()`

**Ordering:** Sorted chronologically (oldest first). UI can render directly without stitching.

**What This Is:**
- **Canonical V3 timeline source of truth**
- Unified: checkpoints + runtime events + incident state changes
- Ready for UI rendering (chronologically sorted, no joins needed)
- **Preferred over V2 `timelineHistory` for V3 UI builds**

---

## Data Flow & Persistence

### How Runtime Events Enter the System

1. **From Runtime (Future):**
   - Debugger integration, runtime instrumentation, or browser dev tools capture events
   - Events are sent via extension API or WebSocket
   - `ingestRuntimeEvent()` normalizes them
   - `runtimeStore.saveRuntimeEvent()` persists to VS Code workspace state

2. **Testing/Demo (Current):**
   - Command: `timetrace-ai.injectTestRuntimeEvent`
   - Creates a sample runtime error event
   - Saves it to RuntimeStore
   - Triggers re-analysis to show runtime correlation

**Code Location:** `src/extension.ts` → `injectTestRuntimeEventCommand`

---

### How Runtime Events Flow Through Analysis

```
1. extension.ts analyzeDocument()
   ↓
2. Fetch runtime events from RuntimeStore:
   runtimeStore.getEventsByFile(filePath)
   ↓
3. Fetch persisted checkpoints for this file:
   snapshotStore.getTimelineHistory(filePath)
   ↓
4. Pass both to runTimeTraceAnalysis():
   {
     runtimeEvents: [...],
     recentCheckpoints: [...],
     persistedCheckpoints: [...],
     ...existingContextFields
   }
   ↓
5. analyzeChange() step 5:
   - Correlate runtime events to checkpoints
   - Enrich events with relatedCheckpointId + evidence
   ↓
6. analyzeChange() step 6:
   - Link runtime events to incidents
   - updateIncidents() marks incident as runtimeConfirmed if events match
   ↓
7. buildTimelineItems():
   - Merge checkpoints + incidents + runtime events
   - Sort chronologically
   ↓
8. Return TimeTraceAnalysisResult with:
   - runtimeEvents[] (enriched)
   - timelineItems[] (unified, sorted)
   - incidents[] (updated with runtimeConfirmed, runtimeEventIds)
   ↓
9. Persist and publish:
   - runtimeStore.saveRuntimeEvents(result.runtimeEvents)
   - provider.publishAnalysisResult({...result})
   - provider.publishTimeline({timelineItems: ..., ...})
```

---

## Sidebar Compatibility Normalization

**Important:** The sidebar (`media/sidebar.js`) currently uses a compatibility layer that normalizes the canonical shapes.

**This compatibility layer is NOT the source of truth.**

The sidebar normalizes:
- `RootCauseCandidate.signals[]` → reason string (only for display)
- `Finding.lineRanges` → sidebar internal format
- `Incident` → `timelineTrail` synthesis

**For V3 UI builds (Person 2's task):**
- Consume `timelineItems` directly (canonical, already sorted)
- Consume `runtimeEvents` directly (with all enrichment)
- Use `signals[]` from `probableRootCauses` (transparent ranking)
- Do NOT rely on sidebar compatibility normalization—consider it **legacy**

---

## Extension Publication

### What Gets Published to Sidebar

**Message Type 1: historyUpdate**
```typescript
{
  type: 'historyUpdate',
  payload: {
    filePath: string;
    timelineHistory: TimelineCheckpointRecord[];      // V2 checkpoints (for backward compat)
    timelineItems?: TimelineItem[];                   // V3 new (canonical)
  }
}
```

**Message Type 2: analysisResult**
```typescript
{
  type: 'analysisResult',
  payload: SidebarAnalysisPayload  // = TimeTraceAnalysisResult + filePath
}
```

The `SidebarAnalysisPayload` includes:
- All V2 fields (backward compatible)
- `runtimeEvents[]` (V3)
- `timelineItems[]` (V3)

**Code Location:** `src/extension.ts` → `TimeTraceSidebarProvider`

---

## What Changed in V3 vs V2

| Aspect | V2 | V3 |
|--------|----|----|
| **Analysis entrypoint** | `analyzeChange()` | `runTimeTraceAnalysis()` (wraps analyzeChange) |
| **Runtime events** | ❌ None | ✅ Ingestion, storage, correlation |
| **Incident enrichment** | ❌ Findings-based | ✅ + Runtime event linkage + confirmation |
| **RCA ranking** | ✅ 4 signals | ✅ 6 signals (+ 2 runtime-aware) |
| **Timeline** | timeline checkpoint records | timeline checkpoints + incidents + runtime events (unified) |
| **Storage** | SnapshotStore | SnapshotStore + RuntimeStore |
| **UI timeline source** | `timelineHistory` (V2 checkpoints) | `timelineItems` (V3 unified, canonical) |

---

## Remaining Limitations & Future Work

### Current Limitations

1. **Runtime Event Ingestion:**
   - ❌ No automatic capture from running app
   - ✅ Manual test command available (`injectTestRuntimeEvent`)
   - Future: Real capture via debugger protocol or instrumentation

2. **Sidebar UI:**
   - ⚠️ Still rendering `timelineHistory` (V2)
   - ✅ Data is available: `runtimeEvents`, `timelineItems` sent in messages
   - Future: UI migration to render V3 timeline (Person 2's task)

3. **Timeline Rendering:**
   - 👤 V3 data exists in backend but sidebar hasn't been refactored yet
   - Sidebar compatibility layer still active

### Future Enhancements

- [ ] Real runtime event capture (debugger, instrumentation)
- [ ] UI rendering of V3 `timelineItems` (Person 2)
- [ ] V3-first incident correlation UI
- [ ] Runtime event drilling (click event → see checkpoint + code)
- [ ] Export runtime timeline for CI/CD integration

---

## Testing V3 Integration

### Test Steps

1. Open a TypeScript/JavaScript file in the extension
2. Save it to create a baseline
3. Run command: `TimeTrace AI: Inject Test Runtime Event`
4. Inspect output channel for `[V3]` messages
5. Open latest analysis JSON: `TimeTrace AI: Show Latest Analysis`
6. Verify result contains:
   - `runtimeEvents: [...]` (not empty)
   - `timelineItems: [...]` (includes incident + runtime event items)
   - `incidents[0].runtimeConfirmed: true` (if incident matches event)

### Key Assertions

- ✅ `runtimeEvents` array is populated
- ✅ `runtimeEvents[0].relatedCheckpointId` is set (correlation worked)
- ✅ `runtimeEvents[0].evidence[]` contains correlation signals
- ✅ `timelineItems` includes both checkpoints and runtimeEvent items
- ✅ `incidents[0].runtimeEventIds` links the incident to runtime events

---

## Related Files

| File | Purpose |
|------|---------|
| `src/ai/runtimeTypes.ts` | V3 schema: RuntimeEvent, TimelineItem |
| `src/ai/runtimeIngestion.ts` | Raw → RuntimeEvent normalization |
| `src/ai/runtimeStore.ts` | RuntimeEvent persistence (VS Code memento) |
| `src/ai/runtimeCorrelation.ts` | Linking runtime events to checkpoints/incidents |
| `src/ai/timelineBuilder.ts` | Building unified TimelineItem[] |
| `src/ai/runTimeTraceAnalysis.ts` | Canonical entrypoint + result contract |
| `src/ai/analyzeChange.ts` | 6-step pipeline (unchanged, enhanced) |
| `src/ai/incidentManager.ts` | Incident creation (now with runtime event enrichment) |
| `src/extension.ts` | Extension orchestration (now wires V3 context) |

---

## Contact & Questions

For details on specific signals or behavior, refer to the source code and test suite:
- `src/test/runtime.test.ts` — V3 test cases
- `src/ai/runtimeCorrelation.ts` — Correlation heuristics
- `src/ai/incidentManager.ts` — Incident enrichment logic

---

**End of Contract Document**
