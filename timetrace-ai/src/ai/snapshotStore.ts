import type * as vscode from 'vscode';
import type { AnalysisState } from './types';

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

export class SnapshotStore {
	private readonly snapshotKey = 'timetrace-ai.snapshots';
	private readonly analysisKey = 'timetrace-ai.latestAnalysis';

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

	private readRecords<T>(key: string): Record<string, T> {
		return this.memento.get<Record<string, T>>(key) ?? {};
	}
}