import * as assert from 'assert';
import { analyzeChange } from '../ai/analyzeChange';
import { runTimeTraceAnalysis } from '../ai/runTimeTraceAnalysis';
import { buildWorkspaceDependencyGraph } from '../ai/workspaceGraph';

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
		assert.ok(result.findings.length >= 1);
		assert.ok(result.findings.some((finding) => finding.type === 'RemovedNullGuard'));
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
		assert.ok(result.findings.some((finding) => finding.type === 'SyntaxFailure'));
	});

	test('detects multiple findings in one change set', () => {
		const result = analyzeChange({
			filePath: '/tmp/example.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:00.000Z',
			previousCode: 'function run() {\n  try {\n    doWork();\n  } catch (error) {\n    console.error(error);\n  }\n}\n',
			currentCode: 'function run() {\n  if (ready) {\n    doWork();\n  }\n  return data.value.name;\n}\n// TODO: handle retries\n',
		});

		assert.strictEqual(result.features.tryCatchRemoved, true);
		assert.strictEqual(result.features.todoHackCommentAdded, true);
		assert.ok(result.findings.length >= 3);
		assert.ok(result.findings.some((finding) => finding.type === 'RemovedTryCatch'));
		assert.ok(result.findings.some((finding) => finding.type === 'AddedTodoHack'));
		assert.ok(result.findings.some((finding) => finding.type === 'SemanticDiagnostic'));
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

		assert.strictEqual(result.schemaVersion, '2.0');
		assert.ok(Array.isArray(result.findings));
		assert.ok(Array.isArray(result.incidents));
		assert.ok(Array.isArray(result.probableRootCauses));
		assert.strictEqual((result as { confidence?: number }).confidence, undefined);
	});

	test('marks direct dependents when export signatures change', () => {
		const graph = buildWorkspaceDependencyGraph([
			{
				filePath: '/tmp/api.ts',
				language: 'typescript',
				code: 'export interface User { id: string }\nexport function getUser(): User { return { id: "1" }; }\n',
			},
			{
				filePath: '/tmp/page.ts',
				language: 'typescript',
				code: 'import { getUser } from "./api";\nexport const run = () => getUser();\n',
			},
		], '2026-04-17T00:00:00.000Z');

		const result = analyzeChange({
			filePath: '/tmp/api.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:00:00.000Z',
			previousCode: 'export interface User { id: string }\nexport function getUser(): User { return { id: "1" }; }\n',
			currentCode: 'export interface User { id: number }\nexport function getUser(): User { return { id: 1 }; }\n',
			workspaceGraph: graph,
		});

		assert.ok(result.findings.some((finding) => finding.type === 'ChangedExportSignature'));
		assert.ok(result.findings.some((finding) => finding.type === 'DownstreamDependencyRisk'));
		assert.ok(result.impactedFiles.includes('/tmp/page.ts'));
	});

	test('ranks probable upstream root causes for downstream symptoms', () => {
		const graph = buildWorkspaceDependencyGraph([
			{
				filePath: '/tmp/api.ts',
				language: 'typescript',
				code: 'export function getUser(): {id: number} { return { id: 1 }; }\n',
			},
			{
				filePath: '/tmp/page.ts',
				language: 'typescript',
				code: 'import { getUser } from "./api";\nconst user = getUser();\nconsole.log(user.name);\n',
			},
		], '2026-04-17T00:05:00.000Z');

		const result = analyzeChange({
			filePath: '/tmp/page.ts',
			language: 'typescript',
			timestamp: '2026-04-17T00:05:00.000Z',
			previousCode: 'import { getUser } from "./api";\nconst user = getUser();\nconsole.log(user.id);\n',
			currentCode: 'import { getUser } from "./api";\nconst user = getUser();\nconsole.log(unresolvedUser.name);\n',
			workspaceGraph: graph,
			knownAnalysesByFile: {
				'/tmp/api.ts': {
					filePath: '/tmp/api.ts',
					timestamp: '2026-04-17T00:02:00.000Z',
					checkpointId: 'cp_1',
					state: 'WARNING',
					findings: [{
						id: 'f_api_export',
						type: 'ChangedExportSignature',
						severity: 'HIGH',
						confidence: 0.82,
						filePath: '/tmp/api.ts',
						changedLineRanges: [[1, 1]],
						message: 'export changed',
						evidence: ['shape updated'],
						timestamp: '2026-04-17T00:02:00.000Z',
					}],
				},
			},
		});

		assert.ok(result.probableRootCauses.length > 0);
		assert.ok(result.probableRootCauses.some((candidate) => candidate.filePath === '/tmp/api.ts'));
	});
});