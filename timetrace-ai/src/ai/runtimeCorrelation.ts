import type { RuntimeEvent } from './runtimeTypes';
import type { Finding, Incident } from './types';
import type { TimelineCheckpointRecord } from './snapshotStore';

// ---------------------------------------------------------------------------
// Checkpoint correlation
// ---------------------------------------------------------------------------

interface CheckpointCorrelationResult {
	relatedCheckpointId?: string;
	evidence: string[];
}

/**
 * Correlate a runtime event to the most relevant checkpoint using heuristic signals.
 * Returns undefined for relatedCheckpointId if confidence is too low.
 */
export function correlateRuntimeEventToCheckpoint(
	event: RuntimeEvent,
	checkpoints: TimelineCheckpointRecord[],
): CheckpointCorrelationResult {
	if (!checkpoints.length) {
		return { evidence: [] };
	}

	interface ScoredCheckpoint {
		checkpoint: TimelineCheckpointRecord;
		score: number;
		signals: string[];
	}

	const eventTs = new Date(event.timestamp).getTime();

	const scored: ScoredCheckpoint[] = checkpoints.map((cp) => {
		let score = 0;
		const signals: string[] = [];
		const cpTs = new Date(cp.timestamp).getTime();

		// Signal 1: same file
		if (event.filePath && cp.filePath === event.filePath) {
			score += 5;
			signals.push(`runtime event is in same file as checkpoint (${cp.filePath})`);
		}

		// Signal 2: checkpoint is in the recent past (0–5 min before runtime event)
		const ageSec = (eventTs - cpTs) / 1000;
		if (ageSec >= 0 && ageSec < 300) {
			const boost = ageSec < 60 ? 4 : 2;
			score += boost;
			signals.push(`checkpoint is ${Math.round(ageSec)}s before this runtime event`);
		} else if (ageSec < 0) {
			// Checkpoint is in the future — weak signal, skip
		}

		// Signal 3: checkpoint is ERROR/WARNING state
		if (cp.state === 'ERROR') {
			score += 3;
			signals.push('checkpoint was in ERROR state');
		} else if (cp.state === 'WARNING') {
			score += 1;
			signals.push('checkpoint was in WARNING state');
		}

		// Signal 4: runtime event file overlaps changed line ranges from checkpoint
		if (event.filePath && event.filePath === cp.filePath && event.line !== undefined) {
			const lineOverlap = cp.changedLineRanges.some(
				([start, end]) => event.line! >= start && event.line! <= end,
			);
			if (lineOverlap) {
				score += 6;
				signals.push(`runtime error at line ${event.line} overlaps checkpoint changed lines`);
			}
		}

		// Signal 5: checkpoint findings reference the same symbol as runtime event stack
		if (event.functionName) {
			const symbolMatch = cp.findings?.some((f) => f.relatedSymbol === event.functionName);
			if (symbolMatch) {
				score += 4;
				signals.push(`runtime function "${event.functionName}" matches a checkpoint finding symbol`);
			}
		}

		return { checkpoint: cp, score, signals };
	});

	const best = scored.sort((a, b) => b.score - a.score)[0];

	// Minimum score threshold to avoid fabricating a link
	if (!best || best.score < 3) {
		return { evidence: [] };
	}

	return {
		relatedCheckpointId: best.checkpoint.timestamp, // use timestamp as stable checkpoint id
		evidence: best.signals,
	};
}

// ---------------------------------------------------------------------------
// Incident linking
// ---------------------------------------------------------------------------

interface IncidentCorrelationResult {
	relatedIncidentId?: string;
	relatedFindingIds: string[];
	evidence: string[];
	shouldConfirmIncident: boolean;
}

/**
 * Attempt to link a runtime event to an existing open/mitigated incident.
 * Leaves unlinked if no sane match is found.
 */
