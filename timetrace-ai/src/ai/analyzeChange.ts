import { buildAnalysisSummary } from './analysisGenerator';
import { classifyFindings } from './classifier';
import { computeChangedLineRanges } from './changeDetector';
import { computeDirectDownstream, computeTransitiveRelated, type WorkspaceGraph } from './dependencyGraph';
import { detectFindings } from './findingDetector';
import { extractFeatures } from './featureExtractor';
import { updateIncidents } from './incidentManager';
import { rankRootCauses } from './classifier';
import { correlateRuntimeEventToCheckpoint } from './runtimeCorrelation';
import type { AnalyzeChangeInput, AnalyzeChangeOutput, AnalysisState, Finding, Incident } from './types';
import type { RuntimeEvent } from './runtimeTypes';

function normalizeState(previousState?: AnalysisState): AnalysisState {
	return previousState ?? 'NORMAL';
}

function computeCheckpoint(previousState: AnalysisState, nextState: AnalysisState): boolean {
	return previousState !== nextState;
}

export interface AnalyzeChangeContext {
	/** Existing incidents from the store */
	existingIncidents: Incident[];
	/** Current workspace import/export graph */
	graph: WorkspaceGraph;
	/** filePath → Unix ms timestamp of last save */
	recentSaves: Record<string, number>;
	/** Absolute workspace root path */
	workspaceRoot: string;
	/** V3: Runtime events to correlate against this analysis pass */
	runtimeEvents?: RuntimeEvent[];
	/** V3: Existing checkpoint records for runtime correlation */
	recentCheckpoints?: import('./snapshotStore').TimelineCheckpointRecord[];
}

export function analyzeChange(
	input: AnalyzeChangeInput,
	context?: AnalyzeChangeContext,
): AnalyzeChangeOutput {
	const previousState = normalizeState(input.previousState);

	// -------------------------------------------------------------------------
	// Step 1: Extract features
	// -------------------------------------------------------------------------
	const changedLineRanges = input.changedLineRanges ?? computeChangedLineRanges(input.previousCode, input.currentCode);
	const features = extractFeatures({
		language: input.language,
		previousCode: input.previousCode,
		currentCode: input.currentCode,
		changedLineRanges,
	});

	// -------------------------------------------------------------------------
	// Step 2: Detect findings
	// -------------------------------------------------------------------------
	const findings = detectFindings(
		{ filePath: input.filePath, timestamp: input.timestamp, changedLineRanges },
		features,
	);

	// -------------------------------------------------------------------------
	// Step 3: Derive file state from findings
	// -------------------------------------------------------------------------
	const classification = classifyFindings(findings);
	const state = features.cosmetic ? previousState : classification.state;
	const score = classification.score;
	const checkpoint = features.cosmetic ? false : computeCheckpoint(previousState, state);

	// -------------------------------------------------------------------------
	// Step 4: Identify impacted/related files
	// -------------------------------------------------------------------------
	const graph = context?.graph ?? { imports: {}, exports: {}, exportSignatures: {} };
	const exportSignatureChanged = features.exportedNamesChanged.length > 0;
	const impactedFiles = exportSignatureChanged
		? computeDirectDownstream(graph, input.filePath)
		: [];
	const relatedFiles = computeTransitiveRelated(graph, input.filePath);

	// -------------------------------------------------------------------------
	// Step 5: Rank probable root causes (V3: with runtime events)
	// -------------------------------------------------------------------------
	const saveTs = new Date(input.timestamp).getTime();
	const recentSaves = context?.recentSaves ?? {};
	const runtimeEvents = context?.runtimeEvents ?? [];

	// Correlate incoming runtime events to checkpoints before using them
	const recentCheckpoints = context?.recentCheckpoints ?? [];
	const correlatedRuntimeEvents: RuntimeEvent[] = runtimeEvents.map((event) => {
		const { relatedCheckpointId, evidence } = correlateRuntimeEventToCheckpoint(event, recentCheckpoints);
		if (relatedCheckpointId && !event.relatedCheckpointId) {
			return {
				...event,
				relatedCheckpointId,
				evidence: [...(event.evidence ?? []), ...evidence],
			};
		}
		return event;
	});

	const probableRootCauses = rankRootCauses([
		{
			filePath: input.filePath,
			findings,
			allFindings: findings,
			downstreamFiles: computeDirectDownstream(graph, input.filePath),
			saveTimestamp: saveTs,
			recentSaves,
			runtimeEvents: correlatedRuntimeEvents,
		},
	]);

	// -------------------------------------------------------------------------
	// Step 6: Open/update/resolve incidents (V3: with runtime event linking)
	// -------------------------------------------------------------------------
	const { incidents, enrichedRuntimeEvents } = updateIncidents(
		context?.existingIncidents ?? [],
		findings,
		impactedFiles,
		relatedFiles,
		input.timestamp,
		correlatedRuntimeEvents,
	);

	// -------------------------------------------------------------------------
	// Build backward-compatible fields
	// -------------------------------------------------------------------------
	const reasons = findings.length > 0 ? findings.map((f) => f.evidence) : classification.reasons;
	const analysis = buildAnalysisSummary({
		previousState,
		state,
		checkpoint,
		reasons,
		score,
	});

	return {
		state,
		score,
		confidence: classification.confidence,
		checkpoint,
		previousState,
		reasons,
		analysis,
		features,
		changedLineRanges,
		findings,
		probableRootCauses,
		incidents,
		impactedFiles,
		relatedFiles,
		// V3 fields
		runtimeEvents: enrichedRuntimeEvents,
	};
}