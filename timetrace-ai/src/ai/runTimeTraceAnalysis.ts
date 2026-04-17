import { analyzeChange, type AnalyzeChangeContext } from './analyzeChange';
import type { AnalyzeChangeInput, AnalysisState, FeatureSet, Finding, Incident, RootCauseCandidate } from './types';

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
 * }, context);
 *
 * Use:
 * - state / score / checkpoint / reasons / analysis  → backward-compatible UI fields
 * - findings                                         → structured per-issue details
 * - probableRootCauses                               → ranked, not certain
 * - incidents                                        → persistent lifecycle tracking
 * - impactedFiles / relatedFiles                     → dependency-aware impact
 * - changedLineRanges                                → code highlighting
 * - features                                         → optional debug/details
 */
export interface TimeTraceAnalysisInput extends AnalyzeChangeInput {
	previousState?: AnalysisState;
}

export interface TimeTraceAnalysisResult {
	// ---- Backward-compatible fields (do not remove or rename) ----
	state: AnalysisState;
	score: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	changedLineRanges: number[][];
	features: FeatureSet;
	// ---- New structured fields ----
	findings: Finding[];
	probableRootCauses: RootCauseCandidate[];
	incidents: Incident[];
	impactedFiles: string[];
	relatedFiles: string[];
}

export function runTimeTraceAnalysis(
	input: TimeTraceAnalysisInput,
	context?: AnalyzeChangeContext,
): TimeTraceAnalysisResult {
	const { confidence: _confidence, ...uiResult } = analyzeChange(input, context);
	return uiResult;
}