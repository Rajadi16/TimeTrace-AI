import { buildAnalysisSummary } from './analysisGenerator';
import { classifyFeatures } from './classifier';
import { computeChangedLineRanges } from './changeDetector';
import { extractFeatures } from './featureExtractor';
import type { AnalyzeChangeInput, AnalyzeChangeOutput, AnalysisState } from './types';

function normalizeState(previousState?: AnalysisState): AnalysisState {
	return previousState ?? 'NORMAL';
}

function computeCheckpoint(previousState: AnalysisState, nextState: AnalysisState): boolean {
	return previousState !== nextState;
}

export function analyzeChange(input: AnalyzeChangeInput): AnalyzeChangeOutput {
	const previousState = normalizeState(input.previousState);
	const features = extractFeatures({
		language: input.language,
		previousCode: input.previousCode,
		currentCode: input.currentCode,
	});
	const classification = classifyFeatures(features);
	const changedLineRanges = input.changedLineRanges ?? computeChangedLineRanges(input.previousCode, input.currentCode);
	const checkpoint = computeCheckpoint(previousState, classification.state);
	const analysis = buildAnalysisSummary({
		previousState,
		state: classification.state,
		checkpoint,
		reasons: classification.reasons,
		score: classification.score,
	});

	return {
		state: classification.state,
		score: classification.score,
		confidence: classification.confidence,
		checkpoint,
		previousState,
		reasons: classification.reasons,
		analysis,
		features,
		changedLineRanges,
	};
}