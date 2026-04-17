import * as vscode from 'vscode';
import { runTimeTraceAnalysis } from './ai/runTimeTraceAnalysis';
import { SnapshotStore } from './ai/snapshotStore';

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('TimeTrace AI');
	const snapshotStore = new SnapshotStore(context.globalState);

	function analyzeDocument(document: vscode.TextDocument) {
		if (document.isUntitled || document.uri.scheme !== 'file') {
			return undefined;
		}

		const previousSnapshot = snapshotStore.getSnapshot(document.uri.fsPath);
		const currentCode = document.getText();

		if (!previousSnapshot) {
			snapshotStore.saveSnapshot({
				filePath: document.uri.fsPath,
				language: document.languageId,
				timestamp: new Date().toISOString(),
				code: currentCode,
			});
			outputChannel.appendLine(`[baseline] Stored snapshot for ${document.uri.fsPath}`);
			return undefined;
		}

		const result = runTimeTraceAnalysis({
			filePath: document.uri.fsPath,
			language: document.languageId,
			timestamp: new Date().toISOString(),
			previousCode: previousSnapshot.code,
			currentCode,
			previousState: previousSnapshot.state,
		});

		snapshotStore.saveSnapshot({
			filePath: document.uri.fsPath,
			language: document.languageId,
			timestamp: new Date().toISOString(),
			code: currentCode,
			state: result.state,
		});
		snapshotStore.saveLatestAnalysis({
			filePath: document.uri.fsPath,
			timestamp: new Date().toISOString(),
			result,
		});

		outputChannel.appendLine(JSON.stringify(result, null, 2));
		vscode.window.setStatusBarMessage(`TimeTrace AI: ${result.state} (${result.score})`, 4000);
		if (result.checkpoint) {
			void vscode.window.showInformationMessage(`TimeTrace AI checkpoint: ${result.analysis}`);
		}
		return result;
	}

	context.subscriptions.push(outputChannel);
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
		analyzeDocument(document);
	}));

	const helloWorldCommand = vscode.commands.registerCommand('timetrace-ai.helloWorld', () => {
		void vscode.window.showInformationMessage('Hello World from timetrace-ai!');
	});

	const analyzeCurrentDocumentCommand = vscode.commands.registerCommand('timetrace-ai.analyzeCurrentDocument', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			void vscode.window.showWarningMessage('Open a file first to analyze it.');
			return;
		}

		const result = analyzeDocument(editor.document);
		if (!result) {
			void vscode.window.showInformationMessage('Baseline snapshot captured. Edit and save the file again to trigger analysis.');
			return;
		}

		void vscode.window.showInformationMessage(`TimeTrace AI ${result.state}: ${result.analysis}`);
	});

	const showLatestAnalysisCommand = vscode.commands.registerCommand('timetrace-ai.showLatestAnalysis', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			void vscode.window.showWarningMessage('Open a file first to inspect the latest analysis.');
			return;
		}

		const latest = snapshotStore.getLatestAnalysis(editor.document.uri.fsPath);
		if (!latest) {
			void vscode.window.showInformationMessage('No saved analysis exists yet for this file.');
			return;
		}

		outputChannel.show(true);
		outputChannel.appendLine(JSON.stringify(latest.result, null, 2));
		void vscode.window.showInformationMessage(`Latest TimeTrace AI result for ${editor.document.fileName} is available in the output channel.`);
	});

	context.subscriptions.push(helloWorldCommand, analyzeCurrentDocumentCommand, showLatestAnalysisCommand);
	outputChannel.appendLine('TimeTrace AI activated. Save a file or run the analyze command to generate a checkpoint.');
	console.log('TimeTrace AI extension activated.');
}

export function deactivate() {}
