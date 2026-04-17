import type * as vscode from 'vscode';
import type { RuntimeEvent } from './runtimeTypes';

const MAX_RUNTIME_EVENTS = 200;

/**
 * Lightweight runtime event store.
 * Backed by VS Code workspaceState, cached in-memory.
 */
export class RuntimeStore {
	private readonly eventsKey = 'timetrace-ai.runtimeEvents';
	private cache: RuntimeEvent[] | undefined;

	public constructor(private readonly memento: vscode.Memento) {}

	// ---------------------------------------------------------------------------
	// Write
	// ---------------------------------------------------------------------------

	public saveRuntimeEvent(event: RuntimeEvent): void {
		const events = this.getAllEvents();
		// Append + cap
		const updated = [...events, event].slice(-MAX_RUNTIME_EVENTS);
		this.cache = updated;
		void this.memento.update(this.eventsKey, updated);
	}

	public saveRuntimeEvents(events: RuntimeEvent[]): void {
		const existing = this.getAllEvents();
		const updated = [...existing, ...events].slice(-MAX_RUNTIME_EVENTS);
		this.cache = updated;
		void this.memento.update(this.eventsKey, updated);
	}

	// ---------------------------------------------------------------------------
	// Read — all
	// ---------------------------------------------------------------------------

	public getAllEvents(): RuntimeEvent[] {
		if (this.cache !== undefined) {
			return this.cache;
		}
		const stored = this.memento.get<RuntimeEvent[]>(this.eventsKey) ?? [];
		this.cache = stored;
		return stored;
	}

	/** Returns the N most recent events */
	public getRecentEvents(limit = 50): RuntimeEvent[] {
		return this.getAllEvents().slice(-limit);
	}

	// ---------------------------------------------------------------------------
	// Read — filtered
	// ---------------------------------------------------------------------------

	public getEventsByFile(filePath: string): RuntimeEvent[] {
		return this.getAllEvents().filter((e) => e.filePath === filePath);
	}

	public getEventsByCheckpoint(checkpointId: string): RuntimeEvent[] {
		return this.getAllEvents().filter((e) => e.relatedCheckpointId === checkpointId);
	}

	public getEventsByIncident(incidentId: string): RuntimeEvent[] {
		return this.getAllEvents().filter((e) => e.relatedIncidentId === incidentId);
	}

	// ---------------------------------------------------------------------------
	// Invalidate cache (e.g. after bulk update)
	// ---------------------------------------------------------------------------

	public invalidateCache(): void {
		this.cache = undefined;
	}
}
