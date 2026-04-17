import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runTimeTraceAnalysis } from './ai/runTimeTraceAnalysis';
import {
	SnapshotStore,
	type CodePreviewRecord,
	type TimelineCheckpointRecord,
} from './ai/snapshotStore';
import {
	emptyGraph,
	updateGraphForFile,
	computeDirectDownstream,
	type WorkspaceGraph,
} from './ai/dependencyGraph';
import type { TimeTraceAnalysisResult } from './ai';
import { RuntimeStore } from './ai/runtimeStore';
import { ingestRuntimeEvent } from './ai/runtimeIngestion';
import type { RuntimeEvent, RawRuntimeInput } from './ai';

interface SidebarTimelinePayload {
	filePath: string;
	timelineHistory: TimelineCheckpointRecord[];
	/** V3: Canonical unified timeline, ready for UI rendering */
	timelineItems?: import('./ai').TimelineItem[];
}

interface SidebarAnalysisPayload extends TimeTraceAnalysisResult {
	filePath: string;
	codePane?: CodePanePayload;
}

interface CodePaneSnippet {
	startLine: number;
	focusLine: number;
	lines: string[];
}

interface CodePaneFlowNode {
	id: string;
	label: string;
	role: string;
	kind: 'current' | 'import' | 'downstream' | 'related';
}

interface CodePaneFlowEdge {
	from: string;
	to: string;
	label?: string;
}

interface CodePaneFlow {
	title: string;
	summary: string;
	nodes: CodePaneFlowNode[];
	edges: CodePaneFlowEdge[];
}

interface CodePanePayload {
	currentFile: string;
	beforeSnippet: CodePaneSnippet;
	afterSnippet: CodePaneSnippet;
	findingLocations: Array<{ id: string; message: string; filePath: string; line?: number; severity: string }>;
	runtimeLocations: Array<{ id: string; message: string; eventType: string; filePath: string; line?: number; column?: number }>;
	rootCauseFiles: string[];
	relatedFiles: string[];
	impactedFiles: string[];
	flow: CodePaneFlow;
}

type WebviewMessage =
	| { type?: 'jumpToRootCause' }
	| { type?: 'openLocation'; payload?: { filePath?: string; line?: number; column?: number } }
	| { type?: 'openFile'; payload?: { filePath?: string } }
	| { type?: 'goToLine'; payload?: { filePath?: string; line?: number } };

function buildCodePreview(previousCode: string, currentCode: string, changedLineRanges: number[][]): CodePreviewRecord {
	const previousLines = previousCode.split(/\r?\n/);
	const currentLines = currentCode.split(/\r?\n/);
	const firstRange = changedLineRanges[0] ?? [1, 1];
	const startLine = Math.max(1, firstRange[0]);
	const endLine = Math.max(startLine, firstRange[1]);
	const previewStart = Math.max(1, startLine - 2);
	const previewEnd = endLine + 2;

	return {
		before: previousLines.slice(previewStart - 1, previewEnd),
		after: currentLines.slice(previewStart - 1, previewEnd),
		focusLine: Math.max(1, startLine - previewStart + 1),
		startLine: previewStart,
		endLine: previewEnd,
	};
}

function normalizeAbsolutePath(filePath: string, workspaceRoot: string): string {
	if (!filePath) {
		return '';
	}
	if (path.isAbsolute(filePath)) {
		return path.normalize(filePath);
	}
	if (!workspaceRoot) {
		return path.normalize(filePath);
	}
	return path.normalize(path.resolve(workspaceRoot, filePath));
}

function toWorkspaceRelative(filePath: string, workspaceRoot: string): string {
	if (!filePath) {
		return '';
	}
	const absolute = normalizeAbsolutePath(filePath, workspaceRoot);
	if (!workspaceRoot || !absolute.startsWith(workspaceRoot)) {
		return absolute;
	}
	const relative = path.relative(workspaceRoot, absolute);
	return relative || path.basename(absolute);
}

function classifyArchitectureRole(filePath: string): string {
	const value = filePath.toLowerCase();
	if (/route|router|endpoint/.test(value)) { return 'Route'; }
	if (/controller|handler/.test(value)) { return 'Handler'; }
	if (/service|manager|provider/.test(value)) { return 'Service'; }
	if (/repo|repository|dao/.test(value)) { return 'Repository'; }
	if (/cache|redis/.test(value)) { return 'Cache'; }
	if (/db|database|postgres|mongo|prisma|sql/.test(value)) { return 'Database'; }
	if (/api|client|fetch|axios/.test(value)) { return 'API Client'; }
	if (/worker|job|queue/.test(value)) { return 'Worker'; }
	if (/auth|middleware/.test(value)) { return 'Middleware'; }
	if (/component|view|screen|ui/.test(value)) { return 'Component'; }
	return 'Module';
}

