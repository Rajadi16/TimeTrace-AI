import type { AnalyzeChangeOutput, Incident } from './types';

function buildIncidentId(filePath: string): string {
	const base = filePath.replace(/[^a-zA-Z0-9]/g, '_').slice(-48);
	return `incident_${base}`;
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values));
}

export function updateIncidents(previousIncidents: Incident[], analysis: AnalyzeChangeOutput): Incident[] {
	const incidents = [...previousIncidents];
	const incidentId = buildIncidentId(analysis.findings[0]?.filePath ?? 'unknown');
	const incidentIndex = incidents.findIndex((incident) => incident.incidentId === incidentId);
	const relatedFiles = unique([
		...analysis.relatedFiles,
		...analysis.impactedFiles,
		analysis.findings[0]?.filePath ?? '',
	].filter((value) => value.length > 0));

	if (!analysis.findings.length) {
		if (incidentIndex >= 0) {
			const existing = incidents[incidentIndex];
			incidents[incidentIndex] = {
				...existing,
				status: 'resolved',
				summary: `Resolved after checkpoint ${analysis.checkpointId}.`,
				timelineTrail: [
					...existing.timelineTrail,
					{
						timestamp: analysis.findings[0]?.timestamp ?? analysis.checkpointId,
						filePath: existing.surfacedFile,
						checkpointId: analysis.checkpointId,
						state: analysis.state,
						linkedFindingIds: [],
						note: 'Findings cleared for this file.',
					},
				],
			};
		}
		return incidents;
	}

	const findingIds = analysis.findings.map((finding) => finding.id);
	if (incidentIndex < 0) {
		incidents.push({
			incidentId,
			status: analysis.state === 'NORMAL' ? 'mitigated' : 'open',
			surfacedFile: analysis.findings[0].filePath,
			surfacedCheckpointId: analysis.checkpointId,
			linkedFindingIds: findingIds,
			probableRootCauses: analysis.probableRootCauses,
			relatedFiles,
			timelineTrail: [{
				timestamp: analysis.findings[0].timestamp,
				filePath: analysis.findings[0].filePath,
				checkpointId: analysis.checkpointId,
				state: analysis.state,
				linkedFindingIds: findingIds,
				note: analysis.analysis,
			}],
			summary: analysis.analysis,
		});
		return incidents;
	}

	const existing = incidents[incidentIndex];
	incidents[incidentIndex] = {
		...existing,
		status: analysis.state === 'NORMAL' ? 'mitigated' : 'open',
		surfacedCheckpointId: analysis.checkpointId,
		linkedFindingIds: unique([...existing.linkedFindingIds, ...findingIds]),
		probableRootCauses: analysis.probableRootCauses,
		relatedFiles: unique([...existing.relatedFiles, ...relatedFiles]),
		timelineTrail: [
			...existing.timelineTrail,
			{
				timestamp: analysis.findings[0].timestamp,
				filePath: analysis.findings[0].filePath,
				checkpointId: analysis.checkpointId,
				state: analysis.state,
				linkedFindingIds: findingIds,
				note: analysis.analysis,
			},
		],
		summary: analysis.analysis,
	};

	return incidents;
}
