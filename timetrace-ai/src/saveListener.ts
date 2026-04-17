import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	AnalysisRequest,
	ChangedLineRange,
	toAnalysisLanguage,
} from './contracts/analysis';

type SnapshotStore = Map<string, string>;

export function registerSaveListener(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): void {
	const snapshotStore: SnapshotStore = new Map<string, string>();

	const seedSnapshot = (document: vscode.TextDocument): void => {
		if (!isTrackableDocument(document)) {
			return;
		}

		snapshotStore.set(document.uri.toString(), document.getText());
	};

	vscode.workspace.textDocuments.forEach(seedSnapshot);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(seedSnapshot),
		vscode.workspace.onDidCloseTextDocument((document) => {
			snapshotStore.delete(document.uri.toString());
		}),
		vscode.workspace.onDidSaveTextDocument((document) => {
			handleDocumentSave(document, snapshotStore, outputChannel);
		}),
	);
}

function handleDocumentSave(
	document: vscode.TextDocument,
	snapshotStore: SnapshotStore,
	outputChannel: vscode.OutputChannel,
): void {
	const request = buildAnalysisRequest(document, snapshotStore);
	if (!request) {
		return;
	}

	snapshotStore.set(document.uri.toString(), request.currentCode);

	outputChannel.appendLine(
		`[${request.timestamp}] Save detected for ${request.filePath} (${request.language})`,
	);
	outputChannel.appendLine(JSON.stringify(request, null, 2));
	outputChannel.appendLine('');

	vscode.window.setStatusBarMessage(
		`TimeTrace AI captured save: ${request.filePath}`,
		2500,
	);
}

function buildAnalysisRequest(
	document: vscode.TextDocument,
	snapshotStore: SnapshotStore,
): AnalysisRequest | undefined {
	const language = toAnalysisLanguage(document.languageId);
	if (!language || document.uri.scheme !== 'file') {
		return undefined;
	}

	const currentCode = document.getText();
	const previousCode = snapshotStore.get(document.uri.toString()) ?? currentCode;

	return {
		filePath: toContractFilePath(document),
		language,
		timestamp: new Date().toISOString(),
		previousCode,
		currentCode,
		changedLineRanges: computeChangedLineRanges(previousCode, currentCode),
		saveId: `save_${randomUUID()}`,
	};
}

function isTrackableDocument(document: vscode.TextDocument): boolean {
	return document.uri.scheme === 'file' && toAnalysisLanguage(document.languageId) !== undefined;
}

function toContractFilePath(document: vscode.TextDocument): string {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!workspaceFolder) {
		return document.uri.fsPath.replace(/\\/g, '/');
	}

	const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
	return (relativePath || path.basename(document.uri.fsPath)).replace(/\\/g, '/');
}

function computeChangedLineRanges(
	previousCode: string,
	currentCode: string,
): ChangedLineRange[] {
	if (previousCode === currentCode) {
		return [];
	}

	const previousLines = toLines(previousCode);
	const currentLines = toLines(currentCode);

	let commonPrefixLength = 0;
	while (
		commonPrefixLength < previousLines.length &&
		commonPrefixLength < currentLines.length &&
		previousLines[commonPrefixLength] === currentLines[commonPrefixLength]
	) {
		commonPrefixLength++;
	}

	let previousSuffixIndex = previousLines.length - 1;
	let currentSuffixIndex = currentLines.length - 1;
	while (
		previousSuffixIndex >= commonPrefixLength &&
		currentSuffixIndex >= commonPrefixLength &&
		previousLines[previousSuffixIndex] === currentLines[currentSuffixIndex]
	) {
		previousSuffixIndex--;
		currentSuffixIndex--;
	}

	const startLine = Math.max(1, commonPrefixLength + 1);
	const endLine = Math.max(startLine, currentSuffixIndex + 1);
	return [[startLine, endLine]];
}

function toLines(source: string): string[] {
	if (source.length === 0) {
		return [];
	}

	return source.replace(/\r\n/g, '\n').split('\n');
}
