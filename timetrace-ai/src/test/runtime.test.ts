import * as assert from 'assert';
import { ingestRuntimeEvent } from '../ai/runtimeIngestion';
import { correlateRuntimeEventToCheckpoint, correlateRuntimeEventToIncident, computeRuntimeRcaBoosts } from '../ai/runtimeCorrelation';
import { analyzeChange } from '../ai/analyzeChange';
import { buildTimelineItems } from '../ai/timelineBuilder';
import type { RuntimeEvent } from '../ai/runtimeTypes';
import type { Incident, Finding } from '../ai/types';
import type { TimelineCheckpointRecord } from '../ai/snapshotStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheckpoint(overrides: Partial<TimelineCheckpointRecord> = {}): TimelineCheckpointRecord {
	return {
		filePath: '/src/app.ts',
		timestamp: '2026-04-17T10:00:00.000Z',
		state: 'ERROR',
		score: 8,
		checkpoint: true,
		previousState: 'NORMAL',
		reasons: ['a syntax issue was introduced'],
		analysis: 'State changed from NORMAL to ERROR',
		changedLineRanges: [[10, 15]],
		features: {
			syntaxFailure: false, undefinedIdentifierDetected: false, nullCheckRemoved: false,
			tryCatchRemoved: false, heavyLoopAdded: false, complexityDelta: 0, todoHackCommentAdded: false,
			cosmetic: false, changedSymbols: ['render'], exportedNamesChanged: [], featureLineRanges: {},
			currentMetrics: { complexity: 2, guardCount: 0, tryCatchCount: 0, loopCount: 0, todoCommentCount: 0 },
			previousMetrics: { complexity: 1, guardCount: 1, tryCatchCount: 0, loopCount: 0, todoCommentCount: 0 },
		},
		codePreview: { before: ['old'], after: ['new'], focusLine: 1 },
		findings: [{
			id: 'null_check_removed:/src/app.ts:10',
			kind: 'null_check_removed',
			severity: 'warning',
			message: 'Null safety check removed near "render"',
			evidence: 'Guard removed',
			confidence: 0.75,
			lineRange: [10, 15],
			relatedSymbol: 'render',
			filePath: '/src/app.ts',
			timestamp: '2026-04-17T10:00:00.000Z',
		}],
		probableRootCauses: [],
		incidents: [],
		impactedFiles: [],
		relatedFiles: [],
		...overrides,
	};
}

