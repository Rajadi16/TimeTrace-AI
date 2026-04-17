import * as assert from 'assert';
import { SnapshotStore, type TimelineCheckpointRecord } from '../ai/snapshotStore';

class MockMemento {
	private readonly store = new Map<string, unknown>();
	public keys: readonly string[] = [];

	public get<T>(key: string): T | undefined {
		return this.store.get(key) as T | undefined;
	}

	public update(key: string, value: unknown): Promise<void> {
		this.store.set(key, value);
		this.keys = [...this.store.keys()];
		return Promise.resolve();
	}
}

function createCheckpointRecord(index: number, filePath = '/tmp/example.ts'): TimelineCheckpointRecord {
	const timestamp = `2026-04-17T00:00:${String(index).padStart(2, '0')}.000Z`;

	return {
		filePath,
		timestamp,
		state: index % 2 === 0 ? 'WARNING' : 'ERROR',
		score: index,
		checkpoint: true,
		previousState: index % 2 === 0 ? 'NORMAL' : 'WARNING',
		reasons: [`reason-${index}`],
		analysis: `analysis-${index}`,
		changedLineRanges: [[index + 1, index + 2]],
		features: {
			syntaxFailure: false,
			undefinedIdentifierDetected: false,
			nullCheckRemoved: false,
			tryCatchRemoved: false,
			heavyLoopAdded: false,
			complexityDelta: 0,
			todoHackCommentAdded: false,
			currentMetrics: {
				complexity: 1,
				guardCount: 1,
				tryCatchCount: 0,
				loopCount: 0,
				todoCommentCount: 0,
			},
			previousMetrics: {
				complexity: 1,
				guardCount: 1,
				tryCatchCount: 0,
				loopCount: 0,
				todoCommentCount: 0,
			},
		},
		codePreview: {
			before: [`before-${index}`],
			after: [`after-${index}`],
			focusLine: 1,
		},
	};
}

suite('Snapshot Store Timeline Suite', () => {
	test('persists checkpoint history per file in order', () => {
		const store = new SnapshotStore(new MockMemento() as never);

		store.saveTimelineCheckpoint(createCheckpointRecord(1));
		store.saveTimelineCheckpoint(createCheckpointRecord(2));

		const history = store.getTimelineHistory('/tmp/example.ts');
		assert.strictEqual(history.length, 2);
		assert.strictEqual(history[0].analysis, 'analysis-1');
		assert.strictEqual(history[1].analysis, 'analysis-2');
	});

	test('keeps histories isolated by file path', () => {
		const store = new SnapshotStore(new MockMemento() as never);

		store.saveTimelineCheckpoint(createCheckpointRecord(1, '/tmp/one.ts'));
		store.saveTimelineCheckpoint(createCheckpointRecord(2, '/tmp/two.ts'));

		assert.strictEqual(store.getTimelineHistory('/tmp/one.ts').length, 1);
		assert.strictEqual(store.getTimelineHistory('/tmp/two.ts').length, 1);
		assert.strictEqual(store.getTimelineHistory('/tmp/one.ts')[0].filePath, '/tmp/one.ts');
		assert.strictEqual(store.getTimelineHistory('/tmp/two.ts')[0].filePath, '/tmp/two.ts');
	});

	test('caps checkpoint history to the latest 50 entries per file', () => {
		const store = new SnapshotStore(new MockMemento() as never);

		for (let index = 1; index <= 55; index += 1) {
			store.saveTimelineCheckpoint(createCheckpointRecord(index));
		}

		const history = store.getTimelineHistory('/tmp/example.ts');
		assert.strictEqual(history.length, 50);
		assert.strictEqual(history[0].analysis, 'analysis-6');
		assert.strictEqual(history[49].analysis, 'analysis-55');
	});
});
