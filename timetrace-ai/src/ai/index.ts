export { analyzeChange } from './analyzeChange';
export { computeChangedLineRanges } from './changeDetector';
export { classifyFeatures } from './classifier';
export { extractFeatures } from './featureExtractor';
export { updateIncidents } from './incidentEngine';
export { runTimeTraceAnalysis } from './runTimeTraceAnalysis';
export { buildWorkspaceDependencyGraph, detectExportSignatureDelta } from './workspaceGraph';
export type { TimeTraceAnalysisInput, TimeTraceAnalysisResult } from './runTimeTraceAnalysis';
export type {
	AnalyzeChangeInput,
	AnalyzeChangeOutput,
	AnalysisState,
	FeatureSet,
	Finding,
	FindingSeverity,
	FindingType,
	HistoricalAnalysisSummary,
	Incident,
	IncidentStatus,
	RootCauseCandidate,
	WorkspaceDependencyGraph,
	WorkspaceDependencyNode,
	WorkspaceFileSnapshot,
} from './types';