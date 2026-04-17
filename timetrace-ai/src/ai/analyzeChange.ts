import { buildAnalysisSummary } from './analysisGenerator';
import { computeChangedLineRanges } from './changeDetector';
import { extractFeatures } from './featureExtractor';
import { detectExportSignatureDelta } from './workspaceGraph';
import type { AnalyzeChangeInput, AnalyzeChangeOutput, AnalysisState, Finding, FindingSeverity, FindingType, HistoricalAnalysisSummary, RootCauseCandidate } from './types';

function normalizeState(previousState?: AnalysisState): AnalysisState {
	return previousState ?? 'NORMAL';
}

function computeCheckpoint(previousState: AnalysisState, nextState: AnalysisState): boolean {
	return previousState !== nextState;
}

function severityWeight(severity: FindingSeverity): number {
	if (severity === 'HIGH') {
		return 8;
	}
	if (severity === 'MEDIUM') {
		return 3;
	}
	return 1;
}

function scoreToState(score: number): AnalysisState {
	if (score >= 8) {
		return 'ERROR';
	}
	if (score >= 3) {
		return 'WARNING';
	}
	return 'NORMAL';
}

function createId(filePath: string, timestamp: string, index: number, type: FindingType): string {
	const raw = `${filePath}:${timestamp}:${index}:${type}`;
	let hash = 0;
	for (let i = 0; i < raw.length; i++) {
		hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
	}
	return `finding_${hash.toString(16)}`;
}

function addFinding(
	findings: Finding[],
	input: {
		type: FindingType;
		severity: FindingSeverity;
		confidence: number;
		filePath: string;
		changedLineRanges: number[][];
		message: string;
		evidence: string[];
		relatedSymbol?: string;
		timestamp: string;
	},
): void {
	findings.push({
		id: createId(input.filePath, input.timestamp, findings.length, input.type),
		type: input.type,
		severity: input.severity,
		confidence: Number(input.confidence.toFixed(2)),
		filePath: input.filePath,
		changedLineRanges: input.changedLineRanges,
		message: input.message,
		evidence: input.evidence,
		relatedSymbol: input.relatedSymbol,
		timestamp: input.timestamp,
	});
}

