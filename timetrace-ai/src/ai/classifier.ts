import type { AnalysisState, FeatureSet } from './types';

export interface ClassificationResult {
	state: AnalysisState;
	score: number;
	confidence: number;
	reasons: string[];
}

const NORMAL_THRESHOLD = 2;
const WARNING_THRESHOLD = 6;

export function classifyFeatures(features: FeatureSet): ClassificationResult {
	const reasons: string[] = [];
	let score = 0;

	if (features.syntaxFailure) {
		score += 8;
		reasons.push('a syntax issue was introduced');
	}

	if (features.undefinedIdentifierDetected) {
		score += 6;
		reasons.push('a likely undefined identifier was introduced');
	}

	if (features.nullCheckRemoved) {
		score += 4;
		reasons.push('a null safety check was removed');
	}

	if (features.tryCatchRemoved) {
		score += 4;
		reasons.push('a try/catch guard was removed');
	}

	if (features.heavyLoopAdded) {
		score += 3;
		reasons.push('a heavier loop or repeated execution path was added');
	}

	if (features.complexityDelta > 0) {
		score += features.complexityDelta;
		reasons.push(`branching complexity increased by ${features.complexityDelta}`);
	}

	if (features.todoHackCommentAdded) {
		score += 1;
		reasons.push('a TODO, FIXME, or HACK comment was added');
	}

	let state: AnalysisState = 'NORMAL';
	if (score > WARNING_THRESHOLD) {
		state = 'ERROR';
	} else if (score > NORMAL_THRESHOLD) {
		state = 'WARNING';
	}

	const confidence = Math.max(0.45, Math.min(0.98, 0.5 + (score / 18) + (reasons.length * 0.03)));

	return {
		state,
		score,
		confidence: Number(confidence.toFixed(2)),
		reasons,
	};
}