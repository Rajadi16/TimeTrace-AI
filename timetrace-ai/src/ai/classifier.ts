import type { AnalysisState, FeatureSet, Finding, RootCauseCandidate } from './types';
import type { RuntimeEvent } from './runtimeTypes';
import { computeRuntimeRcaBoosts } from './runtimeCorrelation';

export interface ClassificationResult {
	state: AnalysisState;
	score: number;
	confidence: number;
	reasons: string[];
}

// ---------------------------------------------------------------------------
// Derive state and score from findings (not from raw feature booleans)
// ---------------------------------------------------------------------------

const SEVERITY_SCORE: Record<Finding['severity'], number> = {
	error: 8,
	warning: 4,
	info: 1,
};

export function classifyFindings(findings: Finding[]): ClassificationResult {
	if (!findings.length) {
		return { state: 'NORMAL', score: 0, confidence: 0.45, reasons: [] };
	}

	let score = 0;
	const reasons: string[] = [];

	for (const f of findings) {
		score += SEVERITY_SCORE[f.severity] * f.confidence;
		reasons.push(f.evidence);
	}

	score = Math.round(score);

	let state: AnalysisState = 'NORMAL';
	if (findings.some((f) => f.severity === 'error')) {
		state = 'ERROR';
	} else if (findings.some((f) => f.severity === 'warning')) {
		state = 'WARNING';
	}

	const confidence = Math.max(0.45, Math.min(0.98, 0.5 + (score / 24) + (findings.length * 0.03)));

	return {
		state,
		score,
		confidence: Number(confidence.toFixed(2)),
		reasons,
	};
}

// ---------------------------------------------------------------------------
// Backward-compat: feature-based classification (kept for tests that call it)
// ---------------------------------------------------------------------------

const NORMAL_THRESHOLD = 2;
const WARNING_THRESHOLD = 6;

export function classifyFeatures(features: FeatureSet): ClassificationResult {
	if (features.cosmetic) {
		return { state: 'NORMAL', score: 0, confidence: 0.45, reasons: [] };
	}

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
	if (features.complexityDelta > 3) {
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

	return { state, score, confidence: Number(confidence.toFixed(2)), reasons };
}

// ---------------------------------------------------------------------------
// Root-cause ranking
// ---------------------------------------------------------------------------

interface RootCauseInput {
	filePath: string;
	findings: Finding[];
	allFindings: Finding[];
	downstreamFiles: string[];
	saveTimestamp: number;
	recentSaves: Record<string, number>;
	/** Optional runtime events for V3 reranking */
	runtimeEvents?: RuntimeEvent[];
}

interface ScoredCandidate {
	filePath: string;
	rawScore: number;
	signals: string[];
}

export function rankRootCauses(inputs: RootCauseInput[]): RootCauseCandidate[] {
	const allRuntimeEvents = inputs.flatMap((i) => i.runtimeEvents ?? []);
	const allFindings = inputs.flatMap((i) => i.allFindings);

	const candidates: ScoredCandidate[] = inputs.map((input): ScoredCandidate => {
		const signals: string[] = [];
		let rawScore = 0;

		// Signal 1: recency
		const lastSave = input.recentSaves[input.filePath] ?? 0;
		const ageMs = input.saveTimestamp - lastSave;
		if (ageMs < 60_000) {
			signals.push('recently saved (< 1 min ago)');
			rawScore += 2;
		} else if (ageMs < 300_000) {
			signals.push('saved recently (< 5 min ago)');
			rawScore += 1;
		}

		// Signal 2: error severity
		const errorFindings = input.findings.filter((f) => f.severity === 'error');
		if (errorFindings.length > 0) {
			signals.push(`contains ${errorFindings.length} error-severity finding(s)`);
			rawScore += 4 * errorFindings.length;
		}

		// Signal 3: warning severity
		const warningFindings = input.findings.filter((f) => f.severity === 'warning');
		if (warningFindings.length > 0) {
			signals.push(`contains ${warningFindings.length} warning-severity finding(s)`);
			rawScore += 2 * warningFindings.length;
		}

		// Signal 4: export signature changed
		const exportChanged = input.findings.filter((f) => f.kind === 'export_signature_changed');
		if (exportChanged.length > 0) {
			const name = exportChanged[0].relatedSymbol;
			signals.push(name ? `exported symbol "${name}" changed signature` : 'exported signature changed');
			rawScore += 5;
		}

		// Signal 5: downstream files also have findings
		if (input.downstreamFiles.length > 0) {
			const downstreamWithFindings = input.allFindings.filter(
				(f) => input.downstreamFiles.includes(f.filePath) && f.severity !== 'info',
			);
			if (downstreamWithFindings.length > 0) {
				signals.push(`${input.downstreamFiles.length} downstream file(s) also have findings`);
				rawScore += 3;
			}
		}

		return { filePath: input.filePath, rawScore, signals };
	});

	const maxScore = Math.max(1, ...candidates.map((c) => c.rawScore));

	// Normalize to 0..1
	const ranked: RootCauseCandidate[] = candidates
		.map((c): RootCauseCandidate => ({
			filePath: c.filePath,
			relatedSymbol: inputs.find((i) => i.filePath === c.filePath)?.findings[0]?.relatedSymbol,
			confidence: Number(Math.min(0.99, c.rawScore / maxScore).toFixed(2)),
			signals: c.signals,
		}))
		.sort((a, b) => b.confidence - a.confidence);

	// -------------------------------------------------------------------------
	// V3: Apply runtime RCA boosts
	// -------------------------------------------------------------------------
	if (allRuntimeEvents.length > 0) {
		const boosts = computeRuntimeRcaBoosts(allRuntimeEvents, allFindings);
		for (const candidate of ranked) {
			const boost = boosts.find((b) => b.filePath === candidate.filePath);
			if (boost) {
				candidate.confidence = Number(Math.min(0.99, candidate.confidence + boost.boost).toFixed(2));
				candidate.signals.push(...boost.signals.map((s) => `[runtime] ${s}`));
			}
		}
		// Re-sort after boosts
		ranked.sort((a, b) => b.confidence - a.confidence);
	}

	return ranked;
}