import type * as vscode from 'vscode';
import type { AnalysisState, HistoricalAnalysisSummary, Incident } from './types';

export interface SnapshotRecord {
	filePath: string;
	language: string;
	timestamp: string;
	code: string;
	state?: AnalysisState;
}

export interface AnalysisRecord {
	filePath: string;
	timestamp: string;
	result: unknown;
}

export interface CheckpointRecord {
	checkpointId: string;
	filePath: string;
	timestamp: string;
	state: AnalysisState;
	summary: string;
	findingIds: string[];
	relatedFiles: string[];
}

export class SnapshotStore {
	private readonly snapshotKey = 'timetrace-ai.snapshots';
	private readonly analysisKey = 'timetrace-ai.latestAnalysis';
	private readonly checkpointHistoryKey = 'timetrace-ai.checkpointHistory';
	private readonly timelineHistoryKey = 'timetrace-ai.timelineHistory';
	private readonly incidentsKey = 'timetrace-ai.incidents';

	public constructor(private readonly memento: vscode.Memento) {}

	public getSnapshot(filePath: string): SnapshotRecord | undefined {
		return this.readRecords<SnapshotRecord>(this.snapshotKey)[filePath];
	}

	public saveSnapshot(snapshot: SnapshotRecord): void {
		const records = this.readRecords<SnapshotRecord>(this.snapshotKey);
		records[snapshot.filePath] = snapshot;
		void this.memento.update(this.snapshotKey, records);
	}

	public saveLatestAnalysis(record: AnalysisRecord): void {
		const records = this.readRecords<AnalysisRecord>(this.analysisKey);
		records[record.filePath] = record;
		void this.memento.update(this.analysisKey, records);
	}

	public getLatestAnalysis(filePath: string): AnalysisRecord | undefined {
		return this.readRecords<AnalysisRecord>(this.analysisKey)[filePath];
	}

	public getAllSnapshots(): Record<string, SnapshotRecord> {
		return this.readRecords<SnapshotRecord>(this.snapshotKey);
	}

	public getAllLatestAnalyses(): Record<string, HistoricalAnalysisSummary> {
		const records = this.readRecords<AnalysisRecord>(this.analysisKey);
		const summaries: Record<string, HistoricalAnalysisSummary> = {};

		for (const [filePath, record] of Object.entries(records)) {
			const result = record.result as {
				checkpointId?: string;
				state?: AnalysisState;
				findings?: HistoricalAnalysisSummary['findings'];
			} | undefined;
			if (!result?.checkpointId || !result.state || !Array.isArray(result.findings)) {
				continue;
			}

			summaries[filePath] = {
				filePath,
				timestamp: record.timestamp,
				checkpointId: result.checkpointId,
				state: result.state,
				findings: result.findings,
			};
		}

		return summaries;
	}

	public appendCheckpoint(record: CheckpointRecord): void {
		const history = this.getCheckpointHistory(record.filePath);
		history.push(record);
		const records = this.readRecords<CheckpointRecord[]>(this.checkpointHistoryKey);
		records[record.filePath] = history.slice(-50);
		void this.memento.update(this.checkpointHistoryKey, records);
	}

	public getCheckpointHistory(filePath: string): CheckpointRecord[] {
		return this.readRecords<CheckpointRecord[]>(this.checkpointHistoryKey)[filePath] ?? [];
	}

	// Backward compatibility for legacy timeline tests and earlier UI wiring.
	public saveTimelineCheckpoint(record: { filePath: string } & Record<string, unknown>): void {
		const records = this.readRecords<Array<{ filePath: string } & Record<string, unknown>>>(this.timelineHistoryKey);
		const history = records[record.filePath] ?? [];
		history.push(record);
		records[record.filePath] = history.slice(-50);
		void this.memento.update(this.timelineHistoryKey, records);
	}

	public getTimelineHistory(filePath: string): Array<{ filePath: string } & Record<string, unknown>> {
		return this.readRecords<Array<{ filePath: string } & Record<string, unknown>>>(this.timelineHistoryKey)[filePath] ?? [];
	}

	public getIncidents(): Incident[] {
		return this.memento.get<Incident[]>(this.incidentsKey) ?? [];
	}

	public saveIncidents(incidents: Incident[]): void {
		void this.memento.update(this.incidentsKey, incidents);
	}

	private readRecords<T>(key: string): Record<string, T> {
		return this.memento.get<Record<string, T>>(key) ?? {};
	}
}