function inferCodeFlow(
	filePath: string,
	workspaceRoot: string,
	graph: WorkspaceGraph,
	result: TimeTraceAnalysisResult,
): CodePaneFlow {
	const absoluteCurrent = normalizeAbsolutePath(filePath, workspaceRoot);
	const imports = graph.imports[absoluteCurrent] ?? [];
	const downstream = computeDirectDownstream(graph, absoluteCurrent);
	const related = [...result.relatedFiles, ...result.impactedFiles]
		.map((item) => normalizeAbsolutePath(item, workspaceRoot))
		.filter(Boolean);

	const candidates = [
		absoluteCurrent,
		...imports,
		...downstream,
		...related,
	].filter(Boolean);

	const uniqueCandidates = [...new Set(candidates)].slice(0, 10);
	const nodes: CodePaneFlowNode[] = uniqueCandidates.map((candidate, index) => {
		const kind: CodePaneFlowNode['kind'] = candidate === absoluteCurrent
			? 'current'
			: imports.includes(candidate)
				? 'import'
				: downstream.includes(candidate)
					? 'downstream'
					: 'related';

		return {
			id: `node-${index + 1}`,
			label: toWorkspaceRelative(candidate, workspaceRoot),
			role: classifyArchitectureRole(candidate),
			kind,
		};
	});

	const idByLabel = new Map(nodes.map((node) => [node.label, node.id]));
	const edges: CodePaneFlowEdge[] = [];

	for (const importedFile of imports.slice(0, 6)) {
		const fromLabel = toWorkspaceRelative(absoluteCurrent, workspaceRoot);
		const toLabel = toWorkspaceRelative(importedFile, workspaceRoot);
		const from = idByLabel.get(fromLabel);
		const to = idByLabel.get(toLabel);
		if (from && to) {
			edges.push({ from, to, label: 'imports' });
		}
	}

	for (const downstreamFile of downstream.slice(0, 4)) {
		const fromLabel = toWorkspaceRelative(downstreamFile, workspaceRoot);
		const toLabel = toWorkspaceRelative(absoluteCurrent, workspaceRoot);
		const from = idByLabel.get(fromLabel);
		const to = idByLabel.get(toLabel);
		if (from && to) {
			edges.push({ from, to, label: 'depends on' });
		}
	}

	const summary = edges.length > 0
		? `Inferred from import and downstream dependency signals across ${nodes.length} files.`
		: `Inferred from filename roles for ${nodes.length} file${nodes.length === 1 ? '' : 's'}.`;

	return {
		title: 'Inferred Code Path',
		summary,
		nodes,
		edges,
	};
}

function pickFocusLine(result: TimeTraceAnalysisResult): number {
	for (const finding of result.findings) {
		if (finding.lineRange && finding.lineRange.length >= 2) {
			return Math.max(1, finding.lineRange[0]);
		}
	}
	for (const runtimeEvent of result.runtimeEvents) {
		if (runtimeEvent.line && runtimeEvent.line > 0) {
			return runtimeEvent.line;
		}
	}
	const firstRange = result.changedLineRanges[0];
	if (firstRange && firstRange.length >= 2) {
		return Math.max(1, firstRange[0]);
	}
	return 1;
}

function buildSnippet(code: string, focusLine: number, radius = 4): CodePaneSnippet {
	const lines = code.split(/\r?\n/);
	const safeFocus = Math.max(1, Math.min(lines.length || 1, focusLine));
	const startLine = Math.max(1, safeFocus - radius);
	const endLine = Math.min(lines.length || 1, safeFocus + radius);
	return {
		startLine,
		focusLine: safeFocus,
		lines: lines.slice(startLine - 1, endLine),
	};
}

