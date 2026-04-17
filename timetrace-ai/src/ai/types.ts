export type AnalysisState = 'NORMAL' | 'WARNING' | 'ERROR';

export type FindingType =
	| 'SyntaxFailure'
	| 'SemanticDiagnostic'
	| 'RemovedNullGuard'
	| 'RemovedOptionalChaining'
	| 'RemovedFallback'
	| 'RemovedTryCatch'
	| 'IncreasedNesting'
	| 'AddedLoopRisk'
	| 'AddedTodoHack'
	| 'ChangedExportSignature'
	| 'DownstreamDependencyRisk';

export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Finding {
	id: string;
	type: FindingType;
	severity: FindingSeverity;
	confidence: number;
	filePath: string;
	changedLineRanges: number[][];
	message: string;
	evidence: string[];
	relatedSymbol?: string;
	timestamp: string;
}

export type IncidentStatus = 'open' | 'mitigated' | 'resolved';

export interface RootCauseCandidate {
	filePath: string;
	relatedSymbol?: string;
	reason: string;
	confidence: number;
	supportingFindingIds: string[];
}

export interface IncidentTimelineEvent {
	timestamp: string;
	filePath: string;
	checkpointId: string;
	state: AnalysisState;
	linkedFindingIds: string[];
	note: string;
}

export interface Incident {
	incidentId: string;
	status: IncidentStatus;
	surfacedFile: string;
	surfacedCheckpointId: string;
	linkedFindingIds: string[];
	probableRootCauses: RootCauseCandidate[];
	relatedFiles: string[];
	timelineTrail: IncidentTimelineEvent[];
	summary: string;
}

export interface WorkspaceDependencyNode {
	filePath: string;
	imports: string[];
	exports: string[];
	directDependents: string[];
}

export interface WorkspaceDependencyGraph {
	generatedAt: string;
	files: Record<string, WorkspaceDependencyNode>;
}

export interface HistoricalAnalysisSummary {
	filePath: string;
	timestamp: string;
	checkpointId: string;
	state: AnalysisState;
	findings: Finding[];
}

export interface WorkspaceFileSnapshot {
	filePath: string;
	language: string;
	code: string;
}

export interface AnalyzeChangeInput {
	filePath: string;
	language: string;
	timestamp: string;
	previousCode: string;
	currentCode: string;
	changedLineRanges?: number[][];
	previousState?: AnalysisState;
	workspaceGraph?: WorkspaceDependencyGraph;
	knownAnalysesByFile?: Record<string, HistoricalAnalysisSummary>;
}

export interface FeatureSet {
	syntaxFailure: boolean;
	undefinedIdentifierDetected: boolean;
	nullCheckRemoved: boolean;
	optionalChainingRemoved: boolean;
	fallbackRemoved: boolean;
	tryCatchRemoved: boolean;
	heavyLoopAdded: boolean;
	complexityDelta: number;
	todoHackCommentAdded: boolean;
	exportSignatureChanged: boolean;
	currentMetrics: {
		complexity: number;
		guardCount: number;
		optionalChainCount: number;
		fallbackCount: number;
		tryCatchCount: number;
		loopCount: number;
		todoCommentCount: number;
	};
	previousMetrics: {
		complexity: number;
		guardCount: number;
		optionalChainCount: number;
		fallbackCount: number;
		tryCatchCount: number;
		loopCount: number;
		todoCommentCount: number;
 	};
}

export interface AnalyzeChangeOutput {
	schemaVersion: '2.0';
	checkpointId: string;
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
	impactedFiles: string[];
	relatedFiles: string[];
	probableRootCauses: RootCauseCandidate[];
}