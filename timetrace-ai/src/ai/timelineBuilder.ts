import type { RuntimeEvent, TimelineItem } from './runtimeTypes';
import type { Incident } from './types';
import type { TimelineCheckpointRecord } from './snapshotStore';

/**
 * Builds a unified, chronologically sorted timeline from checkpoints,
 * incident state changes, and runtime events.
 *
 * The UI can render this directly without stitching data itself.
 */
export function buildTimelineItems(
	checkpoints: TimelineCheckpointRecord[],
	incidents: Incident[],
	runtimeEvents: RuntimeEvent[],
): TimelineItem[] {
	const items: TimelineItem[] = [];

	// Checkpoints
	for (const cp of checkpoints) {
		items.push({
			kind: 'checkpoint',
			checkpointId: cp.timestamp, // timestamp is the stable id we use for checkpoints
			timestamp: cp.timestamp,
			filePath: cp.filePath,
			state: cp.state,
		});
	}

	// Incident updates — emit one item per incident state transition
	// We use openedAt as the "opened" event and resolvedAt/updatedAt for transitions
	for (const incident of incidents) {
		items.push({
			kind: 'incidentUpdate',
			incidentId: incident.id,
			timestamp: incident.openedAt,
			status: 'open',
			summary: incident.title,
			runtimeConfirmed: false,
		});

		if (incident.status === 'mitigated') {
			items.push({
				kind: 'incidentUpdate',
				incidentId: incident.id,
				timestamp: incident.updatedAt,
				status: 'mitigated',
				summary: `Mitigated: ${incident.title}`,
				runtimeConfirmed: incident.runtimeConfirmed,
			});
		}

		if (incident.status === 'resolved' && incident.resolvedAt) {
			items.push({
				kind: 'incidentUpdate',
				incidentId: incident.id,
				timestamp: incident.resolvedAt,
				status: 'resolved',
				summary: `Resolved: ${incident.title}`,
				runtimeConfirmed: incident.runtimeConfirmed,
			});
		}
	}

	// Runtime events
	for (const event of runtimeEvents) {
		items.push({
			kind: 'runtimeEvent',
			runtimeEventId: event.id,
			timestamp: event.timestamp,
			filePath: event.filePath,
			eventType: event.type,
			message: event.message,
			severity: event.severity,
			relatedCheckpointId: event.relatedCheckpointId,
			relatedIncidentId: event.relatedIncidentId,
		});
	}

	// Sort chronologically
	return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