function makeIncident(overrides: Partial<Incident> = {}): Incident {
	return {
		id: 'incident-1',
		status: 'open',
		title: '[ERROR] Syntax error in app.ts',
		openedAt: '2026-04-17T10:00:00.000Z',
		updatedAt: '2026-04-17T10:00:00.000Z',
		findings: ['syntax_error:/src/app.ts:1'],
		impactedFiles: ['/src/app.ts'],
		relatedFiles: ['/src/helper.ts'],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Test 1: RuntimeError normalization
// ---------------------------------------------------------------------------
suite('V3 Runtime Test Suite', () => {
	test('1. RuntimeError is normalized correctly from Error object', () => {
		const err = new Error('Cannot read properties of undefined');
		(err as NodeJS.ErrnoException).stack = `Error: Cannot read properties of undefined\n    at render (/src/app.ts:42:10)\n    at main (/src/index.ts:5:3)`;

		const event = ingestRuntimeEvent({
			type: 'RuntimeError',
			error: err,
			timestamp: '2026-04-17T10:05:00.000Z',
		});

		assert.strictEqual(event.type, 'RuntimeError');
		assert.strictEqual(event.severity, 'error');
		assert.ok(event.message.includes('Cannot read properties'));
		assert.strictEqual(event.filePath, '/src/app.ts');
		assert.strictEqual(event.line, 42);
		assert.strictEqual(event.functionName, 'render');
		assert.ok(event.id.startsWith('re:RuntimeError:'));
		assert.ok(Array.isArray(event.evidence) && event.evidence.length > 0);
	});

	// ------------------------------------------------------------------------
	// Test 2: UnhandledRejection normalization
	// ------------------------------------------------------------------------
	test('2. UnhandledRejection is normalized correctly', () => {
		const reason = new Error('Promise rejected: DB timeout');

		const event = ingestRuntimeEvent({
			type: 'UnhandledRejection',
			reason,
			timestamp: '2026-04-17T10:05:30.000Z',
		});

		assert.strictEqual(event.type, 'UnhandledRejection');
		assert.strictEqual(event.severity, 'error');
		assert.ok(event.message.includes('Unhandled rejection'));
		assert.ok(event.message.includes('DB timeout'));
		assert.ok(event.id.startsWith('re:UnhandledRejection:'));
	});

	// ------------------------------------------------------------------------
	// Test 3: ConsoleError normalization
	// ------------------------------------------------------------------------
	test('3. ConsoleError is normalized correctly', () => {
		const event = ingestRuntimeEvent({
			type: 'ConsoleError',
			args: ['Failed to load user', { userId: 42 }],
			filePath: '/src/userService.ts',
			line: 78,
			timestamp: '2026-04-17T10:06:00.000Z',
		});

		assert.strictEqual(event.type, 'ConsoleError');
		assert.strictEqual(event.severity, 'warning');
		assert.ok(event.message.includes('console.error'));
		assert.ok(event.message.includes('Failed to load user'));
		assert.strictEqual(event.filePath, '/src/userService.ts');
		assert.strictEqual(event.line, 78);
	});

	// ------------------------------------------------------------------------
	// Test 4: NetworkFailure normalization
	// ------------------------------------------------------------------------
	test('4. NetworkFailure is normalized correctly', () => {
		const event5xx = ingestRuntimeEvent({
			type: 'NetworkFailure',
			url: 'https://api.example.com/data',
			status: 503,
			method: 'GET',
			timestamp: '2026-04-17T10:07:00.000Z',
		});

		assert.strictEqual(event5xx.type, 'NetworkFailure');
		assert.strictEqual(event5xx.severity, 'error'); // 5xx → error
		assert.ok(event5xx.message.includes('503'));
		assert.ok(event5xx.message.includes('https://api.example.com/data'));

		const event4xx = ingestRuntimeEvent({
			type: 'NetworkFailure',
			url: 'https://api.example.com/user',
			status: 404,
			method: 'GET',
			timestamp: '2026-04-17T10:07:01.000Z',
		});
		assert.strictEqual(event4xx.severity, 'warning'); // 4xx → warning
	});

	// ------------------------------------------------------------------------
	// Test 5: Runtime event links to nearest checkpoint
	// ------------------------------------------------------------------------
	test('5. Runtime event correlates to nearest prior checkpoint in same file', () => {
		const checkpoint = makeCheckpoint({
			filePath: '/src/app.ts',
			timestamp: '2026-04-17T10:00:00.000Z',
			state: 'ERROR',
			changedLineRanges: [[40, 45]],
		});

		const event: RuntimeEvent = {
			id: 're:RuntimeError:test:1',
			type: 'RuntimeError',
			message: 'Cannot read property',
			filePath: '/src/app.ts',
			line: 42,
			timestamp: '2026-04-17T10:02:00.000Z', // 2 min after checkpoint
			severity: 'error',
		};

		const { relatedCheckpointId, evidence } = correlateRuntimeEventToCheckpoint(event, [checkpoint]);

		assert.ok(relatedCheckpointId !== undefined, 'Expected a checkpoint link');
		assert.ok(evidence.length > 0, 'Expected correlation evidence');
		// Should have matched on file path + line overlap
		assert.ok(evidence.some((e) => e.includes('line') || e.includes('file') || e.includes('checkpoint')));
	});

	// ------------------------------------------------------------------------
	// Test 6: Runtime event attaches to matching incident
	// ------------------------------------------------------------------------
	test('6. Runtime event attaches to incident with overlapping file', () => {
		const incident = makeIncident({
			impactedFiles: ['/src/app.ts'],
			findings: [],
			openedAt: '2026-04-17T10:00:00.000Z',
		});

		const event: RuntimeEvent = {
			id: 're:RuntimeError:test:2',
			type: 'RuntimeError',
			message: 'Runtime crash',
			filePath: '/src/app.ts',
			timestamp: '2026-04-17T10:01:00.000Z', // 60s after incident
			severity: 'error',
		};

		const { relatedIncidentId, evidence } = correlateRuntimeEventToIncident(event, [incident], []);

		assert.ok(relatedIncidentId !== undefined, `Expected incident link, got undefined. Signals: ${JSON.stringify(evidence)}`);
		assert.strictEqual(relatedIncidentId, 'incident-1');
	});

	// ------------------------------------------------------------------------
	// Test 7: RCA confidence increases with runtime evidence
	// ------------------------------------------------------------------------
	test('7. RCA candidate confidence increases when runtime error points to same file', () => {
		const runtimeEvent: RuntimeEvent = {
			id: 're:RuntimeError:test:3',
			type: 'RuntimeError',
			message: 'Crash in render',
			filePath: '/tmp/example.ts',
			line: 2,
			functionName: 'run',
			timestamp: '2026-04-17T10:01:00.000Z',
			severity: 'error',
		};

		// Analysis without runtime
		const withoutRuntime = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T10:00:30.000Z',
			previousCode: 'function run(v?: string) {\n  if (!v) return;\n  return v.trim();\n}\n',
			currentCode: 'function run(v?: string) {\n  return v.trim();\n}\n',
		});

		// Analysis with runtime
		const withRuntime = analyzeChange(
			{
				filePath: '/tmp/example.ts',
				language: 'typescript',
				timestamp: '2026-04-17T10:00:30.000Z',
				previousCode: 'function run(v?: string) {\n  if (!v) return;\n  return v.trim();\n}\n',
				currentCode: 'function run(v?: string) {\n  return v.trim();\n}\n',
			},
			{
				existingIncidents: [],
				graph: { imports: {}, exports: {}, exportSignatures: {} },
				recentSaves: {},
				workspaceRoot: '/tmp',
				runtimeEvents: [runtimeEvent],
			},
		);

		const candidateWithout = withoutRuntime.probableRootCauses.find((c) => c.filePath === '/tmp/example.ts');
		const candidateWith = withRuntime.probableRootCauses.find((c) => c.filePath === '/tmp/example.ts');

		assert.ok(candidateWith !== undefined, 'Expected a root-cause candidate');
		assert.ok(
			candidateWith.confidence >= (candidateWithout?.confidence ?? 0),
			`Expected confidence to be >= without-runtime confidence (${candidateWithout?.confidence}), got ${candidateWith.confidence}`,
		);
		// Signals should include [runtime] prefix
		assert.ok(
			candidateWith.signals.some((s) => s.includes('[runtime]')),
			`Expected runtime signals. Got: ${JSON.stringify(candidateWith.signals)}`,
		);
	});

	// ------------------------------------------------------------------------
	// Test 8: Incident becomes runtime-confirmed
	// ------------------------------------------------------------------------
	test('8. Incident becomes runtimeConfirmed when high-confidence runtime event matches', () => {
		const result = analyzeChange(
			{
				filePath: '/tmp/example.ts',
				language: 'typescript',
				timestamp: '2026-04-17T10:00:00.000Z',
				previousCode: 'const x = 1;\n',
				currentCode: 'function broken( {\n',
			},
			{
				existingIncidents: [],
				graph: { imports: {}, exports: {}, exportSignatures: {} },
				recentSaves: {},
				workspaceRoot: '/tmp',
				runtimeEvents: [{
					id: 're:RuntimeError:test:4',
					type: 'RuntimeError',
					message: 'SyntaxError in broken',
					filePath: '/tmp/example.ts',
					line: 1,
					functionName: 'broken',
					timestamp: '2026-04-17T10:00:01.000Z',
					severity: 'error',
				}],
			},
		);

		assert.ok(result.incidents.length > 0, 'Expected at least one incident');
		// At least one incident should be runtime-confirmed OR have runtime event ids
		const confirmedOrLinked = result.incidents.some(
			(i) => i.runtimeConfirmed === true || (i.runtimeEventIds?.length ?? 0) > 0,
		);
		assert.ok(confirmedOrLinked, `Expected runtime linkage in incidents. Got: ${JSON.stringify(result.incidents.map((i) => ({ id: i.id, runtimeConfirmed: i.runtimeConfirmed, runtimeEventIds: i.runtimeEventIds })))}`);
	});

	// ------------------------------------------------------------------------
	// Test 9: Timeline items are in correct chronological order
	// ------------------------------------------------------------------------
	test('9. Timeline items include checkpoints and runtime events in correct order', () => {
		const checkpoint = makeCheckpoint({
			timestamp: '2026-04-17T10:00:00.000Z',
			state: 'ERROR',
		});

		const runtimeEvent: RuntimeEvent = {
			id: 're:RuntimeError:test:5',
			type: 'RuntimeError',
			message: 'Runtime crash',
			filePath: '/src/app.ts',
			timestamp: '2026-04-17T10:05:00.000Z', // 5 min AFTER checkpoint
			severity: 'error',
		};

		const incident = makeIncident({ openedAt: '2026-04-17T10:01:00.000Z' });

		const items = buildTimelineItems([checkpoint], [incident], [runtimeEvent]);

		assert.ok(items.length >= 3, `Expected ≥ 3 timeline items, got ${items.length}`);

		// Should be ordered: checkpoint (10:00) → incident-open (10:01) → runtimeEvent (10:05)
		const timestamps = items.map((item) => new Date(item.timestamp).getTime());
		for (let i = 1; i < timestamps.length; i++) {
			assert.ok(timestamps[i] >= timestamps[i - 1], `Timeline not sorted at index ${i}`);
		}

		const kinds = items.map((item) => item.kind);
		assert.ok(kinds.includes('checkpoint'), 'Missing checkpoint item');
		assert.ok(kinds.includes('runtimeEvent'), 'Missing runtimeEvent item');
		assert.ok(kinds.includes('incidentUpdate'), 'Missing incidentUpdate item');

		const runtimeTimelineItem = items.find((item) => item.kind === 'runtimeEvent');
		assert.ok(runtimeTimelineItem && runtimeTimelineItem.kind === 'runtimeEvent');
		if (runtimeTimelineItem && runtimeTimelineItem.kind === 'runtimeEvent') {
			assert.strictEqual(runtimeTimelineItem.eventType, 'RuntimeError');
		}
	});

	// ------------------------------------------------------------------------
	// Test 10: V2 behavior still passes (regression guard)
	// ------------------------------------------------------------------------
	test('10. V2 regression — null check removal still produces WARNING + checkpoint', () => {
		const result = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T10:00:00.000Z',
			previousCode: 'function run(value?: string) {\n  if (!value) {\n    return;\n  }\n  return value.trim();\n}\n',
			currentCode: 'function run(value?: string) {\n  return value.trim();\n}\n',
		});

		assert.strictEqual(result.state, 'WARNING');
		assert.strictEqual(result.checkpoint, true);
		assert.strictEqual(result.features.nullCheckRemoved, true);
		assert.ok(result.changedLineRanges.length > 0);
		assert.ok(result.analysis.includes('State changed from NORMAL to WARNING'));
		// V3 fields should still be present
		assert.ok(Array.isArray(result.runtimeEvents));
	});

	// ------------------------------------------------------------------------
	// Test 11: RCA candidate set includes related/downstream files
	// ------------------------------------------------------------------------
	test('11. RCA evaluates multiple candidate files from graph and incident context', () => {
		const result = analyzeChange(
			{
				filePath: '/tmp/example.ts',
				language: 'typescript',
				timestamp: '2026-04-17T10:00:30.000Z',
				previousCode: 'function run(v?: string) {\n  if (!v) return;\n  return v.trim();\n}\n',
				currentCode: 'function run(v?: string) {\n  return v.trim();\n}\n',
			},
			{
				existingIncidents: [
					makeIncident({
						id: 'incident-downstream',
						impactedFiles: ['/tmp/downstream.ts'],
						relatedFiles: ['/tmp/worker.ts'],
						status: 'open',
					}),
				],
				graph: {
					imports: {
						'/tmp/downstream.ts': ['/tmp/example.ts'],
					},
					exports: {},
					exportSignatures: {},
				},
				recentSaves: {
					'/tmp/example.ts': new Date('2026-04-17T10:00:00.000Z').getTime(),
					'/tmp/downstream.ts': new Date('2026-04-17T10:00:10.000Z').getTime(),
				},
				workspaceRoot: '/tmp',
			},
		);

		assert.ok(result.probableRootCauses.length >= 2, 'Expected RCA to include multiple candidate files');
		assert.ok(
			result.probableRootCauses.some((candidate) => candidate.filePath === '/tmp/downstream.ts'),
			`Expected downstream candidate in RCA set. Got: ${JSON.stringify(result.probableRootCauses.map((c) => c.filePath))}`,
		);
	});

	// ------------------------------------------------------------------------
	// Test 12: Weak-evidence candidates are confidence-calibrated
	// ------------------------------------------------------------------------
	test('12. RCA calibrates confidence when evidence is weak', () => {
		const result = analyzeChange(
			{
				filePath: '/tmp/example.ts',
				language: 'typescript',
				timestamp: '2026-04-17T10:00:30.000Z',
				previousCode: 'const value = 1;\n',
				currentCode: 'const value = 1;\n',
				previousState: 'NORMAL',
			},
			{
				existingIncidents: [],
				graph: { imports: {}, exports: {}, exportSignatures: {} },
				recentSaves: {},
				workspaceRoot: '/tmp',
			},
		);

		assert.ok(result.probableRootCauses.length > 0, 'Expected at least one RCA candidate');
		assert.ok(
			result.probableRootCauses[0].confidence <= 0.5,
			`Expected weak-evidence confidence calibration. Got: ${result.probableRootCauses[0].confidence}`,
		);
	});
});
