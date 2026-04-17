import * as assert from 'assert';

import { buildCodePanePayloadFromCodePreview } from '../extension';
import type { TimeTraceAnalysisResult } from '../ai/runTimeTraceAnalysis';
import type { CodePreviewRecord } from '../ai/snapshotStore';

suite('Extension Test Suite', () => {
	function makeResult(): TimeTraceAnalysisResult {
		return {
			state: 'WARNING',
			score: 5,
			checkpoint: true,
			previousState: 'NORMAL',
			reasons: ['risk signal'],
			analysis: 'analysis summary',
			changedLineRanges: [[10, 12]],
			features: {
				syntaxFailure: false,
				undefinedIdentifierDetected: false,
				nullCheckRemoved: true,
				tryCatchRemoved: false,
				heavyLoopAdded: false,
				complexityDelta: 1,
				todoHackCommentAdded: false,
				cosmetic: false,
				changedSymbols: ['run'],
				exportedNamesChanged: [],
				featureLineRanges: {},
				currentMetrics: { complexity: 2, guardCount: 0, tryCatchCount: 0, loopCount: 0, todoCommentCount: 0 },
				previousMetrics: { complexity: 1, guardCount: 1, tryCatchCount: 0, loopCount: 0, todoCommentCount: 0 },
			},
			findings: [
				{
					id: 'f1',
					kind: 'null_check_removed',
					severity: 'warning',
					message: 'null check removed',
					evidence: 'guard removed',
					confidence: 0.75,
					lineRange: [10, 12],
					filePath: '/repo/src/file.ts',
					timestamp: '2026-04-18T00:00:00.000Z',
				},
			],
			probableRootCauses: [
				{ filePath: '/repo/src/file.ts', confidence: 0.8, signals: ['signal'] },
			],
			incidents: [],
			impactedFiles: ['/repo/src/downstream.ts'],
			relatedFiles: ['/repo/src/related.ts'],
			runtimeEvents: [
				{
					id: 're1',
					type: 'RuntimeError',
					message: 'runtime failure',
					timestamp: '2026-04-18T00:00:02.000Z',
					severity: 'error',
					filePath: '/repo/src/file.ts',
					line: 11,
				},
			],
			timelineItems: [],
		};
	}

	test('buildCodePanePayloadFromCodePreview preserves before/after snapshots', () => {
		const preview: CodePreviewRecord = {
			before: ['if (!value) return;', 'return value.trim();'],
			after: ['return value.trim();', ''],
			focusLine: 2,
			startLine: 9,
			endLine: 12,
		};

		const payload = buildCodePanePayloadFromCodePreview(
			'/repo/src/file.ts',
			preview,
			makeResult(),
			'/repo',
			{ imports: {}, exports: {}, exportSignatures: {} },
		);

		assert.deepStrictEqual(payload.beforeSnippet.lines, preview.before);
		assert.deepStrictEqual(payload.afterSnippet.lines, preview.after);
		assert.notDeepStrictEqual(payload.beforeSnippet.lines, payload.afterSnippet.lines);
		assert.strictEqual(payload.beforeSnippet.startLine, 9);
		assert.strictEqual(payload.beforeSnippet.focusLine, 10);
		assert.strictEqual(payload.afterSnippet.focusLine, 10);
	});

	test('buildCodePanePayloadFromCodePreview keeps canonical runtime type in locations', () => {
		const preview: CodePreviewRecord = {
			before: ['line 1'],
			after: ['line 2'],
			focusLine: 1,
			startLine: 1,
		};

		const payload = buildCodePanePayloadFromCodePreview(
			'/repo/src/file.ts',
			preview,
			makeResult(),
			'/repo',
			{ imports: {}, exports: {}, exportSignatures: {} },
		);

		assert.strictEqual(payload.runtimeLocations.length, 1);
		assert.strictEqual(payload.runtimeLocations[0].eventType, 'RuntimeError');
	});
});
