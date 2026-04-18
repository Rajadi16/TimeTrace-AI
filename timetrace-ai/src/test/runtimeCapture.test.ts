import * as assert from 'assert';
import {
	captureRuntimeSignalsFromDiagnostics,
	RuntimeSignalDeduper,
	type DiagnosticCaptureInput,
} from '../ai/runtimeCapture';

suite('Runtime Capture Suite', () => {
	test('maps diagnostic errors to RuntimeError raw inputs', () => {
		const diagnostics: DiagnosticCaptureInput[] = [
			{
				message: 'Cannot find name userService',
				severity: 'error',
				source: 'ts',
				code: 2304,
				startLine: 4,
				startCharacter: 10,
			},
		];

		const signals = captureRuntimeSignalsFromDiagnostics(
			'/repo/src/app.ts',
			diagnostics,
			'2026-04-18T10:00:00.000Z',
		);

		assert.strictEqual(signals.length, 1);
		const signal = signals[0];
		assert.ok(signal.fingerprint.includes('/repo/src/app.ts'));
		assert.strictEqual(signal.rawInput.type, 'RuntimeError');
		if (signal.rawInput.type === 'RuntimeError') {
			assert.strictEqual(signal.rawInput.filePath, '/repo/src/app.ts');
			assert.strictEqual(signal.rawInput.line, 5);
			assert.strictEqual(signal.rawInput.column, 11);
			assert.ok(signal.rawInput.error.message.includes('Cannot find name userService'));
			assert.ok(signal.rawInput.error.message.includes('[ts]'));
		}
	});

	test('maps diagnostic warnings to ConsoleError raw inputs', () => {
		const diagnostics: DiagnosticCaptureInput[] = [
			{
				message: 'Unused variable requestId',
				severity: 'warning',
				source: 'eslint',
				code: 'no-unused-vars',
				startLine: 1,
				startCharacter: 2,
			},
		];

		const signals = captureRuntimeSignalsFromDiagnostics(
			'/repo/src/handler.ts',
			diagnostics,
			'2026-04-18T10:00:01.000Z',
		);

		assert.strictEqual(signals.length, 1);
		assert.strictEqual(signals[0].rawInput.type, 'ConsoleError');
		if (signals[0].rawInput.type === 'ConsoleError') {
			assert.strictEqual(signals[0].rawInput.filePath, '/repo/src/handler.ts');
			assert.strictEqual(signals[0].rawInput.line, 2);
			assert.ok(String(signals[0].rawInput.args[0]).includes('Unused variable requestId'));
		}
	});

	test('ignores info and hint diagnostics', () => {
		const diagnostics: DiagnosticCaptureInput[] = [
			{
				message: 'Suggestion only',
				severity: 'info',
				startLine: 0,
				startCharacter: 0,
			},
			{
				message: 'Hint only',
				severity: 'hint',
				startLine: 0,
				startCharacter: 0,
			},
		];

		const signals = captureRuntimeSignalsFromDiagnostics(
			'/repo/src/handler.ts',
			diagnostics,
			'2026-04-18T10:00:02.000Z',
		);

		assert.strictEqual(signals.length, 0);
	});

	test('deduper suppresses repeats within window and allows later repeats', () => {
		const deduper = new RuntimeSignalDeduper(5000, 100);
		const fingerprint = 'diagnostic::/repo/src/app.ts::error::ts::2304::4::10::Cannot find name';

		assert.strictEqual(deduper.isDuplicate(fingerprint, 1000), false);
		assert.strictEqual(deduper.isDuplicate(fingerprint, 3000), true);
		assert.strictEqual(deduper.isDuplicate(fingerprint, 7001), false);
	});
});