export function correlateRuntimeEventToIncident(
	event: RuntimeEvent,
	incidents: Incident[],
	allFindings: Finding[],
): IncidentCorrelationResult {
	const activeIncidents = incidents.filter((i) => i.status === 'open' || i.status === 'mitigated');

	if (!activeIncidents.length) {
		return { relatedFindingIds: [], evidence: [], shouldConfirmIncident: false };
	}

	interface ScoredIncident {
		incident: Incident;
		score: number;
		signals: string[];
		matchedFindingIds: string[];
	}

	const eventTs = new Date(event.timestamp).getTime();

	const scored: ScoredIncident[] = activeIncidents.map((incident) => {
		let score = 0;
		const signals: string[] = [];
		const matchedFindingIds: string[] = [];

		// Signal 1: event file matches incident's impacted or related files
		if (event.filePath) {
			if (incident.impactedFiles.includes(event.filePath)) {
				score += 5;
				signals.push(`runtime event file is in incident impactedFiles`);
			} else if (incident.relatedFiles.includes(event.filePath)) {
				score += 3;
				signals.push(`runtime event file is in incident relatedFiles`);
			}
		}

		// Signal 2: temporal closeness to incident open time
		const incidentTs = new Date(incident.openedAt).getTime();
		const ageSec = (eventTs - incidentTs) / 1000;
		if (ageSec >= 0 && ageSec < 600) {
			score += 2;
			signals.push(`runtime event occurred ${Math.round(ageSec)}s after incident opened`);
		}

		// Signal 3: runtime event file/function overlaps finding symbols or line ranges
		const incidentFindings = allFindings.filter((f) => incident.findings.includes(f.id));
		for (const finding of incidentFindings) {
			// File match
			if (event.filePath && finding.filePath === event.filePath) {
				// Line range overlap
				if (event.line !== undefined && finding.lineRange) {
					const [start, end] = finding.lineRange;
					if (event.line >= start && event.line <= end) {
						score += 6;
						signals.push(`runtime error at line ${event.line} overlaps finding at lines ${start}-${end}`);
						matchedFindingIds.push(finding.id);
					}
				} else {
					score += 2;
					signals.push(`runtime event and finding share file ${finding.filePath}`);
					matchedFindingIds.push(finding.id);
				}
			}

			// Symbol match
			if (event.functionName && finding.relatedSymbol === event.functionName) {
				score += 4;
				signals.push(`runtime function "${event.functionName}" matches finding symbol`);
				if (!matchedFindingIds.includes(finding.id)) {
					matchedFindingIds.push(finding.id);
				}
			}
		}

		return { incident, score, signals, matchedFindingIds };
	});

	const best = scored.sort((a, b) => b.score - a.score)[0];

	// Minimum score threshold — don't force a bad association
	if (!best || best.score < 4) {
		return { relatedFindingIds: [], evidence: [], shouldConfirmIncident: false };
	}

	return {
		relatedIncidentId: best.incident.id,
		relatedFindingIds: best.matchedFindingIds,
		evidence: best.signals,
		// Confirm if high confidence (score >= 8) and event is error severity
		shouldConfirmIncident: best.score >= 8 && event.severity === 'error',
	};
}

// ---------------------------------------------------------------------------
// RCA reranking with runtime evidence
// ---------------------------------------------------------------------------

export interface RuntimeRcaBoost {
	filePath: string;
	boost: number;
	signals: string[];
}

/**
 * Computes confidence boosts for RCA candidates based on runtime events.
 * The caller applies these boosts to the ranked candidates.
 */
export function computeRuntimeRcaBoosts(
	runtimeEvents: RuntimeEvent[],
	allFindings: Finding[],
): RuntimeRcaBoost[] {
	const boostsByFile = new Map<string, RuntimeRcaBoost>();

	for (const event of runtimeEvents) {
		if (!event.filePath) { continue; }

		const existing = boostsByFile.get(event.filePath) ?? {
			filePath: event.filePath,
			boost: 0,
			signals: [],
		};

		// Boost 1: runtime error directly in this file
		if (event.severity === 'error') {
			existing.boost += 0.15;
			existing.signals.push(`runtime ${event.type} occurred in this file`);
		} else {
			existing.boost += 0.07;
			existing.signals.push(`runtime ${event.type} (warning) occurred in this file`);
		}

		// Boost 2: line overlap with a finding in this file
		if (event.line !== undefined) {
			const overlappingFindings = allFindings.filter((f) =>
				f.filePath === event.filePath &&
				f.lineRange !== undefined &&
				event.line! >= f.lineRange[0] &&
				event.line! <= f.lineRange[1],
			);
			if (overlappingFindings.length > 0) {
				existing.boost += 0.15;
				existing.signals.push(
					`runtime error at line ${event.line} overlaps ${overlappingFindings.length} finding(s) changed lines`,
				);
			}
		}

		// Boost 3: function name matches a finding's relatedSymbol
		if (event.functionName) {
			const symbolMatch = allFindings.find(
				(f) => f.filePath === event.filePath && f.relatedSymbol === event.functionName,
			);
			if (symbolMatch) {
				existing.boost += 0.20;
				existing.signals.push(
					`runtime function "${event.functionName}" directly matches finding symbol: ${symbolMatch.kind}`,
				);
			}
		}

		boostsByFile.set(event.filePath, existing);
	}

	return [...boostsByFile.values()];
}
