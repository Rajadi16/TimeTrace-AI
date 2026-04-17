export type AnalysisState = 'NORMAL' | 'WARNING' | 'ERROR';
export type FindingSeverity = 'INFO' | 'WARNING' | 'ERROR';
export type IncidentStatus = 'OPEN' | 'WATCHING' | 'RESOLVED';

export interface StructuredFinding {
	id: string;
	message: string;
	severity: FindingSeverity;
	confidence: number;
	lineRanges: number[][];
	symbol?: string;
}

export interface ProbableRootCause {
	id: string;
	filePath: string;
	reason: string;
	confidence: number;
	linkedEvidence: string[];
}

export interface FileContextItem {
	filePath: string;
	reason: string;
}

export interface TimelineTrailPoint {
	timestamp: string;
	state: AnalysisState;
	checkpoint: boolean;
	score: number;
	label: string;
}

export interface IncidentRecord {
	id: string;
	summary: string;
	status: IncidentStatus;
	timelineTrail: TimelineTrailPoint[];
	surfacedFile: string;
	linkedFindings: string[];
	probableCauses: string[];
}

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

export interface StructuredAnalysisOutput {
	findings: StructuredFinding[];
	probableRootCauses: ProbableRootCause[];
	relatedFiles: FileContextItem[];
	impactedFiles: FileContextItem[];
	incidents: IncidentRecord[];
}

export interface AnalyzeChangeOutput extends StructuredAnalysisOutput {
	state: AnalysisState;
	score: number;
	confidence?: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	features: FeatureSet;
	changedLineRanges: number[][];
}