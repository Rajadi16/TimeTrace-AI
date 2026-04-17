import * as path from 'node:path';
import type {
	AnalysisState,
	FeatureSet,
	FileContextItem,
	FindingSeverity,
	IncidentRecord,
	IncidentStatus,
	RuntimeConfirmationState,
	RuntimeEventRecord,
	RuntimeEventType,
	ProbableRootCause,
	StructuredFinding,
	TimelineTrailPoint,
} from './types';

interface StructuredAnalysisInput {
	filePath: string;
	timestamp: string;
	state: AnalysisState;
	score: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	features: FeatureSet;
	changedLineRanges: number[][];
	currentCode: string;
}

interface StructuredAnalysisArtifacts {
	findings: StructuredFinding[];
	probableRootCauses: ProbableRootCause[];
	relatedFiles: FileContextItem[];
	impactedFiles: FileContextItem[];
	incidents: IncidentRecord[];
	runtimeEvents: RuntimeEventRecord[];
}

export function buildStructuredAnalysisArtifacts(input: StructuredAnalysisInput): StructuredAnalysisArtifacts {
	const findings = buildFindings(input);
	const probableRootCauses = buildProbableRootCauses(input, findings);
	const relatedFiles = buildRelatedFiles(input.filePath, input.currentCode);
	const impactedFiles = buildImpactedFiles(input.filePath, relatedFiles, input.features);
	const checkpointId = buildCheckpointId(input.filePath, input.timestamp);
	const runtimeEvents = buildRuntimeEvents(input, findings, probableRootCauses, checkpointId);
	const incidents = buildIncidents(input, findings, probableRootCauses, runtimeEvents, checkpointId);

	return {
		findings,
		probableRootCauses,
		relatedFiles,
		impactedFiles,
		incidents,
		runtimeEvents,
	};
}

function buildFindings(input: Pick<StructuredAnalysisInput, 'reasons' | 'analysis' | 'changedLineRanges' | 'features'>): StructuredFinding[] {
	const reasons = input.reasons.length > 0 ? input.reasons : [input.analysis];
	const lineRanges = input.changedLineRanges.length > 0 ? input.changedLineRanges : [[1, 1]];

	return reasons
		.filter(Boolean)
		.map((reason, index) => ({
			id: `finding-${index + 1}`,
			message: reason,
			severity: inferFindingSeverity(reason, input.features),
			confidence: roundConfidence(Math.max(0.42, 0.94 - index * 0.1)),
			lineRanges,
			symbol: extractSymbolHint(reason),
		}))
		.slice(0, 6);
}

function buildProbableRootCauses(
	input: Pick<StructuredAnalysisInput, 'filePath' | 'reasons' | 'score'>,
	findings: StructuredFinding[],
): ProbableRootCause[] {
	const reasons = input.reasons.length > 0 ? input.reasons : ['Root cause remains probable, not confirmed.'];

	return reasons
		.map((reason, index) => ({
			id: `root-cause-${index + 1}`,
			filePath: input.filePath,
			reason,
			confidence: roundConfidence(Math.max(0.36, Math.min(0.98, 0.9 - index * 0.12 + input.score / 1000))),
			linkedEvidence: findings.slice(0, Math.max(1, findings.length - index)).map((finding) => finding.id),
		}))
		.slice(0, 4);
}