function buildCodePanePayload(
	filePath: string,
	previousCode: string,
	currentCode: string,
	result: TimeTraceAnalysisResult,
	workspaceRoot: string,
	graph: WorkspaceGraph,
): CodePanePayload {
	const focusLine = pickFocusLine(result);
	return {
		currentFile: toWorkspaceRelative(filePath, workspaceRoot),
		beforeSnippet: buildSnippet(previousCode, focusLine),
		afterSnippet: buildSnippet(currentCode, focusLine),
		findingLocations: result.findings.map((finding) => ({
			id: finding.id,
			message: finding.message,
			filePath: toWorkspaceRelative(finding.filePath || filePath, workspaceRoot),
			line: finding.lineRange?.[0],
			severity: finding.severity,
		})),
		runtimeLocations: result.runtimeEvents.map((event) => ({
			id: event.id,
			message: event.message,
			eventType: event.type,
			filePath: toWorkspaceRelative(event.filePath || filePath, workspaceRoot),
			line: event.line,
			column: event.column,
		})),
		rootCauseFiles: result.probableRootCauses
			.map((candidate) => toWorkspaceRelative(candidate.filePath, workspaceRoot))
			.filter(Boolean),
		relatedFiles: result.relatedFiles.map((relatedFile) => toWorkspaceRelative(relatedFile, workspaceRoot)).filter(Boolean),
		impactedFiles: result.impactedFiles.map((impactedFile) => toWorkspaceRelative(impactedFile, workspaceRoot)).filter(Boolean),
		flow: inferCodeFlow(filePath, workspaceRoot, graph, result),
	};
}

export function buildCodePanePayloadFromCodePreview(
	filePath: string,
	codePreview: CodePreviewRecord,
	result: TimeTraceAnalysisResult,
	workspaceRoot: string,
	graph: WorkspaceGraph,
): CodePanePayload {
	const startLine = Math.max(1, codePreview.startLine ?? 1);
	const focusOffset = Math.max(1, codePreview.focusLine ?? 1);
	const focusLine = startLine + focusOffset - 1;

	return {
		currentFile: toWorkspaceRelative(filePath, workspaceRoot),
		beforeSnippet: {
			startLine,
			focusLine,
			lines: codePreview.before,
		},
		afterSnippet: {
			startLine,
			focusLine,
			lines: codePreview.after,
		},
		findingLocations: result.findings.map((finding) => ({
			id: finding.id,
			message: finding.message,
			filePath: toWorkspaceRelative(finding.filePath || filePath, workspaceRoot),
			line: finding.lineRange?.[0],
			severity: finding.severity,
		})),
		runtimeLocations: result.runtimeEvents.map((event) => ({
			id: event.id,
			message: event.message,
			eventType: event.type,
			filePath: toWorkspaceRelative(event.filePath || filePath, workspaceRoot),
			line: event.line,
			column: event.column,
		})),
		rootCauseFiles: result.probableRootCauses
			.map((candidate) => toWorkspaceRelative(candidate.filePath, workspaceRoot))
			.filter(Boolean),
		relatedFiles: result.relatedFiles.map((relatedFile) => toWorkspaceRelative(relatedFile, workspaceRoot)).filter(Boolean),
		impactedFiles: result.impactedFiles.map((impactedFile) => toWorkspaceRelative(impactedFile, workspaceRoot)).filter(Boolean),
		flow: inferCodeFlow(filePath, workspaceRoot, graph, result),
	};
}

