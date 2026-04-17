// ---------------------------------------------------------------------------
// RuntimeEvent — a single runtime signal captured from the running application
// ---------------------------------------------------------------------------

export type RuntimeEventType =
	| 'RuntimeError'
	| 'UnhandledRejection'
	| 'ConsoleError'
	| 'NetworkFailure';

export interface RuntimeEvent {
	id: string;
	type: RuntimeEventType;
	message: string;
	stack?: string;
	filePath?: string;
	line?: number;
	column?: number;
	functionName?: string;
	timestamp: string;
	severity: 'warning' | 'error';
	/** Id of the most likely checkpoint this event correlates to */
	relatedCheckpointId?: string;
	/** Id of the incident this event is linked to */
	relatedIncidentId?: string;
	/** Finding ids that overlap with this runtime event */
	relatedFindingIds?: string[];
	/** Human-readable signals explaining the correlation */
	evidence?: string[];
	/** Raw captured data for debugging */
	raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TimelineItem — unified chronological item for UI rendering
// ---------------------------------------------------------------------------

import type { AnalysisState } from './types';

export type TimelineItem =
	| {
			kind: 'checkpoint';
			checkpointId: string;
			timestamp: string;
			filePath: string;
			state: AnalysisState;
	  }
	| {
			kind: 'runtimeEvent';
			runtimeEventId: string;
			timestamp: string;
			filePath?: string;
			eventType: RuntimeEventType;
			message: string;
			severity: 'warning' | 'error';
			relatedCheckpointId?: string;
			relatedIncidentId?: string;
	  }
	| {
			kind: 'incidentUpdate';
			incidentId: string;
			timestamp: string;
			status: 'open' | 'mitigated' | 'resolved';
			summary: string;
			runtimeConfirmed?: boolean;
	  };

// ---------------------------------------------------------------------------
// Raw ingestion inputs — what callers pass in before normalization
// ---------------------------------------------------------------------------

/** An Error object or error-like payload from uncaught error handlers */
export interface RawRuntimeError {
	type: 'RuntimeError';
	error: Error | { message: string; stack?: string; name?: string };
	filePath?: string;
	line?: number;
	column?: number;
	timestamp?: string;
}

/** An unhandled promise rejection */
export interface RawUnhandledRejection {
	type: 'UnhandledRejection';
	reason: unknown;
	timestamp?: string;
}

/** A console.error call payload */
export interface RawConsoleError {
	type: 'ConsoleError';
	args: unknown[];
	filePath?: string;
	line?: number;
	timestamp?: string;
}

/** A failed network/HTTP request */
export interface RawNetworkFailure {
	type: 'NetworkFailure';
	url: string;
	status?: number;
	statusText?: string;
	method?: string;
	timestamp?: string;
	raw?: Record<string, unknown>;
}

export type RawRuntimeInput =
	| RawRuntimeError
	| RawUnhandledRejection
	| RawConsoleError
	| RawNetworkFailure;
