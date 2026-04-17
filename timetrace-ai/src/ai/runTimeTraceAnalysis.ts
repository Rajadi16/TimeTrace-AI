import { analyzeChange, type AnalyzeChangeContext } from './analyzeChange';
import { buildTimelineItems } from './timelineBuilder';
import type { AnalyzeChangeInput, AnalysisState, FeatureSet, Finding, Incident, RootCauseCandidate } from './types';
import type { RuntimeEvent, TimelineItem } from './runtimeTypes';
import type { TimelineCheckpointRecord } from './snapshotStore';

/**
 * Canonical UI/integration entrypoint.
 *
 * V2 backward-compatible fields:
 * - state / score / checkpoint / previousState / reasons / analysis
 * - changedLineRanges / features
 * - findings / probableRootCauses / incidents / impactedFiles / relatedFiles
 *
 * V3 new fields:
 * - runtimeEvents       → enriched runtime events with checkpoint/incident linkage
 * - timelineItems       → unified chronological timeline for UI rendering
 */
export interface TimeTraceAnalysisInput extends AnalyzeChangeInput {
	previousState?: AnalysisState;
}

export interface TimeTraceAnalysisResult {
	// ---- Backward-compatible V2 fields (do not remove or rename) ----
	state: AnalysisState;
	score: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	changedLineRanges: number[][];
	features: FeatureSet;
	findings: Finding[];
	probableRootCauses: RootCauseCandidate[];
	incidents: Incident[];
	impactedFiles: string[];
	relatedFiles: string[];
	// ---- V3 runtime-aware fields ----
	/** Enriched runtime events with checkpoint + incident linkage */
	runtimeEvents: RuntimeEvent[];
	/** Unified chronological timeline ready for UI rendering */
	timelineItems: TimelineItem[];
}

export interface TimeTraceAnalysisV3Context extends AnalyzeChangeContext {
	/** All persisted checkpoint records for this file (for timeline building) */
	persistedCheckpoints?: TimelineCheckpointRecord[];
}

export function runTimeTraceAnalysis(
	input: TimeTraceAnalysisInput,
	context?: TimeTraceAnalysisV3Context,
): TimeTraceAnalysisResult {
	const { confidence: _confidence, runtimeEvents, ...coreResult } = analyzeChange(input, context);

	const enrichedRuntimeEvents = runtimeEvents ?? [];

	// Build unified timeline
	const persistedCheckpoints = context?.persistedCheckpoints ?? [];
	const timelineItems = buildTimelineItems(
		persistedCheckpoints,
		coreResult.incidents,
		enrichedRuntimeEvents,
	);

	return {
		...coreResult,
		runtimeEvents: enrichedRuntimeEvents,
		timelineItems,
	};
}