export type AnalysisState = 'NORMAL' | 'WARNING' | 'ERROR';

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
}