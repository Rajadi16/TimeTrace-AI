import { analyzeChange } from './analyzeChange';
import type {
	AnalyzeChangeInput,
	AnalysisState,
	FeatureSet,
	FileContextItem,
	IncidentRecord,
	ProbableRootCause,
	StructuredFinding,
} from './types';

/**
 * Canonical UI/integration entrypoint.
 *
 * Example:
 * const result = runTimeTraceAnalysis({
 *   filePath,
 *   language,
 *   timestamp: new Date().toISOString(),
 *   previousCode,
 *   currentCode,
 *   previousState,
 * });
 *
 * Use:
 * - state for the severity badge
 * - checkpoint for timeline markers
 * - analysis + reasons for the explanation panel
 * - changedLineRanges for code highlighting
 * - features only for optional debug/details
 */
export interface TimeTraceAnalysisInput extends AnalyzeChangeInput {
	previousState?: AnalysisState;
}

export interface TimeTraceAnalysisResult {
	state: AnalysisState;
	score: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	changedLineRanges: number[][];
	features: FeatureSet;
	findings: StructuredFinding[];
	probableRootCauses: ProbableRootCause[];
	relatedFiles: FileContextItem[];
	impactedFiles: FileContextItem[];
	incidents: IncidentRecord[];
}

export function runTimeTraceAnalysis(input: TimeTraceAnalysisInput): TimeTraceAnalysisResult {
	const { confidence: _confidence, ...uiResult } = analyzeChange(input);
	return uiResult;
}