function buildFindings(input: AnalyzeChangeInput, changedLineRanges: number[][]): { findings: Finding[]; exportDelta: ReturnType<typeof detectExportSignatureDelta> } {
	const features = extractFeatures({
		language: input.language,
		previousCode: input.previousCode,
		currentCode: input.currentCode,
	});
	const exportDelta = detectExportSignatureDelta(input.filePath, input.previousCode, input.currentCode);
	features.exportSignatureChanged = exportDelta.changed;

	const findings: Finding[] = [];
	const timestamp = input.timestamp;

	if (features.syntaxFailure) {
		addFinding(findings, {
			type: 'SyntaxFailure',
			severity: 'HIGH',
			confidence: 0.98,
			filePath: input.filePath,
			changedLineRanges,
			message: 'TypeScript parsing failed after this change.',
			evidence: ['Parser diagnostics were detected in the current file content.'],
			timestamp,
		});
	}

	if (features.undefinedIdentifierDetected) {
		addFinding(findings, {
			type: 'SemanticDiagnostic',
			severity: 'HIGH',
			confidence: 0.86,
			filePath: input.filePath,
			changedLineRanges,
			message: 'Likely unresolved identifier introduced in the changed code.',
			evidence: ['Identifier usage appears without a matching local declaration/import.'],
			timestamp,
		});
	}

	if (features.nullCheckRemoved) {
		addFinding(findings, {
			type: 'RemovedNullGuard',
			severity: 'MEDIUM',
			confidence: 0.82,
			filePath: input.filePath,
			changedLineRanges,
			message: 'Null or undefined guard count decreased.',
			evidence: ['Guard pattern matches dropped between snapshots.'],
			timestamp,
		});
	}

	if (features.optionalChainingRemoved) {
		addFinding(findings, {
			type: 'RemovedOptionalChaining',
			severity: 'MEDIUM',
			confidence: 0.74,
			filePath: input.filePath,
			changedLineRanges,
			message: 'Optional chaining usage decreased in the changed file.',
			evidence: ['"?." occurrences were removed.'],
			timestamp,
		});
	}

	if (features.fallbackRemoved) {
		addFinding(findings, {
			type: 'RemovedFallback',
			severity: 'MEDIUM',
			confidence: 0.72,
			filePath: input.filePath,
			changedLineRanges,
			message: 'Fallback operator usage decreased in the changed file.',
			evidence: ['"??" or "||" fallback patterns were removed.'],
			timestamp,
		});
	}

	if (features.tryCatchRemoved) {
		addFinding(findings, {
			type: 'RemovedTryCatch',
			severity: 'MEDIUM',
			confidence: 0.82,
			filePath: input.filePath,
			changedLineRanges,
			message: 'Error-handling protection appears to be removed.',
			evidence: ['try/catch pattern count dropped from the previous snapshot.'],
			timestamp,
		});
	}

	if (features.complexityDelta >= 2) {
		addFinding(findings, {
			type: 'IncreasedNesting',
			severity: features.complexityDelta >= 4 ? 'MEDIUM' : 'LOW',
			confidence: 0.67,
			filePath: input.filePath,
			changedLineRanges,
			message: `Branching complexity increased by ${features.complexityDelta}.`,
			evidence: ['Conditional/branch operators increased compared with the previous snapshot.'],
			timestamp,
		});
	}

	if (features.heavyLoopAdded) {
		addFinding(findings, {
			type: 'AddedLoopRisk',
			severity: 'MEDIUM',
			confidence: 0.69,
			filePath: input.filePath,
			changedLineRanges,
			message: 'A potentially expensive loop path was added.',
			evidence: ['Loop-related constructs increased in the changed file.'],
			timestamp,
		});
	}

	if (features.todoHackCommentAdded) {
		addFinding(findings, {
			type: 'AddedTodoHack',
			severity: 'LOW',
			confidence: 0.61,
			filePath: input.filePath,
			changedLineRanges,
			message: 'TODO/FIXME/HACK markers increased and may indicate unfinished risk handling.',
			evidence: ['One or more TODO/FIXME/HACK comments were introduced.'],
			timestamp,
		});
	}

	if (exportDelta.changed) {
		const symbols = [...exportDelta.changedSymbols, ...exportDelta.addedSymbols, ...exportDelta.removedSymbols];
		addFinding(findings, {
			type: 'ChangedExportSignature',
			severity: 'HIGH',
			confidence: 0.84,
			filePath: input.filePath,
			changedLineRanges,
			message: 'Exported API surface changed and may affect dependent files.',
			evidence: [
				`Changed symbols: ${exportDelta.changedSymbols.join(', ') || 'none'}`,
				`Added symbols: ${exportDelta.addedSymbols.join(', ') || 'none'}`,
				`Removed symbols: ${exportDelta.removedSymbols.join(', ') || 'none'}`,
			],
			relatedSymbol: symbols[0],
			timestamp,
		});
	}

	return { findings, exportDelta };
}

