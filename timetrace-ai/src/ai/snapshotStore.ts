import type * as vscode from 'vscode';
import type { TimeTraceAnalysisResult } from './runTimeTraceAnalysis';
import type { AnalysisState, Finding, Incident, RootCauseCandidate } from './types';
import type { WorkspaceGraph } from './dependencyGraph';

export interface SnapshotRecord {
	filePath: string;
	language: string;
	timestamp: string;
	code: string;
	state?: AnalysisState;
}

export interface CodePreviewRecord {
	before: string[];
	after: string[];
	focusLine: number;
}

export interface AnalysisRecord {
	filePath: string;
	timestamp: string;
	result: TimeTraceAnalysisResult;
	findings: Finding[];
}

export interface TimelineCheckpointRecord {
	filePath: string;
	timestamp: string;
	state: AnalysisState;
	score: number;
	checkpoint: boolean;
	previousState: AnalysisState;
	reasons: string[];
	analysis: string;
	changedLineRanges: number[][];
	features: TimeTraceAnalysisResult['features'];
	codePreview: CodePreviewRecord;
	findings: Finding[];
	probableRootCauses: RootCauseCandidate[];
	incidents: Incident[];
	impactedFiles: string[];
	relatedFiles: string[];
}

export class SnapshotStore {
	private readonly snapshotKey = 'timetrace-ai.snapshots';
	private readonly analysisKey = 'timetrace-ai.latestAnalysis';
	private readonly timelineKey = 'timetrace-ai.timelineHistory';
	private readonly incidentKey = 'timetrace-ai.incidents';
	private readonly graphKey = 'timetrace-ai.workspaceGraph';
	private readonly recentSavesKey = 'timetrace-ai.recentSaves';
	private readonly cache = new Map<string, unknown>();
	private readonly maxTimelineEntriesPerFile = 50;

	public constructor(private readonly memento: vscode.Memento) {}

	public getSnapshot(filePath: string): SnapshotRecord | undefined {
		return this.readRecords<SnapshotRecord>(this.snapshotKey)[filePath];
	}

	public saveSnapshot(snapshot: SnapshotRecord): void {
		const records = this.readRecords<SnapshotRecord>(this.snapshotKey);
		records[snapshot.filePath] = snapshot;
		this.writeRecords(this.snapshotKey, records);

		// Update recent saves timestamp
		const recentSaves = this.getRecentSaves();
		recentSaves[snapshot.filePath] = new Date(snapshot.timestamp).getTime();
		this.writeRecords(this.recentSavesKey, recentSaves);
	}

	public saveLatestAnalysis(record: AnalysisRecord): void {
		const records = this.readRecords<AnalysisRecord>(this.analysisKey);
		records[record.filePath] = record;
		this.writeRecords(this.analysisKey, records);
	}

	public getLatestAnalysis(filePath: string): AnalysisRecord | undefined {
		return this.readRecords<AnalysisRecord>(this.analysisKey)[filePath];
	}

	public saveTimelineCheckpoint(record: TimelineCheckpointRecord): void {
		const records = this.readRecords<TimelineCheckpointRecord[]>(this.timelineKey);
		const history = records[record.filePath] ?? [];
		records[record.filePath] = [...history, record].slice(-this.maxTimelineEntriesPerFile);
		this.writeRecords(this.timelineKey, records);
	}

	public getTimelineHistory(filePath: string): TimelineCheckpointRecord[] {
		return [...(this.readRecords<TimelineCheckpointRecord[]>(this.timelineKey)[filePath] ?? [])];
	}

	// ---------------------------------------------------------------------------
	// Incident persistence
	// ---------------------------------------------------------------------------

	public saveIncidents(incidents: Incident[]): void {
		this.cache.set(this.incidentKey, incidents);
		void this.memento.update(this.incidentKey, incidents);
	}

	public getIncidents(): Incident[] {
		if (this.cache.has(this.incidentKey)) {
			return this.cache.get(this.incidentKey) as Incident[];
		}
		const stored = this.memento.get<Incident[]>(this.incidentKey) ?? [];
		this.cache.set(this.incidentKey, stored);
		return stored;
	}

	// ---------------------------------------------------------------------------
	// Workspace graph persistence
	// ---------------------------------------------------------------------------

	public saveWorkspaceGraph(graph: WorkspaceGraph): void {
		this.cache.set(this.graphKey, graph);
		void this.memento.update(this.graphKey, graph);
	}

	public getWorkspaceGraph(): WorkspaceGraph | undefined {
		if (this.cache.has(this.graphKey)) {
			return this.cache.get(this.graphKey) as WorkspaceGraph;
		}
		const stored = this.memento.get<WorkspaceGraph>(this.graphKey);
		if (stored) { this.cache.set(this.graphKey, stored); }
		return stored;
	}

	// ---------------------------------------------------------------------------
	// Recent saves (for root-cause recency signal)
	// ---------------------------------------------------------------------------

	public getRecentSaves(): Record<string, number> {
		if (this.cache.has(this.recentSavesKey)) {
			return this.cache.get(this.recentSavesKey) as Record<string, number>;
		}
		const stored = this.memento.get<Record<string, number>>(this.recentSavesKey) ?? {};
		this.cache.set(this.recentSavesKey, stored);
		return stored;
	}

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	private readRecords<T>(key: string): Record<string, T> {
		if (this.cache.has(key)) {
			return this.cache.get(key) as Record<string, T>;
		}
		const records = this.memento.get<Record<string, T>>(key) ?? {};
		this.cache.set(key, records);
		return records;
	}

	private writeRecords<T>(key: string, records: Record<string, T>): void {
		this.cache.set(key, records);
		void this.memento.update(key, records);
	}
}