function buildTimelineCheckpointRecord(
	filePath: string,
	timestamp: string,
	result: TimeTraceAnalysisResult,
	codePreview: CodePreviewRecord,
): TimelineCheckpointRecord {
	return {
		filePath,
		timestamp,
		state: result.state,
		score: result.score,
		checkpoint: result.checkpoint,
		previousState: result.previousState,
		reasons: result.reasons,
		analysis: result.analysis,
		changedLineRanges: result.changedLineRanges,
		features: result.features,
		codePreview,
		findings: result.findings,
		probableRootCauses: result.probableRootCauses,
		incidents: result.incidents,
		impactedFiles: result.impactedFiles,
		relatedFiles: result.relatedFiles,
	};
}

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('TimeTrace AI');
	const snapshotStore = new SnapshotStore(context.workspaceState);
	const runtimeStore = new RuntimeStore(context.workspaceState);
	const provider = new TimeTraceSidebarProvider(context.extensionUri);

	// Determine workspace root for import resolution
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

	function publishTimelineForFile(filePath: string): void {
		const timelineHistory = snapshotStore.getTimelineHistory(filePath);
		const latest = snapshotStore.getLatestAnalysis(filePath);
		const timelineItems = latest?.result.timelineItems;

		provider.publishTimeline({
			filePath,
			timelineHistory,
			timelineItems,
		});
	}

	function publishLatestAnalysisForFile(filePath: string): void {
		const latest = snapshotStore.getLatestAnalysis(filePath);
		if (!latest) {
			return;
		}
		const snapshot = snapshotStore.getSnapshot(filePath);
		if (!snapshot) {
			return;
		}
		const graph = snapshotStore.getWorkspaceGraph() ?? emptyGraph();
		const timelineHistory = snapshotStore.getTimelineHistory(filePath);
		const latestCheckpoint = timelineHistory[timelineHistory.length - 1];

		const codePane = latestCheckpoint?.codePreview
			? buildCodePanePayloadFromCodePreview(
				filePath,
				latestCheckpoint.codePreview,
				latest.result,
				workspaceRoot,
				graph,
			)
			: buildCodePanePayload(
				filePath,
				snapshot.code,
				snapshot.code,
				latest.result,
				workspaceRoot,
				graph,
			);

		provider.publishAnalysisResult({
			filePath,
			...latest.result,
			codePane,
		});
	}

	function syncSidebarForDocument(document?: vscode.TextDocument): void {
		if (!document || document.isUntitled || document.uri.scheme !== 'file') {
			provider.publishTimeline({
				filePath: '',
				timelineHistory: [],
			});
			return;
		}

		publishTimelineForFile(document.uri.fsPath);
		publishLatestAnalysisForFile(document.uri.fsPath);
	}

	async function rebuildWorkspaceGraph(activeDocument: vscode.TextDocument, currentCode: string): Promise<WorkspaceGraph> {
		const graphSeed = emptyGraph();
		const uris = await vscode.workspace.findFiles(
			'**/*.{ts,tsx,js,jsx}',
			'**/{node_modules,out,dist,.git,.vscode-test}/**',
			500,
		);

		let graph = graphSeed;
		const activePath = activeDocument.uri.fsPath;
		const seenPaths = new Set<string>();

		for (const uri of uris) {
			const filePath = uri.fsPath;
			seenPaths.add(filePath);
			try {
				const code = filePath === activePath
					? currentCode
					: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
				graph = updateGraphForFile(graph, filePath, code, workspaceRoot);
			} catch {
				// Skip unreadable files so the save pipeline still completes.
			}
		}

		if (!seenPaths.has(activePath)) {
			graph = updateGraphForFile(graph, activePath, currentCode, workspaceRoot);
		}

		return graph;
	}

	async function analyzeDocument(document: vscode.TextDocument) {
		if (document.isUntitled || document.uri.scheme !== 'file') {
			return undefined;
		}

		const timestamp = new Date().toISOString();
		const previousSnapshot = snapshotStore.getSnapshot(document.uri.fsPath);
		const currentCode = document.getText();

		if (!previousSnapshot) {
			// First save — update graph, store baseline snapshot
			const graph = await rebuildWorkspaceGraph(document, currentCode);
			snapshotStore.saveWorkspaceGraph(graph);
			snapshotStore.saveSnapshot({
				filePath: document.uri.fsPath,
				language: document.languageId,
				timestamp,
				code: currentCode,
			});
			outputChannel.appendLine(`[baseline] Stored snapshot for ${document.uri.fsPath}`);
			publishTimelineForFile(document.uri.fsPath);
			return undefined;
		}

		// Update graph for this file
		const graph = await rebuildWorkspaceGraph(document, currentCode);
		snapshotStore.saveWorkspaceGraph(graph);

		// Gather V3 runtime context
		const runtimeEvents = runtimeStore.getEventsByFile(document.uri.fsPath);
		const persistedCheckpoints = snapshotStore.getTimelineHistory(document.uri.fsPath);

		// Run the full 6-step analysis pipeline
		const result = runTimeTraceAnalysis(
			{
				filePath: document.uri.fsPath,
				language: document.languageId,
				timestamp,
				previousCode: previousSnapshot.code,
				currentCode,
				previousState: previousSnapshot.state,
			},
			{
				existingIncidents: snapshotStore.getIncidents(),
				graph,
				recentSaves: snapshotStore.getRecentSaves(),
				workspaceRoot,
				runtimeEvents,
				recentCheckpoints: persistedCheckpoints,
				persistedCheckpoints,
			},
		);

		const codePreview = buildCodePreview(previousSnapshot.code, currentCode, result.changedLineRanges);

		// Persist
		snapshotStore.saveSnapshot({
			filePath: document.uri.fsPath,
			language: document.languageId,
			timestamp,
			code: currentCode,
			state: result.state,
		});
		snapshotStore.saveLatestAnalysis({
			filePath: document.uri.fsPath,
			timestamp,
			result,
			findings: result.findings,
		});
		snapshotStore.saveIncidents(result.incidents);

		// V3: Persist enriched runtime events back to store
		if (result.runtimeEvents.length > 0) {
			runtimeStore.saveRuntimeEvents(result.runtimeEvents);
		}

		if (result.checkpoint) {
			snapshotStore.saveTimelineCheckpoint(
				buildTimelineCheckpointRecord(document.uri.fsPath, timestamp, result, codePreview),
			);
		}

		// Output channel logging
		outputChannel.appendLine(JSON.stringify(result, null, 2));

		// Status bar — use first high-severity finding message if present
		const topFinding = result.findings.find((f) => f.severity === 'error') ?? result.findings.find((f) => f.severity === 'warning');
		const statusMsg = topFinding
			? `TimeTrace AI [${result.state}]: ${topFinding.message}`
			: `TimeTrace AI: ${result.state} (${result.score})`;
		vscode.window.setStatusBarMessage(statusMsg, 4000);

		publishTimelineForFile(document.uri.fsPath);
		provider.publishAnalysisResult({
			filePath: document.uri.fsPath,
			...result,
			codePane: buildCodePanePayload(
				document.uri.fsPath,
				previousSnapshot.code,
				currentCode,
				result,
				workspaceRoot,
				graph,
			),
		});

		if (result.checkpoint) {
			outputChannel.appendLine(
				`[checkpoint] ${document.uri.fsPath} ${result.previousState} -> ${result.state}`,
			);
			void vscode.window.showInformationMessage(`TimeTrace AI checkpoint: ${result.analysis}`);
		}

		return result;
	}

	context.subscriptions.push(outputChannel);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(TimeTraceSidebarProvider.viewType, provider),
		vscode.commands.registerCommand('timetrace-ai.openSidebar', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.timetraceAi');
			await vscode.commands.executeCommand('timetraceAi.sidebar.focus');
		}),
	);
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
		void analyzeDocument(document);
	}));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
		syncSidebarForDocument(editor?.document);
	}));

	const analyzeCurrentDocumentCommand = vscode.commands.registerCommand('timetrace-ai.analyzeCurrentDocument', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			void vscode.window.showWarningMessage('Open a file first to analyze it.');
			return;
		}

		const result = await analyzeDocument(editor.document);
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

	/**
	 * V3: Inject a test runtime event for demonstration/testing.
	 * In a real scenario, runtime events would be captured from the running application
	 * via event listeners, debugger integration, or runtime instrumentation.
	 */
	const injectTestRuntimeEventCommand = vscode.commands.registerCommand('timetrace-ai.injectTestRuntimeEvent', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			void vscode.window.showWarningMessage('Open a file first.');
			return;
		}

		// Create a test runtime error event
		const testEvent: RawRuntimeInput = {
			type: 'RuntimeError',
			error: new Error('Test runtime error: Null pointer exception in handler'),
			filePath: editor.document.uri.fsPath,
			line: 42,
			column: 15,
			timestamp: new Date().toISOString(),
		};

		try {
			const normalizedEvent = ingestRuntimeEvent(testEvent);
			runtimeStore.saveRuntimeEvent(normalizedEvent);

			outputChannel.appendLine(`[V3] Injected test runtime event: ${normalizedEvent.id}`);
			void vscode.window.showInformationMessage(
				`Test runtime event injected. Save the file to trigger re-analysis with the new runtime data.`,
			);

			// Auto-trigger re-analysis on the current document
			await analyzeDocument(editor.document);
		} catch (error) {
			outputChannel.appendLine(`[V3] Error injecting runtime event: ${error}`);
			void vscode.window.showErrorMessage(`Failed to inject runtime event: ${error}`);
		}
	});

	context.subscriptions.push(analyzeCurrentDocumentCommand, showLatestAnalysisCommand, injectTestRuntimeEventCommand);
	syncSidebarForDocument(vscode.window.activeTextEditor?.document);
	outputChannel.appendLine('TimeTrace AI activated. Save a file or run the analyze command to generate checkpoint history.');
	console.log('TimeTrace AI extension activated.');
}

