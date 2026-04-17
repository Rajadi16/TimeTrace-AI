import type * as vscode from 'vscode';
import type { TimeTraceAnalysisResult } from './runTimeTraceAnalysis';
import type { AnalysisState } from './types';

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
	findings?: TimeTraceAnalysisResult['findings'];
	probableRootCauses?: TimeTraceAnalysisResult['probableRootCauses'];
	relatedFiles?: TimeTraceAnalysisResult['relatedFiles'];
	impactedFiles?: TimeTraceAnalysisResult['impactedFiles'];
	incidents?: TimeTraceAnalysisResult['incidents'];
}

export class SnapshotStore {
	private readonly snapshotKey = 'timetrace-ai.snapshots';
	private readonly analysisKey = 'timetrace-ai.latestAnalysis';
	private readonly timelineKey = 'timetrace-ai.timelineHistory';
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
