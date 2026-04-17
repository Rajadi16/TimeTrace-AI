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

export interface RootCauseInput {
	filePath: string;
	findings: Finding[];
	allFindings: Finding[];
	downstreamFiles: string[];
	saveTimestamp: number;
	recentSaves: Record<string, number>;
	/** Optional runtime events for V3 reranking */
	runtimeEvents?: RuntimeEvent[];
	/** Number of active incidents currently touching this file */
	activeIncidentCount?: number;
}

interface ScoredCandidate {
	filePath: string;
	rawScore: number;
	signals: string[];
}

const RCA_WEIGHTS = {
	recentUnderOneMinute: 2.8,
	recentUnderFiveMinutes: 1.4,
	errorFinding: 4.5,
	warningFinding: 2.2,
	infoFinding: 0.8,
	exportSignatureChanged: 3.8,
	downstreamWithFindings: 2.6,
	runtimeErrorInFile: 3.5,
	runtimeWarningInFile: 1.8,
	activeIncidentTouch: 1.7,
	lowEvidencePenalty: 1.0,
};

function findingKindWeight(finding: Finding): number {
	if (finding.kind === 'syntax_error') {
		return 1.25;
	}
	if (finding.kind === 'undefined_identifier') {
		return 1.15;
	}
	if (finding.kind === 'export_signature_changed') {
		return 1.2;
	}
	if (finding.kind === 'downstream_impact') {
		return 1.1;
	}
	return 1;
}

function severityWeight(severity: Finding['severity']): number {
	if (severity === 'error') {
		return RCA_WEIGHTS.errorFinding;
	}
	if (severity === 'warning') {
		return RCA_WEIGHTS.warningFinding;
	}
	return RCA_WEIGHTS.infoFinding;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function rankRootCauses(inputs: RootCauseInput[]): RootCauseCandidate[] {
	if (inputs.length === 0) {
		return [];
	}

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
			rawScore += RCA_WEIGHTS.recentUnderOneMinute;
		} else if (ageMs < 300_000) {
			signals.push('saved recently (< 5 min ago)');
			rawScore += RCA_WEIGHTS.recentUnderFiveMinutes;
		}

		// Signal 2: weighted finding evidence by severity + confidence + kind
		if (input.findings.length > 0) {
			const errorFindings = input.findings.filter((f) => f.severity === 'error').length;
			const warningFindings = input.findings.filter((f) => f.severity === 'warning').length;
			if (errorFindings > 0) {
				signals.push(`contains ${errorFindings} error-severity finding(s)`);
			}
			if (warningFindings > 0) {
				signals.push(`contains ${warningFindings} warning-severity finding(s)`);
			}

			for (const finding of input.findings) {
				rawScore += severityWeight(finding.severity) * finding.confidence * findingKindWeight(finding);
			}
		}

		// Signal 3: export signature changed
		const exportChanged = input.findings.filter((f) => f.kind === 'export_signature_changed');
		if (exportChanged.length > 0) {
			const name = exportChanged[0].relatedSymbol;
			signals.push(name ? `exported symbol "${name}" changed signature` : 'exported signature changed');
			rawScore += RCA_WEIGHTS.exportSignatureChanged;
		}

		// Signal 4: downstream files also have findings
		if (input.downstreamFiles.length > 0) {
			const downstreamWithFindings = input.allFindings.filter(
				(f) => input.downstreamFiles.includes(f.filePath) && f.severity !== 'info',
			);
			if (downstreamWithFindings.length > 0) {
				signals.push(`${input.downstreamFiles.length} downstream file(s) also have findings`);
				rawScore += RCA_WEIGHTS.downstreamWithFindings;
			}
		}

		// Signal 5: runtime events directly in candidate file
		const runtimeInFile = allRuntimeEvents.filter((event) => event.filePath === input.filePath);
		if (runtimeInFile.length > 0) {
			const runtimeErrors = runtimeInFile.filter((event) => event.severity === 'error').length;
			const runtimeWarnings = runtimeInFile.length - runtimeErrors;
			if (runtimeErrors > 0) {
				rawScore += runtimeErrors * RCA_WEIGHTS.runtimeErrorInFile;
				signals.push(`runtime errors observed in this file (${runtimeErrors})`);
			}
			if (runtimeWarnings > 0) {
				rawScore += runtimeWarnings * RCA_WEIGHTS.runtimeWarningInFile;
				signals.push(`runtime warnings observed in this file (${runtimeWarnings})`);
			}
		}

		// Signal 6: file participates in currently active incidents
		const activeIncidentCount = input.activeIncidentCount ?? 0;
		if (activeIncidentCount > 0) {
			rawScore += Math.min(2, activeIncidentCount) * RCA_WEIGHTS.activeIncidentTouch;
			signals.push(`linked to ${activeIncidentCount} active incident(s)`);
		}

		// Penalty: weak evidence profile
		if (input.findings.length === 0 && runtimeInFile.length === 0 && activeIncidentCount === 0) {
			rawScore -= RCA_WEIGHTS.lowEvidencePenalty;
			signals.push('limited direct evidence for this file');
		}

		return { filePath: input.filePath, rawScore, signals };
	});

	const maxScore = Math.max(...candidates.map((c) => c.rawScore));
	const minScore = Math.min(...candidates.map((c) => c.rawScore));
	const scoreSpan = maxScore - minScore;

	// Normalize to 0..1
	const ranked: RootCauseCandidate[] = candidates
		.map((c): RootCauseCandidate => ({
			filePath: c.filePath,
			relatedSymbol: inputs.find((i) => i.filePath === c.filePath)?.findings[0]?.relatedSymbol,
			confidence: Number(
				(maxScore <= 0
					? 0.32
					: clamp(0.35 + (scoreSpan > 0 ? ((c.rawScore - minScore) / scoreSpan) : 0.5) * 0.52, 0.2, 0.95)
				).toFixed(2),
			),
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

	// -------------------------------------------------------------------------
	// Ambiguity handling and confidence calibration
	// -------------------------------------------------------------------------
	if (ranked.length > 1) {
		const confidenceGap = ranked[0].confidence - ranked[1].confidence;
		if (confidenceGap < 0.08) {
			ranked[0].confidence = Number(clamp(ranked[0].confidence - 0.07, 0.2, 0.99).toFixed(2));
			ranked[0].signals.push('multiple candidates have similar evidence; confidence reduced');
		} else if (confidenceGap < 0.16) {
			ranked[0].confidence = Number(clamp(ranked[0].confidence - 0.03, 0.2, 0.99).toFixed(2));
			ranked[0].signals.push('top candidate is plausible but close alternatives exist');
		}
	}

	for (const candidate of ranked) {
		if (candidate.signals.length < 2) {
			candidate.confidence = Number(clamp(candidate.confidence - 0.04, 0.2, 0.99).toFixed(2));
			candidate.signals.push('limited supporting signals; confidence calibrated');
		}
	}

	ranked.sort((a, b) => b.confidence - a.confidence);

	return ranked;
}