function buildRelatedFiles(filePath: string, currentCode: string): FileContextItem[] {
	const related = new Map<string, FileContextItem>();
	const importPattern = /(?:import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|require\()\s*['"]([^'"]+)['"]/g;

	for (const match of currentCode.matchAll(importPattern)) {
		const specifier = match[1];
		if (!specifier || !specifier.startsWith('.')) {
			continue;
		}

		const normalized = resolveRelativeSpecifier(filePath, specifier);
		related.set(normalized, {
			filePath: normalized,
			reason: 'Referenced directly by this file',
		});
	}

	if (related.size === 0) {
		related.set(filePath, {
			filePath,
			reason: 'No explicit imports detected; using the active file as context',
		});
	}

	return Array.from(related.values()).slice(0, 6);
}

function buildImpactedFiles(
	filePath: string,
	relatedFiles: FileContextItem[],
	features: FeatureSet,
): FileContextItem[] {
	const impacted = new Map<string, FileContextItem>();
	const dirName = path.posix.dirname(filePath);
	const baseName = path.posix.basename(filePath, path.posix.extname(filePath));
	const suffixes = ['.test.ts', '.spec.ts', '.test.js', '.spec.js'];

	for (const suffix of suffixes) {
		const candidate = path.posix.join(dirName, `${baseName}${suffix}`);
		if (!impacted.has(candidate)) {
			impacted.set(candidate, {
				filePath: candidate,
				reason: 'Likely downstream test or consumer touchpoint',
			});
		}
	}

	if (features.syntaxFailure || features.undefinedIdentifierDetected) {
		impacted.set(path.posix.join(dirName, 'index.ts'), {
			filePath: path.posix.join(dirName, 'index.ts'),
			reason: 'Shared entrypoint may inherit the regression',
		});
	}

	for (const related of relatedFiles) {
		if (related.filePath !== filePath && !impacted.has(related.filePath)) {
			impacted.set(related.filePath, {
				filePath: related.filePath,
				reason: 'Dependent file may need verification after this change',
			});
		}
	}

	return Array.from(impacted.values()).slice(0, 6);
}

function buildIncidents(
	input: Pick<StructuredAnalysisInput, 'filePath' | 'timestamp' | 'state' | 'score' | 'checkpoint' | 'previousState' | 'analysis'>,
	findings: StructuredFinding[],
	probableRootCauses: ProbableRootCause[],
	runtimeEvents: RuntimeEventRecord[],
	checkpointId: string,
): IncidentRecord[] {
	const runtimeConfirmed = runtimeEvents.some((event) => event.runtimeConfirmed);
	const confirmationState: RuntimeConfirmationState = runtimeEvents.length === 0
		? 'SUSPECTED'
		: runtimeConfirmed
			? 'RUNTIME_CONFIRMED'
			: input.state === 'NORMAL'
				? 'RESOLVED'
				: 'SUSPECTED';
	const status: IncidentStatus = input.state === 'NORMAL' && input.previousState !== 'NORMAL'
		? 'RESOLVED'
		: input.state === 'WARNING'
			? 'MITIGATED'
			: 'OPEN';
	const trail: TimelineTrailPoint[] = [
		{
			timestamp: input.timestamp,
			state: input.previousState,
			checkpoint: false,
			score: Math.max(0, input.score - 1),
			label: `Previous state ${input.previousState}`,
		},
		{
			timestamp: input.timestamp,
			state: input.state,
			checkpoint: input.checkpoint,
			score: input.score,
			label: `Current state ${input.state}`,
		},
	];

	return [
		{
			id: `incident-${input.timestamp}`,
			summary: input.analysis,
			status,
			runtimeConfirmationState: confirmationState,
			runtimeConfirmed,
			statusReason: buildIncidentStatusReason(status, confirmationState, runtimeEvents.length),
			timelineTrail: trail,
			surfacedFile: input.filePath,
			linkedCheckpointId: checkpointId,
			linkedFindings: findings.map((finding) => finding.id),
			probableCauses: probableRootCauses.map((cause) => cause.id),
			linkedRuntimeEvents: runtimeEvents.map((event) => event.id),
			lastRuntimeEventAt: runtimeEvents[0]?.timestamp,
			evidenceCount: findings.length + runtimeEvents.length,
		},
	];
}

function buildRuntimeEvents(
	input: StructuredAnalysisInput,
	findings: StructuredFinding[],
	probableRootCauses: ProbableRootCause[],
	checkpointId: string,
): RuntimeEventRecord[] {
	if (input.state === 'NORMAL' && !input.checkpoint) {
		return [];
	}

	const primaryLine = input.changedLineRanges[0]?.[0] ?? 1;
	const eventType = inferRuntimeEventType(input);
	const runtimeConfirmed = input.state === 'ERROR' || input.features.syntaxFailure || input.features.undefinedIdentifierDetected;
	const confirmationState: RuntimeConfirmationState = runtimeConfirmed
		? 'RUNTIME_CONFIRMED'
		: input.state === 'WARNING'
			? 'SUSPECTED'
			: input.checkpoint
				? 'MITIGATED'
				: 'SUSPECTED';
	const message = buildRuntimeEventMessage(input, eventType);
	const stackPreview = buildStackPreview(input, eventType, primaryLine);
	const runtimeEventId = `runtime-${input.timestamp}`;

	return [
		{
			id: runtimeEventId,
			eventType,
			message,
			timestamp: input.timestamp,
			severity: eventType === 'RUNTIME_ERROR' ? 'ERROR' : 'WARNING',
			filePath: input.filePath,
			line: primaryLine,
			stackPreview,
			linkedCheckpointId: checkpointId,
			linkedIncidentId: `incident-${input.timestamp}`,
			runtimeConfirmed,
			confirmationState,
			evidenceCount: Math.max(1, findings.length + probableRootCauses.length),
		},
	];
}

function inferRuntimeEventType(input: StructuredAnalysisInput): RuntimeEventType {
	if (input.features.syntaxFailure) {
		return 'RUNTIME_ERROR';
	}

	if (input.features.undefinedIdentifierDetected) {
		return 'UNHANDLED_REJECTION';
	}

	if (input.features.nullCheckRemoved || input.features.tryCatchRemoved) {
		return 'NETWORK_FAILURE';
	}

	return input.state === 'ERROR' ? 'CONSOLE_ERROR' : 'CONSOLE_ERROR';
}

function buildRuntimeEventMessage(input: StructuredAnalysisInput, eventType: RuntimeEventType): string {
	if (eventType === 'RUNTIME_ERROR') {
		return 'Runtime error surfaced after the latest save.';
	}

	if (eventType === 'UNHANDLED_REJECTION') {
		return 'Unhandled promise rejection observed in the execution path.';
	}

	if (eventType === 'NETWORK_FAILURE') {
		return 'Network/API failure surfaced during request execution.';
	}

	return input.state === 'ERROR'
		? 'Console error surfaced in the runtime stream.'
		: 'Console warning surfaced before the incident escalated.';
}

function buildStackPreview(input: StructuredAnalysisInput, eventType: RuntimeEventType, line: number): string[] {
	const baseFile = path.posix.basename(input.filePath);
	const stackHeader = eventType === 'NETWORK_FAILURE'
		? 'at fetchData (network client)'
		: `at ${baseFile}:${line}`;
	return [
		`${eventType}: ${input.analysis}`,
		stackHeader,
		`at checkpoint ${buildCheckpointId(input.filePath, input.timestamp)}`,
	];
}

function buildIncidentStatusReason(status: IncidentStatus, confirmationState: RuntimeConfirmationState, eventCount: number): string {
	if (status === 'RESOLVED') {
		return eventCount > 0 ? 'Runtime evidence no longer indicates an active failure.' : 'Incident resolved after the latest checkpoint.';
	}

	if (status === 'MITIGATED') {
		return confirmationState === 'RUNTIME_CONFIRMED'
			? 'Runtime evidence confirmed the issue, but the current checkpoint reduced impact.'
			: 'Issue is still active, but the most recent state reduced severity.';
	}

	return confirmationState === 'RUNTIME_CONFIRMED'
		? 'Runtime evidence confirmed an active issue.'
		: 'Static analysis indicates a probable active issue.';
}

function inferFindingSeverity(reason: string, features: FeatureSet): FindingSeverity {
	const lowerReason = reason.toLowerCase();
	if (features.syntaxFailure || lowerReason.includes('syntax issue') || lowerReason.includes('undefined identifier')) {
		return 'ERROR';
	}

	if (lowerReason.includes('todo') || lowerReason.includes('heavy loop') || lowerReason.includes('branching complexity')) {
		return 'WARNING';
	}

	return 'WARNING';
}

function extractSymbolHint(reason: string): string | undefined {
	const quotedMatch = reason.match(/['"]([A-Za-z_$][\w$]*)['"]/);
	if (quotedMatch?.[1]) {
		return quotedMatch[1];
	}

	const identifierMatch = reason.match(/\b([A-Za-z_$][\w$]*)\b/);
	return identifierMatch?.[1];
}

function resolveRelativeSpecifier(filePath: string, specifier: string): string {
	const baseDir = path.posix.dirname(filePath);
	const resolved = path.posix.normalize(path.posix.join(baseDir, specifier));
	return resolved.replace(/\\/g, '/');
}

function buildCheckpointId(filePath: string, timestamp: string): string {
	return `${filePath}::${timestamp}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

function roundConfidence(value: number): number {
	return Number(Math.min(0.99, value).toFixed(2));
}