export function deactivate() {}

class TimeTraceSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'timetraceAi.sidebar';
	private webviewView: vscode.WebviewView | undefined;
	private lastMessage:
		| {
				type: 'historyUpdate';
				payload: SidebarTimelinePayload;
		  }
		| {
				type: 'analysisResult';
				payload: SidebarAnalysisPayload;
		  }
		| undefined;

	public constructor(private readonly extensionUri: vscode.Uri) {}

	public publishTimeline(payload: SidebarTimelinePayload): void {
		this.lastMessage = {
			type: 'historyUpdate',
			payload,
		};
		this.postLastMessage();
	}

	public publishAnalysisResult(payload: SidebarAnalysisPayload): void {
		this.lastMessage = {
			type: 'analysisResult',
			payload,
		};
		this.postLastMessage();
	}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.webviewView = webviewView;
		const webview = webviewView.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};

		webview.html = this.getHtml(webview);
		this.postLastMessage();

		webview.onDidReceiveMessage((message: WebviewMessage) => {
			const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? '';

			const resolvePath = (candidatePath: string | undefined): string | undefined => {
				const normalized = normalizeAbsolutePath(candidatePath ?? activeFile, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');
				if (!normalized || !fs.existsSync(normalized)) {
					return undefined;
				}
				return normalized;
			};

			const openPath = async (targetPath: string, line?: number, column?: number): Promise<void> => {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
				const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });

				if (!line || line < 1) {
					return;
				}

				const safeLine = Math.max(1, Math.min(doc.lineCount, line));
				const safeColumn = Math.max(1, column ?? 1);
				const position = new vscode.Position(safeLine - 1, safeColumn - 1);
				const range = new vscode.Range(position, position);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
			};

			if (message.type === 'jumpToRootCause') {
				void vscode.window.showInformationMessage('Focused root-cause evidence for the selected failure state.');
				return;
			}

			if (message.type === 'openFile') {
				const targetPath = resolvePath(message.payload?.filePath);
				if (!targetPath) {
					void vscode.window.showWarningMessage('TimeTrace AI: file not found for navigation request.');
					return;
				}
				void openPath(targetPath);
				return;
			}

			if (message.type === 'openLocation') {
				const targetPath = resolvePath(message.payload?.filePath);
				if (!targetPath) {
					void vscode.window.showWarningMessage('TimeTrace AI: location file not found; opening active file if available.');
					const fallback = resolvePath(activeFile);
					if (fallback) {
						void openPath(fallback, message.payload?.line, message.payload?.column);
					}
					return;
				}
				void openPath(targetPath, message.payload?.line, message.payload?.column);
				return;
			}

			if (message.type === 'goToLine') {
				const targetPath = resolvePath(message.payload?.filePath);
				if (!targetPath) {
					void vscode.window.showWarningMessage('TimeTrace AI: unable to determine file for go-to-line request.');
					return;
				}
				void openPath(targetPath, message.payload?.line);
			}
		});
	}

	private postLastMessage(): void {
		if (!this.webviewView || !this.lastMessage) {
			return;
		}

		void this.webviewView.webview.postMessage(this.lastMessage);
	}

	private getHtml(webview: vscode.Webview): string {
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'));
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
	<title>TimeTrace AI</title>
	<link rel="stylesheet" href="${styleUri}" />
</head>
<body class="theme-auto">
	<div class="aurora"></div>
	<main class="panel" role="application" aria-label="TimeTrace AI Sidebar">
		<header class="header reveal">
			<div class="header-beam"></div>
			<div class="header-topline">
				<div>
					<h1>TimeTrace AI</h1>
					<p>Rewind. Analyze. Fix.</p>
				</div>
				<span class="header-pill" id="header-state-pill">NORMAL</span>
			</div>
			<div class="header-meta">
				<div class="header-meta-item">
					<span>File</span>
					<strong id="header-file">Demo mode</strong>
				</div>
				<div class="header-meta-item">
					<span>Checkpoint</span>
					<strong id="header-checkpoint">-</strong>
				</div>
				<div class="header-meta-item">
					<span>Score</span>
					<strong id="header-score">-</strong>
				</div>
			</div>
			<div class="header-underline"></div>
		</header>

		<nav class="pane-switch reveal" aria-label="Sidebar sections">
			<button class="pane-btn active" data-pane-target="overview" type="button">
				<span class="pane-icon" aria-hidden="true">O</span>
				<span class="pane-label">Overview</span>
			</button>
			<button class="pane-btn" data-pane-target="code" type="button">
				<span class="pane-icon" aria-hidden="true">{}</span>
				<span class="pane-label">Code</span>
			</button>
			<button class="pane-btn" data-pane-target="insights" type="button">
				<span class="pane-icon" aria-hidden="true">i</span>
				<span class="pane-label">Insights</span>
			</button>
		</nav>

		<section class="section hero reveal" id="timeline-section" data-pane="overview">
			<div class="timeline-topline">
				<div class="section-label">Replay Timeline</div>
				<div class="timeline-controls" aria-label="Replay controls">
					<div class="timeline-actions">
						<button class="icon-btn timeline-btn" id="timeline-rewind" type="button" aria-label="Rewind timeline" title="Rewind">
							<span>&#8630;</span>
						</button>
						<button class="icon-btn timeline-btn" id="timeline-play-pause" type="button" aria-label="Play timeline" title="Play / Pause">
							<span id="timeline-play-pause-icon">&#9654;</span>
						</button>
					</div>
				</div>
			</div>
			<div class="scenario-row" id="scenario-row">
				<label for="scenario-select">Scenario</label>
				<select id="scenario-select" aria-label="Select debugging scenario"></select>
			</div>
			<div class="timeline-empty hidden" id="timeline-empty">Waiting for checkpoint history.</div>

			<div class="timeline-wrap" id="timeline-wrap">
				<div class="timeline-inner" id="timeline-inner">
					<div class="timeline-track" id="timeline-track"></div>
					<div class="timeline-progress" id="timeline-progress"></div>
					<div class="timeline-nodes" id="timeline-nodes"></div>
				</div>
			</div>
			<div class="timeline-stamps" id="timeline-stamps" aria-label="Checkpoint timestamps"></div>
			<div class="timeline-stream" id="timeline-stream" aria-label="Unified checkpoint and runtime timeline"></div>
		</section>

		<section class="card glass reveal" id="error-card" data-pane="overview">
			<div class="card-title">Checkpoint Detail</div>
			<div class="checkpoint-kpis">
				<div class="checkpoint-pill">
					<span>State</span>
					<strong id="checkpoint-state" class="checkpoint-state-value"></strong>
				</div>
				<div class="checkpoint-pill">
					<span>Score</span>
					<strong id="checkpoint-score"></strong>
				</div>
			</div>
			<p class="checkpoint-summary" id="checkpoint-summary"></p>
			<div class="checkpoint-foot">
				<span class="checkpoint-transition" id="checkpoint-transition"></span>
				<span class="checkpoint-timestamp" id="checkpoint-timestamp"></span>
			</div>
		</section>

		<section class="card reveal" id="overview-root-cause-card" data-pane="overview">
			<div class="card-title">Root Cause Analysis</div>
			<p class="card-subtitle" id="overview-root-cause-summary">AI inferred causes for the selected checkpoint.</p>
			<div class="ranking-list" id="overview-root-cause-list"></div>
		</section>

		<section class="card telemetry-card reveal" id="latency-card" data-pane="insights">
			<div class="card-title">Checkpoint Signal</div>
			<div class="sparkline-wrap">
				<svg class="sparkline" id="sparkline" viewBox="0 0 180 54" preserveAspectRatio="none" aria-label="Checkpoint signal sparkline">
					<path id="sparkline-path" class="sparkline-path"></path>
					<circle id="sparkline-dot" class="sparkline-dot" r="3"></circle>
				</svg>
			</div>
			<div class="sparkline-meta">
				<span>Current</span>
				<strong id="latency-value"></strong>
			</div>
		</section>

		<section class="card runtime-card reveal" id="runtime-events-card" data-pane="insights">
			<div class="card-title">Runtime Events</div>
			<div class="runtime-events-list" id="runtime-events-list"></div>
			<div class="runtime-detail" id="runtime-detail">
				<div class="mini-title">Event Detail</div>
				<div class="runtime-detail-header">
					<span class="mini-pill" id="runtime-detail-type">No event selected</span>
					<span class="mini-pill" id="runtime-detail-status">Waiting</span>
				</div>
				<p id="runtime-detail-message">Select a runtime event to inspect stack details and links.</p>
				<div class="runtime-detail-grid">
					<div><span>Timestamp</span><strong id="runtime-detail-time">-</strong></div>
					<div><span>File</span><strong id="runtime-detail-file">-</strong></div>
					<div><span>Line</span><strong id="runtime-detail-line">-</strong></div>
					<div><span>Linked checkpoint</span><strong id="runtime-detail-checkpoint">-</strong></div>
				</div>
				<pre class="runtime-stack" id="runtime-detail-stack">No runtime stack captured yet.</pre>
			</div>
		</section>

		<section class="card root-cause reveal hidden" id="root-cause-card" data-pane="insights">
			<div class="card-title">Root-Cause Candidates</div>
			<div class="ranking-list" id="root-cause-list"></div>
		</section>

		<section class="card code-card reveal" id="code-card" data-pane="code">
			<div class="card-title">Relevant Code Segment</div>
			<p class="card-subtitle">Only impacted lines are shown</p>
			<div class="code-impact" id="changed-lines"></div>
			<div class="code-nav" id="code-nav">
				<div class="code-nav-header">
					<div class="mini-title">Editor Navigation</div>
					<div class="code-nav-subtitle">Jump from analysis to source instantly</div>
				</div>
				<div class="code-nav-actions" id="code-nav-actions"></div>
				<div class="code-go-line">
					<label for="code-go-line-input">Go to line</label>
					<div class="code-go-line-controls">
						<input id="code-go-line-input" type="number" min="1" step="1" placeholder="42" />
						<button class="btn btn-secondary" id="code-go-line-btn" type="button">Go</button>
					</div>
				</div>
			</div>
			<div class="snippet-layout" aria-live="polite">
				<section class="snippet-panel" id="before-snippet-panel">
					<div class="snippet-title-row">
						<div class="mini-title">Before Snapshot</div>
						<span class="mini-pill" id="before-focus-line">-</span>
					</div>
					<pre class="code-window" id="before-code-window"></pre>
				</section>
				<section class="snippet-panel" id="after-snippet-panel">
					<div class="snippet-title-row">
						<div class="mini-title">After Snapshot</div>
						<span class="mini-pill" id="after-focus-line">-</span>
					</div>
					<pre class="code-window" id="after-code-window"></pre>
				</section>
			</div>
			<div class="code-flow" id="code-flow">
				<div class="mini-title">Inferred Architecture Path</div>
				<div class="code-flow-summary" id="code-flow-summary"></div>
				<div class="code-flow-nodes" id="code-flow-nodes"></div>
			</div>
		</section>

		<section class="card flow-card reveal" id="impact-flow-card" data-pane="insights">
			<div class="card-title">Findings</div>
			<div class="findings-list" id="findings-list"></div>
		</section>

		<section class="card analysis-card reveal" id="analysis-card" data-pane="insights">
			<div class="card-title">Incident Detail</div>
			<div class="incident-list" id="incident-list"></div>
			<div class="incident-detail" id="incident-detail">
				<div class="incident-detail-header">
					<div>
						<div class="mini-title">Selected Incident</div>
						<strong id="incident-detail-summary">No incident selected</strong>
					</div>
					<span class="mini-pill" id="incident-detail-status">Waiting</span>
				</div>
				<div class="runtime-confirmation-row">
					<span class="mini-pill" id="incident-detail-runtime-confirmation">Suspected</span>
					<span class="mini-pill" id="incident-detail-severity">State</span>
				</div>
				<div class="incident-meta-grid">
					<div><span>Surfaced file</span><strong id="incident-detail-file">-</strong></div>
					<div><span>Checkpoint</span><strong id="incident-detail-checkpoint">-</strong></div>
					<div><span>Runtime evidence</span><strong id="incident-detail-runtime-count">0</strong></div>
					<div><span>Last runtime event</span><strong id="incident-detail-last-runtime">-</strong></div>
				</div>
				<p class="incident-reason" id="incident-detail-reason">Waiting for incident selection.</p>
				<div class="incident-section">
					<div class="mini-title">Linked Findings</div>
					<div class="linked-chip-row" id="incident-detail-findings"></div>
				</div>
				<div class="incident-section">
					<div class="mini-title">Root-Cause Candidates</div>
					<div class="linked-chip-row" id="incident-detail-causes"></div>
				</div>
				<div class="incident-section">
					<div class="mini-title">Runtime Evidence</div>
					<div class="linked-chip-row" id="incident-detail-runtime-events"></div>
				</div>
			</div>
			<div class="file-context-grid">
				<div>
					<div class="mini-title">Related Files</div>
					<div class="context-list" id="related-files-list"></div>
				</div>
				<div>
					<div class="mini-title">Impacted Files</div>
					<div class="context-list" id="impacted-files-list"></div>
				</div>
			</div>
			<div class="compat-block">
				<div class="mini-title">Compatibility Summary</div>
				<p id="analysis-summary"></p>
			</div>
		</section>
	</main>

	<script nonce="${nonce}">
		window.__timetraceApi = acquireVsCodeApi();
	</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}
