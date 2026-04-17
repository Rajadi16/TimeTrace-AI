import * as assert from 'assert';
import { analyzeChange } from '../ai/analyzeChange';
import { runTimeTraceAnalysis } from '../ai/runTimeTraceAnalysis';

suite('AI Engine Test Suite', () => {
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

		assert.deepStrictEqual(Object.keys(result).sort(), [
			'analysis',
			'changedLineRanges',
			'checkpoint',
			'features',
			'previousState',
			'reasons',
			'score',
			'state',
		].sort());
		assert.strictEqual((result as { confidence?: number }).confidence, undefined);
	});
});