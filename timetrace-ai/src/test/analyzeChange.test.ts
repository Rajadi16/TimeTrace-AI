import * as assert from 'assert';
import { analyzeChange } from '../ai/analyzeChange';
import { runTimeTraceAnalysis } from '../ai/runTimeTraceAnalysis';
import { detectFindings } from '../ai/findingDetector';
import { extractFeatures } from '../ai/featureExtractor';

suite('AI Engine Test Suite', () => {
	// ---- Legacy pipeline tests (backward-compat) ----

	test('detects null check removal and returns a checkpoint', () => {
		const result = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:00.000Z',
			previousCode: 'function run(value?: string) {\n  if (!value) {\n    return;\n  }\n  return value.trim();\n}\n',
			currentCode: 'function run(value?: string) {\n  return value.trim();\n}\n',
		});

		assert.strictEqual(result.state, 'WARNING');
		assert.strictEqual(result.checkpoint, true);
		assert.strictEqual(result.features.nullCheckRemoved, true);
		assert.ok(result.changedLineRanges.length > 0);
		assert.ok(result.analysis.includes('State changed from NORMAL to WARNING'));
	});

	test('detects syntax failure as an error', () => {
		const result = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:00.000Z',
			previousCode: 'const value = 1;\n',
			currentCode: 'function broken( {\n',
		});

		assert.strictEqual(result.state, 'ERROR');
		assert.strictEqual(result.features.syntaxFailure, true);
		assert.strictEqual(result.checkpoint, true);
	});

	test('detects try/catch removal and comment risk', () => {
		const result = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:00.000Z',
			previousCode: 'function run() {\n  try {\n    doWork();\n  } catch (error) {\n    console.error(error);\n  }\n}\n',
			currentCode: 'function run() {\n  if (ready) {\n    doWork();\n  }\n}\n// TODO: handle retries\n',
		});

		assert.strictEqual(result.features.tryCatchRemoved, true);
		assert.strictEqual(result.features.todoHackCommentAdded, true);
		assert.ok(result.score >= 5);
	});

	test('treats a fixed broken file as recovery', () => {
		const result = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:00.000Z',
			previousCode: 'function broken( {\n',
			currentCode: 'function fixed(value: string) {\n  return value.trim();\n}\n',
			previousState: 'ERROR',
		});

		assert.strictEqual(result.state, 'NORMAL');
		assert.strictEqual(result.checkpoint, true);
		assert.ok(result.analysis.includes('State changed from ERROR to NORMAL after the risky issue was fixed.'));
	});

	test('shim returns the stable UI contract without confidence', () => {
		const result = runTimeTraceAnalysis({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:00.000Z',
			previousCode: 'function render(user?: {name:string}) {\n  if (!user) return;\n  console.log(user.name);\n}\n',
			currentCode: 'function render(user?: {name:string}) {\n  console.log(user.name);\n}\n',
		});

		const keys = Object.keys(result).sort();
		assert.ok(keys.includes('state'));
		assert.ok(keys.includes('score'));
		assert.ok(keys.includes('checkpoint'));
		assert.ok(keys.includes('previousState'));
		assert.ok(keys.includes('reasons'));
		assert.ok(keys.includes('analysis'));
		assert.ok(keys.includes('changedLineRanges'));
		assert.ok(keys.includes('features'));
		// New fields
		assert.ok(keys.includes('findings'));
		assert.ok(keys.includes('probableRootCauses'));
		assert.ok(keys.includes('incidents'));
		assert.ok(keys.includes('impactedFiles'));
		assert.ok(keys.includes('relatedFiles'));
		assert.strictEqual((result as { confidence?: number }).confidence, undefined);
	});

	// ---- New pipeline tests ----

	test('cosmetic-only change produces zero findings and no checkpoint', () => {
		const previousCode = 'function greet(name: string) {\n  return name;\n}\n';
		const currentCode = 'function greet(name: string) {\n  // say hello\n  return name;\n}\n';

		const result = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:01.000Z',
			previousCode,
			currentCode,
			previousState: 'NORMAL',
		});

		assert.strictEqual(result.features.cosmetic, true);
		assert.strictEqual(result.findings.length, 0);
		assert.strictEqual(result.checkpoint, false);
		assert.strictEqual(result.state, 'NORMAL');
	});

	test('findings array has correct kinds for null check removal', () => {
		const features = extractFeatures({
			language: 'typescript',
			previousCode: 'function run(v?: string) {\n  if (!v) return;\n  return v.trim();\n}\n',
			currentCode: 'function run(v?: string) {\n  return v.trim();\n}\n',
			changedLineRanges: [[2, 3]],
		});

		const findings = detectFindings(
			{ filePath: '/tmp/example.ts', timestamp: '2026-04-17T00:00:00.000Z', changedLineRanges: [[2, 3]] },
			features,
		);

		const kinds = findings.map((f) => f.kind);
		assert.ok(kinds.includes('null_check_removed'), `Expected null_check_removed in ${JSON.stringify(kinds)}`);
		assert.ok(findings.every((f) => f.severity === 'error' || f.severity === 'warning' || f.severity === 'info'));
		assert.ok(findings.every((f) => f.confidence > 0 && f.confidence <= 1));
		assert.ok(findings.every((f) => typeof f.evidence === 'string' && f.evidence.length > 0));
	});

	test('syntax error finding has error severity', () => {
		const features = extractFeatures({
			language: 'typescript',
			previousCode: 'const x = 1;\n',
			currentCode: 'function broken( {\n',
			changedLineRanges: [[1, 1]],
		});

		const findings = detectFindings(
			{ filePath: '/tmp/example.ts', timestamp: '2026-04-17T00:00:00.000Z', changedLineRanges: [[1, 1]] },
			features,
		);

		assert.ok(findings.some((f) => f.kind === 'syntax_error' && f.severity === 'error'));
	});

	test('incident is opened for a new error finding', () => {
		const result = analyzeChange(
			{
				filePath: '/tmp/example.ts',
				language: 'typescript',
				timestamp: '2026-04-17T00:00:00.000Z',
				previousCode: 'const x = 1;\n',
				currentCode: 'function broken( {\n',
			},
			{
				existingIncidents: [],
				graph: { imports: {}, exports: {}, exportSignatures: {} },
				recentSaves: {},
				workspaceRoot: '/tmp',
			},
		);

		assert.ok(result.incidents.length > 0, 'Expected at least one incident to be opened');
		assert.strictEqual(result.incidents[0].status, 'open');
	});

	test('incident is resolved when all its findings disappear', () => {
		// First save — open an incident
		const firstResult = analyzeChange(
			{
				filePath: '/tmp/example.ts',
				language: 'typescript',
				timestamp: '2026-04-17T00:00:00.000Z',
				previousCode: 'const x = 1;\n',
				currentCode: 'function broken( {\n',
			},
			{
				existingIncidents: [],
				graph: { imports: {}, exports: {}, exportSignatures: {} },
				recentSaves: {},
				workspaceRoot: '/tmp',
			},
		);

		assert.ok(firstResult.incidents.some((i) => i.status === 'open'));

		// Second save — fix the file
		const secondResult = analyzeChange(
			{
				filePath: '/tmp/example.ts',
				language: 'typescript',
				timestamp: '2026-04-17T00:00:01.000Z',
				previousCode: 'function broken( {\n',
				currentCode: 'const x = 1;\n',
				previousState: 'ERROR',
			},
			{
				existingIncidents: firstResult.incidents,
				graph: { imports: {}, exports: {}, exportSignatures: {} },
				recentSaves: {},
				workspaceRoot: '/tmp',
			},
		);

		assert.ok(secondResult.incidents.every((i) => i.status === 'resolved'), 'Expected all incidents to be resolved');
	});

	test('complexity spike only fires at delta > 3', () => {
		// Delta of 2 — should not fire complexity_spike
		const features = extractFeatures({
			language: 'typescript',
			previousCode: 'function f() { if (a) { } }\n',
			currentCode: 'function f() { if (a) { } if (b) { } if (c) { } }\n',
			changedLineRanges: [[1, 1]],
		});

		const findings = detectFindings(
			{ filePath: '/tmp/example.ts', timestamp: '2026-04-17T00:00:00.000Z', changedLineRanges: [[1, 1]] },
			features,
		);

		// Only fires if delta > 3
		const hasSpike = findings.some((f) => f.kind === 'complexity_spike');
		if (features.complexityDelta <= 3) {
			assert.strictEqual(hasSpike, false, 'complexity_spike should not fire at delta <= 3');
		} else {
			assert.strictEqual(hasSpike, true, 'complexity_spike should fire at delta > 3');
		}
	});
});