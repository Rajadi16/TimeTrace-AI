import type { Finding, FindingKind, Incident, IncidentStatus } from './types';

// ---------------------------------------------------------------------------
// Incident matching — compare by filePath + findingKind
// ---------------------------------------------------------------------------

function incidentKey(filePath: string, kinds: FindingKind[]): string {
	return `${filePath}:${[...kinds].sort().join(',')}`;
}

function getIncidentKinds(incident: Incident, allFindings: Finding[]): FindingKind[] {
	const findingsById = new Map(allFindings.map((f) => [f.id, f]));
	return incident.findings.map((id) => findingsById.get(id)?.kind).filter((k): k is FindingKind => !!k);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function updateIncidents(
	existingIncidents: Incident[],
	currentFindings: Finding[],
	impactedFiles: string[],
	relatedFiles: string[],
	timestamp: string,
): Incident[] {
	// Index current findings by id
	const currentFindingIds = new Set(currentFindings.map((f) => f.id));

	// Group current findings by filePath for easier matching
	const findingsByFile = new Map<string, Finding[]>();
	for (const f of currentFindings) {
		const existing = findingsByFile.get(f.filePath) ?? [];
		existing.push(f);
		findingsByFile.set(f.filePath, existing);
	}

	// Process existing incidents
	const updatedIncidents: Incident[] = existingIncidents.map((incident): Incident => {
		if (incident.status === 'resolved') {
			return incident; // resolved incidents are immutable
		}

		// Check which of this incident's findings are still active
		const stillActiveFindingIds = incident.findings.filter((id) => currentFindingIds.has(id));

		if (stillActiveFindingIds.length === 0) {
			// No active findings → resolve
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

		// Determine if severity decreased compared to when incident opened
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

	// Open new incidents for findings not covered by any existing open/mitigated incident
	const coveredFindingIds = new Set(
		updatedIncidents
			.filter((i) => i.status !== 'resolved')
			.flatMap((i) => i.findings),
	);

	// Group new uncovered error/warning findings by file
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

	return updatedIncidents;
}
