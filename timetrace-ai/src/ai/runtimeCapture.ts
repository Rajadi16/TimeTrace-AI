import type { RawRuntimeInput } from './runtimeTypes';

export type DiagnosticCaptureSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface DiagnosticCaptureInput {
	message: string;
	severity: DiagnosticCaptureSeverity;
	source?: string;
	code?: string | number;
	startLine: number;
	startCharacter: number;
}

export interface CapturedRuntimeSignal {
	fingerprint: string;
	filePath: string;
	rawInput: RawRuntimeInput;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function formatDiagnosticMessage(diagnostic: DiagnosticCaptureInput): string {
	const source = diagnostic.source ? `[${diagnostic.source}] ` : '';
	const code = diagnostic.code !== undefined ? ` (code: ${String(diagnostic.code)})` : '';
	return `${source}${normalizeWhitespace(diagnostic.message)}${code}`;
}

function buildDiagnosticFingerprint(filePath: string, diagnostic: DiagnosticCaptureInput): string {
	const message = normalizeWhitespace(diagnostic.message).slice(0, 240);
	const source = diagnostic.source ?? '';
	const code = diagnostic.code !== undefined ? String(diagnostic.code) : '';
	return [
		'diagnostic',
		filePath,
		diagnostic.severity,
		source,
		code,
		String(diagnostic.startLine),
		String(diagnostic.startCharacter),
		message,
	].join('::');
}

function toRawRuntimeInput(
	filePath: string,
	diagnostic: DiagnosticCaptureInput,
	timestamp: string,
): RawRuntimeInput | undefined {
	const line = Math.max(1, diagnostic.startLine + 1);
	const column = Math.max(1, diagnostic.startCharacter + 1);
	const message = formatDiagnosticMessage(diagnostic);

	if (diagnostic.severity === 'error') {
		return {
			type: 'RuntimeError',
			error: { message },
			filePath,
			line,
			column,
			timestamp,
		};
	}

	if (diagnostic.severity === 'warning') {
		return {
			type: 'ConsoleError',
			args: [message],
			filePath,
			line,
			timestamp,
		};
	}

	return undefined;
}

export function captureRuntimeSignalsFromDiagnostics(
	filePath: string,
	diagnostics: readonly DiagnosticCaptureInput[],
	timestamp: string,
): CapturedRuntimeSignal[] {
	const signals: CapturedRuntimeSignal[] = [];

	for (const diagnostic of diagnostics) {
		const rawInput = toRawRuntimeInput(filePath, diagnostic, timestamp);
		if (!rawInput) {
			continue;
		}

		signals.push({
			fingerprint: buildDiagnosticFingerprint(filePath, diagnostic),
			filePath,
			rawInput,
		});
	}

	return signals;
}

export class RuntimeSignalDeduper {
	private readonly seenAtByFingerprint = new Map<string, number>();

	public constructor(
		private readonly duplicateWindowMs = 15_000,
		private readonly maxFingerprints = 4_000,
	) {}

	public isDuplicate(fingerprint: string, nowMs = Date.now()): boolean {
		this.prune(nowMs);
		const lastSeenAt = this.seenAtByFingerprint.get(fingerprint);
		if (lastSeenAt !== undefined && nowMs - lastSeenAt < this.duplicateWindowMs) {
			return true;
		}
		this.seenAtByFingerprint.set(fingerprint, nowMs);
		return false;
	}

	private prune(nowMs: number): void {
		if (this.seenAtByFingerprint.size <= this.maxFingerprints) {
			return;
		}

		for (const [fingerprint, seenAt] of this.seenAtByFingerprint) {
			if (nowMs - seenAt >= this.duplicateWindowMs) {
				this.seenAtByFingerprint.delete(fingerprint);
			}
		}

		if (this.seenAtByFingerprint.size <= this.maxFingerprints) {
			return;
		}

		const overflow = this.seenAtByFingerprint.size - this.maxFingerprints;
		let removed = 0;
		for (const [fingerprint] of this.seenAtByFingerprint) {
			this.seenAtByFingerprint.delete(fingerprint);
			removed += 1;
			if (removed >= overflow) {
				break;
			}
		}
	}
}