function buildRootCauseCandidates(input: AnalyzeChangeInput, findings: Finding[]): RootCauseCandidate[] {
	const candidates: RootCauseCandidate[] = [];
	const currentFileFindings = findings.filter((finding) => finding.type !== 'DownstreamDependencyRisk');

	if (currentFileFindings.length) {
		const topLocal = currentFileFindings
			.slice()
			.sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity))[0];
		candidates.push({
			filePath: topLocal.filePath,
			relatedSymbol: topLocal.relatedSymbol,
			reason: 'High-severity finding appears directly in the surfaced file at this checkpoint.',
			confidence: Number(Math.max(0.55, topLocal.confidence - 0.05).toFixed(2)),
			supportingFindingIds: [topLocal.id],
		});
	}

	const graphNode = input.workspaceGraph?.files[input.filePath];
	if (!graphNode || !input.knownAnalysesByFile) {
		return candidates;
	}

	const hasSymptom = findings.some((finding) => finding.type === 'SyntaxFailure' || finding.type === 'SemanticDiagnostic');
	if (!hasSymptom) {
		return candidates;
	}

	for (const upstreamFile of graphNode.imports) {
		const upstreamAnalysis: HistoricalAnalysisSummary | undefined = input.knownAnalysesByFile[upstreamFile];
		if (!upstreamAnalysis) {
			continue;
		}

		const upstreamExportFindingIds = upstreamAnalysis.findings
			.filter((finding) => finding.type === 'ChangedExportSignature')
			.map((finding) => finding.id);
		if (!upstreamExportFindingIds.length) {
			continue;
		}

		const timeDelta = Math.abs(new Date(input.timestamp).getTime() - new Date(upstreamAnalysis.timestamp).getTime());
		const recencyBoost = timeDelta <= 5 * 60 * 1000 ? 0.12 : timeDelta <= 30 * 60 * 1000 ? 0.05 : 0;
		candidates.push({
			filePath: upstreamFile,
			reason: 'Imported upstream file recently changed exported signatures and this file now shows a symptom.',
			confidence: Number(Math.min(0.95, 0.62 + recencyBoost).toFixed(2)),
			supportingFindingIds: upstreamExportFindingIds,
		});
	}

	return candidates.sort((left, right) => right.confidence - left.confidence).slice(0, 5);
}

export function analyzeChange(input: AnalyzeChangeInput): AnalyzeChangeOutput {
	const previousState = normalizeState(input.previousState);
	const changedLineRanges = input.changedLineRanges ?? computeChangedLineRanges(input.previousCode, input.currentCode);
	const { findings, exportDelta } = buildFindings(input, changedLineRanges);
	const graphNode = input.workspaceGraph?.files[input.filePath];
	const impactedFiles = graphNode?.directDependents ?? [];

	for (const dependentFile of impactedFiles) {
		if (!exportDelta.changed) {
			continue;
		}

		addFinding(findings, {
			type: 'DownstreamDependencyRisk',
			severity: 'MEDIUM',
			confidence: 0.68,
			filePath: dependentFile,
			changedLineRanges: [],
			message: 'Dependent file may be impacted by upstream export changes.',
			evidence: [`${dependentFile} imports from ${input.filePath} and exported signatures changed.`],
			timestamp: input.timestamp,
		});
	}

	const score = findings.reduce((total, finding) => total + severityWeight(finding.severity), 0);
	const state = scoreToState(score);
	const checkpoint = computeCheckpoint(previousState, state);
	const reasons = findings
		.filter((finding) => finding.filePath === input.filePath)
		.map((finding) => finding.message);
	const confidence = findings.length
		? Number((findings.reduce((total, finding) => total + finding.confidence, 0) / findings.length).toFixed(2))
		: 0.5;
	const probableRootCauses = buildRootCauseCandidates(input, findings);
	const relatedFiles = Array.from(
		new Set([
			input.filePath,
			...impactedFiles,
			...probableRootCauses.map((candidate) => candidate.filePath),
		]),
	);
	const checkpointId = `cp_${new Date(input.timestamp).getTime()}_${Math.max(1, changedLineRanges.length)}`;

	const features = extractFeatures({
		language: input.language,
		previousCode: input.previousCode,
		currentCode: input.currentCode,
	});
	features.exportSignatureChanged = exportDelta.changed;

	const analysis = buildAnalysisSummary({
		previousState,
		state,
		checkpoint,
		reasons,
		score,
	});

	return {
		schemaVersion: '2.0',
		checkpointId,
		state,
		score,
		confidence,
		checkpoint,
		previousState,
		reasons,
		analysis,
		features,
		changedLineRanges,
		findings,
		impactedFiles,
		relatedFiles,
		probableRootCauses,
	};
}