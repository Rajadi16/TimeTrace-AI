import type { RuntimeEvent, RawRuntimeInput, RuntimeEventType } from './runtimeTypes';

// ---------------------------------------------------------------------------
// ID generation — deterministic enough for deduplication within a session
// ---------------------------------------------------------------------------

let _seq = 0;
function makeRuntimeEventId(type: RuntimeEventType, timestamp: string): string {
	_seq += 1;
	return `re:${type}:${timestamp}:${_seq}`;
}

// ---------------------------------------------------------------------------
// Stack parsing — best-effort extraction of file/line/function
// ---------------------------------------------------------------------------

interface ParsedStack {
	filePath?: string;
	line?: number;
	column?: number;
	functionName?: string;
}

/**
 * Parses the first meaningful frame from a V8-style stack trace.
 * Handles both:
 *   "    at functionName (file:line:col)"
 *   "    at file:line:col"
 */
function parseStack(stack: string): ParsedStack {
	const lines = stack.split('\n');
	// Skip the first line which is usually the error message
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line.startsWith('at ')) { continue; }

		// "at functionName (path:line:col)"
		const namedMatch = line.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
		if (namedMatch) {
			return {
				functionName: namedMatch[1],
				filePath: namedMatch[2],
				line: parseInt(namedMatch[3], 10),
				column: parseInt(namedMatch[4], 10),
			};
		}

		// "at path:line:col"
		const anonMatch = line.match(/^at\s+(.+):(\d+):(\d+)$/);
		if (anonMatch) {
			return {
				filePath: anonMatch[1],
				line: parseInt(anonMatch[2], 10),
				column: parseInt(anonMatch[3], 10),
			};
		}
	}
	return {};
}

function unknownToString(value: unknown): string {
	if (value instanceof Error) { return value.message; }
	if (typeof value === 'string') { return value; }
	try { return JSON.stringify(value); } catch { return String(value); }
}

// ---------------------------------------------------------------------------
// Normalizers per event type
// ---------------------------------------------------------------------------

function normalizeRuntimeError(raw: Extract<RawRuntimeInput, { type: 'RuntimeError' }>): RuntimeEvent {
	const err = raw.error;
	const message = err.message || 'Unknown runtime error';
	const stack = 'stack' in err ? err.stack : undefined;
	const parsed = stack ? parseStack(stack) : {};

	const timestamp = raw.timestamp ?? new Date().toISOString();
	return {
		id: makeRuntimeEventId('RuntimeError', timestamp),
		type: 'RuntimeError',
		message,
		stack,
		filePath: raw.filePath ?? parsed.filePath,
		line: raw.line ?? parsed.line,
		column: parsed.column,
		functionName: parsed.functionName,
		timestamp,
		severity: 'error',
		evidence: [`Runtime error: ${message}`],
		raw: { name: 'name' in err ? err.name : 'Error' },
	};
}

function normalizeUnhandledRejection(raw: Extract<RawRuntimeInput, { type: 'UnhandledRejection' }>): RuntimeEvent {
	const reason = raw.reason;
	let message: string;
	let stack: string | undefined;
	let parsed: ParsedStack = {};

	if (reason instanceof Error) {
		message = reason.message;
		stack = reason.stack;
		parsed = stack ? parseStack(stack) : {};
	} else {
		message = unknownToString(reason);
	}

	const timestamp = raw.timestamp ?? new Date().toISOString();
	return {
		id: makeRuntimeEventId('UnhandledRejection', timestamp),
		type: 'UnhandledRejection',
		message: `Unhandled rejection: ${message}`,
		stack,
		filePath: parsed.filePath,
		line: parsed.line,
		column: parsed.column,
		functionName: parsed.functionName,
		timestamp,
		severity: 'error',
		evidence: [`Unhandled promise rejection: ${message}`],
		raw: typeof reason === 'object' && reason !== null ? (reason as Record<string, unknown>) : { reason },
	};
}

function normalizeConsoleError(raw: Extract<RawRuntimeInput, { type: 'ConsoleError' }>): RuntimeEvent {
	const message = raw.args.map(unknownToString).join(' ');
	const timestamp = raw.timestamp ?? new Date().toISOString();
	return {
		id: makeRuntimeEventId('ConsoleError', timestamp),
		type: 'ConsoleError',
		message: `console.error: ${message}`,
		filePath: raw.filePath,
		line: raw.line,
		timestamp,
		severity: 'warning',
		evidence: [`console.error called: ${message.slice(0, 120)}`],
	};
}

function normalizeNetworkFailure(raw: Extract<RawRuntimeInput, { type: 'NetworkFailure' }>): RuntimeEvent {
	const status = raw.status !== undefined ? ` (HTTP ${raw.status})` : '';
	const method = raw.method ? `${raw.method} ` : '';
	const message = `Network failure: ${method}${raw.url}${status}`;
	const timestamp = raw.timestamp ?? new Date().toISOString();

	// Treat 5xx as error, 4xx as warning
	const severity: 'error' | 'warning' = raw.status !== undefined && raw.status >= 500 ? 'error' : 'warning';

	return {
		id: makeRuntimeEventId('NetworkFailure', timestamp),
		type: 'NetworkFailure',
		message,
		timestamp,
		severity,
		evidence: [message],
		raw: raw.raw ?? { url: raw.url, status: raw.status, method: raw.method },
	};
}

// ---------------------------------------------------------------------------
// Public ingestion entry point
// ---------------------------------------------------------------------------

/**
 * Accepts any raw runtime input and returns a normalized RuntimeEvent.
 * This is the single entry point for all runtime event ingestion.
 */
export function ingestRuntimeEvent(raw: RawRuntimeInput): RuntimeEvent {
	switch (raw.type) {
		case 'RuntimeError':
			return normalizeRuntimeError(raw);
		case 'UnhandledRejection':
			return normalizeUnhandledRejection(raw);
		case 'ConsoleError':
			return normalizeConsoleError(raw);
		case 'NetworkFailure':
			return normalizeNetworkFailure(raw);
	}
}
