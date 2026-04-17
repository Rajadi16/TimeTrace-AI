export type AnalysisState = 'NORMAL' | 'WARNING' | 'ERROR';

// ---------------------------------------------------------------------------
// Finding — one discrete issue detected in a single file save
// ---------------------------------------------------------------------------

export type FindingKind =
	| 'syntax_error'
	| 'undefined_identifier'
	| 'null_check_removed'
	| 'try_catch_removed'
	| 'heavy_loop_added'
	| 'complexity_spike'
	| 'todo_hack_comment'
	| 'export_signature_changed'
	| 'downstream_impact';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
	/** Deterministic id: `${kind}:${filePath}:${lineRange?.[0] ?? 0}` */
	id: string;
	kind: FindingKind;
	severity: FindingSeverity;
	message: string;
	/** Human-readable explanation of why this finding was raised */
	evidence: string;
	/** 0..1 confidence that this is a real issue */
	confidence: number;
	lineRange?: [number, number];
	/** Exported name / function / variable most related to this finding */
	relatedSymbol?: string;
	filePath: string;
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Incident — a persistent issue that spans multiple saves
// ---------------------------------------------------------------------------

export type IncidentStatus = 'open' | 'mitigated' | 'resolved';

export interface Incident {
	id: string;
	status: IncidentStatus;
	title: string;
	openedAt: string;
	updatedAt: string;
	resolvedAt?: string;
	/** Finding ids that are currently supporting this incident */
	findings: string[];
	/** Files that may be affected by this incident */
	impactedFiles: string[];
	/** Files contextually tied to this analysis/incident */
	relatedFiles: string[];
	// ---- V3 runtime-awareness fields ----
	/** Runtime event ids linked to this incident */
	runtimeEventIds?: string[];
	/** True if any runtime event has confirmed this incident */
	runtimeConfirmed?: boolean;
	/** ISO timestamp of the most recent linked runtime event */
	lastRuntimeEventAt?: string;
	/** Count of linked runtime events */
	runtimeEvidenceCount?: number;
}


// ---------------------------------------------------------------------------
// RootCauseCandidate — ranked, not certain
// ---------------------------------------------------------------------------

export interface RootCauseCandidate {
	filePath: string;
	relatedSymbol?: string;
	/** 0..1 normalized confidence */
	confidence: number;
	/** Transparent signals driving the ranking */
	signals: string[];
}

// ---------------------------------------------------------------------------
// Feature extraction types (extended)
// ---------------------------------------------------------------------------

export interface AnalyzeChangeInput {
	filePath: string;
	language: string;
	timestamp: string;
	previousCode: string;
	currentCode: string;
	changedLineRanges?: number[][];
	previousState?: AnalysisState;
}

export interface FeatureSet {
	syntaxFailure: boolean;
	undefinedIdentifierDetected: boolean;
	nullCheckRemoved: boolean;
	tryCatchRemoved: boolean;
	heavyLoopAdded: boolean;
	complexityDelta: number;
	todoHackCommentAdded: boolean;
	/** True when all changes are whitespace / comment only — suppress checkpoint noise */
	cosmetic: boolean;
	/** AST-extracted names that appeared in changed line ranges */
	changedSymbols: string[];
	/** Exported names whose signature changed between previous and current code */
	exportedNamesChanged: string[];
	/** Line ranges attributed to specific feature flags */
	featureLineRanges: Partial<Record<FindingKind, [number, number]>>;
	currentMetrics: {
		complexity: number;
		guardCount: number;
		tryCatchCount: number;
		loopCount: number;
		todoCommentCount: number;
	};
	previousMetrics: {
		complexity: number;
		guardCount: number;
		tryCatchCount: number;
		loopCount: number;
		todoCommentCount: number;
	};
}

export interface AnalyzeChangeOutput {
	state: AnalysisState;
	score: number;
	confidence?: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	features: FeatureSet;
	changedLineRanges: number[][];
	findings: Finding[];
	probableRootCauses: RootCauseCandidate[];
	incidents: Incident[];
	impactedFiles: string[];
	relatedFiles: string[];
	/** V3: runtime events (possibly enriched with correlation linkage) */
	runtimeEvents?: import('./runtimeTypes').RuntimeEvent[];
}