import type { Finding, FindingKind, Incident, IncidentStatus } from './types';
import type { RuntimeEvent } from './runtimeTypes';
import { correlateRuntimeEventToIncident } from './runtimeCorrelation';

// ---------------------------------------------------------------------------
// Incident matching — compare by filePath + findingKind (internally used)
// ---------------------------------------------------------------------------

function incidentKey(filePath: string, kinds: FindingKind[]): string {
	return `${filePath}:${[...kinds].sort().join(',')}`;
}

function getIncidentKinds(incident: Incident, allFindings: Finding[]): FindingKind[] {
	const findingsById = new Map(allFindings.map((f) => [f.id, f]));
	return incident.findings.map((id) => findingsById.get(id)?.kind).filter((k): k is FindingKind => !!k);
}

// ---------------------------------------------------------------------------
// V3: Apply runtime event links to incidents
// ---------------------------------------------------------------------------

function applyRuntimeEventsToIncidents(
	incidents: Incident[],
	runtimeEvents: RuntimeEvent[],
	allFindings: Finding[],
): { incidents: Incident[]; enrichedEvents: RuntimeEvent[] } {
	const enrichedEvents: RuntimeEvent[] = [];

	// We mutate a copy of incidents
	const incidentMap = new Map<string, Incident>(incidents.map((i) => [i.id, { ...i }]));

	for (const event of runtimeEvents) {
		const { relatedIncidentId, relatedFindingIds, evidence, shouldConfirmIncident } =
			correlateRuntimeEventToIncident(event, [...incidentMap.values()], allFindings);

		if (!relatedIncidentId) {
			enrichedEvents.push(event);
			continue;
		}

		const incident = incidentMap.get(relatedIncidentId);
		if (!incident) {
			enrichedEvents.push(event);
			continue;
		}

		// Enrich incident
		const existingRuntimeIds = incident.runtimeEventIds ?? [];
		if (!existingRuntimeIds.includes(event.id)) {
			existingRuntimeIds.push(event.id);
		}

		incidentMap.set(relatedIncidentId, {
			...incident,
			runtimeEventIds: existingRuntimeIds,
			runtimeConfirmed: incident.runtimeConfirmed || shouldConfirmIncident,
			lastRuntimeEventAt: incident.lastRuntimeEventAt
				? new Date(incident.lastRuntimeEventAt) > new Date(event.timestamp)
					? incident.lastRuntimeEventAt
					: event.timestamp
				: event.timestamp,
			runtimeEvidenceCount: (incident.runtimeEvidenceCount ?? 0) + 1,
		});

		// Enrich event with linkage
		enrichedEvents.push({
			...event,
			relatedIncidentId,
			relatedFindingIds: [...(event.relatedFindingIds ?? []), ...relatedFindingIds],
			evidence: [...(event.evidence ?? []), ...evidence],
		});
	}

	return {
		incidents: [...incidentMap.values()],
		enrichedEvents,
	};
}

// ---------------------------------------------------------------------------
// V2 + V3 lifecycle — main export
// ---------------------------------------------------------------------------

export function updateIncidents(
	existingIncidents: Incident[],
	currentFindings: Finding[],
	impactedFiles: string[],
	relatedFiles: string[],
	timestamp: string,
	runtimeEvents: RuntimeEvent[] = [],
): { incidents: Incident[]; enrichedRuntimeEvents: RuntimeEvent[] } {
	// Index current findings by id
	const currentFindingIds = new Set(currentFindings.map((f) => f.id));

	// Group current findings by filePath for easier matching
	const findingsByFile = new Map<string, Finding[]>();
	for (const f of currentFindings) {
		const existing = findingsByFile.get(f.filePath) ?? [];
		existing.push(f);
		findingsByFile.set(f.filePath, existing);
	}

	// -------------------------------------------------------------------------
	// Step A: Process existing incidents (V2 logic — resolve/mitigate)
	// -------------------------------------------------------------------------
	const updatedIncidents: Incident[] = existingIncidents.map((incident): Incident => {
		if (incident.status === 'resolved') {
			return incident; // resolved incidents are immutable
		}

		// Check which of this incident's findings are still active
		const stillActiveFindingIds = incident.findings.filter((id) => currentFindingIds.has(id));

		if (stillActiveFindingIds.length === 0) {
			// No active findings — check runtime evidence before resolving
			const hasRecentRuntime = runtimeEvents.some(
				(e) => e.relatedIncidentId === incident.id && e.severity === 'error',
			);

			if (hasRecentRuntime) {
				// Keep open — runtime still shows errors
				return { ...incident, updatedAt: timestamp };
			}

			return {
				...incident,
				status: 'resolved',
				updatedAt: timestamp,
				resolvedAt: timestamp,
				findings: [],
			};
		}

		// Compute max severity of still-active findings
		const stillActiveFindings = currentFindings.filter((f) => stillActiveFindingIds.includes(f.id));
		const maxSeverity = stillActiveFindings.reduce<'error' | 'warning' | 'info'>(
			(max, f) => {
				if (f.severity === 'error') { return 'error'; }
				if (f.severity === 'warning' && max !== 'error') { return 'warning'; }
				return max;
			},
			'info',
		);

		const wasError = incident.title.includes('ERROR') || incident.title.includes('error');
		const mitigated = wasError && maxSeverity === 'warning';
		const newStatus: IncidentStatus = mitigated ? 'mitigated' : incident.status;

		return {
			...incident,
			status: newStatus,
			updatedAt: timestamp,
			findings: stillActiveFindingIds,
			impactedFiles: [...new Set([...incident.impactedFiles, ...impactedFiles])],
			relatedFiles: [...new Set([...incident.relatedFiles, ...relatedFiles])],
		};
	});

	// -------------------------------------------------------------------------
	// Step B: Open new incidents for uncovered error/warning findings
	// -------------------------------------------------------------------------
	const coveredFindingIds = new Set(
		updatedIncidents
			.filter((i) => i.status !== 'resolved')
			.flatMap((i) => i.findings),
	);

	const newFindingsByFile = new Map<string, Finding[]>();
	for (const f of currentFindings) {
		if (coveredFindingIds.has(f.id) || f.severity === 'info') { continue; }
		const group = newFindingsByFile.get(f.filePath) ?? [];
		group.push(f);
		newFindingsByFile.set(f.filePath, group);
	}

	for (const [filePath, findings] of newFindingsByFile) {
		const topSeverity = findings.some((f) => f.severity === 'error') ? 'ERROR' : 'WARNING';
		const kinds = [...new Set(findings.map((f) => f.kind))];
		const incidentId = `incident:${filePath}:${timestamp}:${kinds.join(',')}`;
		const title = `[${topSeverity}] ${findings[0].message} in ${filePath.split(/[\\/]/).pop() ?? filePath}`;

		updatedIncidents.push({
			id: incidentId,
			status: 'open',
			title,
			openedAt: timestamp,
			updatedAt: timestamp,
			findings: findings.map((f) => f.id),
			impactedFiles,
			relatedFiles,
		});
	}

	// -------------------------------------------------------------------------
	// Step C: Apply runtime event links (V3 — enrich incidents)
	// -------------------------------------------------------------------------
	const { incidents: runtimeEnrichedIncidents, enrichedEvents } =
		runtimeEvents.length > 0
			? applyRuntimeEventsToIncidents(updatedIncidents, runtimeEvents, currentFindings)
			: { incidents: updatedIncidents, enrichedEvents: runtimeEvents };

	return {
		incidents: runtimeEnrichedIncidents,
		enrichedRuntimeEvents: enrichedEvents,
	};
}
