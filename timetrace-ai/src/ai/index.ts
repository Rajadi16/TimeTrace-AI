export { analyzeChange } from './analyzeChange';
export type { AnalyzeChangeContext } from './analyzeChange';
export { computeChangedLineRanges } from './changeDetector';
export { classifyFeatures, classifyFindings, rankRootCauses } from './classifier';
export { detectFindings } from './findingDetector';
export { extractFeatures } from './featureExtractor';
export { emptyGraph, updateGraphForFile, computeDirectDownstream, computeTransitiveRelated } from './dependencyGraph';
export type { WorkspaceGraph } from './dependencyGraph';
export { updateIncidents } from './incidentManager';
export { runTimeTraceAnalysis } from './runTimeTraceAnalysis';
export type { TimeTraceAnalysisInput, TimeTraceAnalysisResult } from './runTimeTraceAnalysis';
export type {
	AnalyzeChangeInput,
	AnalyzeChangeOutput,
	AnalysisState,
	FeatureSet,
	Finding,
	FindingKind,
	FindingSeverity,
	Incident,
	IncidentStatus,
	RootCauseCandidate,
} from './types';