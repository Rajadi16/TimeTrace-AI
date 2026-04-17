import { analyzeChange } from './analyzeChange';
import { updateIncidents } from './incidentEngine';
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
	existingIncidents?: Incident[];
}

export interface TimeTraceAnalysisResult {
	schemaVersion: '2.0';
	checkpointId: string;
	state: AnalysisState;
	score: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	changedLineRanges: number[][];
	features: FeatureSet;
	findings: Finding[];
	impactedFiles: string[];
	relatedFiles: string[];
	probableRootCauses: RootCauseCandidate[];
	incidents: Incident[];
}

export function runTimeTraceAnalysis(input: TimeTraceAnalysisInput): TimeTraceAnalysisResult {
	const { confidence: _confidence, ...analysis } = analyzeChange(input);
	const incidents = updateIncidents(input.existingIncidents ?? [], analysis);
	return {
		...analysis,
		incidents,
	};
}