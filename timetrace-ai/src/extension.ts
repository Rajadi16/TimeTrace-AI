import * as vscode from 'vscode';
import { runTimeTraceAnalysis } from './ai/runTimeTraceAnalysis';
import {
	SnapshotStore,
	type CodePreviewRecord,
	type TimelineCheckpointRecord,
} from './ai/snapshotStore';
import type { TimeTraceAnalysisResult } from './ai';

interface SidebarTimelinePayload {
	filePath: string;
	timelineHistory: TimelineCheckpointRecord[];
}

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
	};
}

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('TimeTrace AI');
	const snapshotStore = new SnapshotStore(context.globalState);
	const provider = new TimeTraceSidebarProvider(context.extensionUri);

	function publishTimelineForFile(filePath: string): void {
		provider.publishTimeline({
			filePath,
			timelineHistory: snapshotStore.getTimelineHistory(filePath),
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
	}

	function analyzeDocument(document: vscode.TextDocument) {
		if (document.isUntitled || document.uri.scheme !== 'file') {
			return undefined;
		}

		const timestamp = new Date().toISOString();
		const previousSnapshot = snapshotStore.getSnapshot(document.uri.fsPath);
		const currentCode = document.getText();

		if (!previousSnapshot) {
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

		const result = runTimeTraceAnalysis({
			filePath: document.uri.fsPath,
			language: document.languageId,
			timestamp,
			previousCode: previousSnapshot.code,
			currentCode,
			previousState: previousSnapshot.state,
		});
		const codePreview = buildCodePreview(previousSnapshot.code, currentCode, result.changedLineRanges);

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
		});
		if (result.checkpoint) {
			snapshotStore.saveTimelineCheckpoint(
				buildTimelineCheckpointRecord(document.uri.fsPath, timestamp, result, codePreview),
			);
		}

		outputChannel.appendLine(JSON.stringify(result, null, 2));
		vscode.window.setStatusBarMessage(`TimeTrace AI: ${result.state} (${result.score})`, 4000);
		publishTimelineForFile(document.uri.fsPath);
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
		})
	);
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
		analyzeDocument(document);
	}));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
		syncSidebarForDocument(editor?.document);
	}));


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

	context.subscriptions.push(analyzeCurrentDocumentCommand, showLatestAnalysisCommand);
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
		| undefined;

	public constructor(private readonly extensionUri: vscode.Uri) {}

	public publishTimeline(payload: SidebarTimelinePayload): void {
		this.lastMessage = {
			type: 'historyUpdate',
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

		webview.onDidReceiveMessage((message: { type?: string }) => {
			if (message.type === 'jumpToRootCause') {
				void vscode.window.showInformationMessage('Focused root-cause evidence for the selected failure state.');
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
			<h1>TimeTrace AI</h1>
			<p>Rewind. Analyze. Fix.</p>
			<div class="header-underline"></div>
		</header>

		<section class="section hero reveal" id="timeline-section">
			<div class="timeline-topline">
				<div class="section-label">Incident Timeline</div>
				<div class="timeline-meta">
					<span id="timeline-source">Demo mode</span>
					<span id="timeline-count"></span>
				</div>
			</div>
			<div class="scenario-row" id="scenario-row">
				<label for="scenario-select">Scenario</label>
				<select id="scenario-select" aria-label="Select debugging scenario"></select>
			</div>
			<div class="timeline-empty hidden" id="timeline-empty">Waiting for checkpoint history.</div>

			<div class="timeline-wrap" id="timeline-wrap">
				<div class="timeline-track" id="timeline-track"></div>
				<div class="timeline-progress" id="timeline-progress"></div>
				<div class="timeline-nodes" id="timeline-nodes"></div>
				<input id="scrubber" type="range" min="0" max="2" step="1" value="0" aria-label="Rewind timeline scrubber" />
			</div>

			<div class="timeline-legend">
				<span class="pill normal">Normal</span>
				<span class="pill warning">Warning</span>
				<span class="pill error">Error</span>
			</div>

			<button class="btn btn-secondary" id="timeline-replay" type="button">Replay Timeline</button>
			<div class="playback-row">
				<label for="replay-speed">Replay Speed</label>
				<select id="replay-speed" aria-label="Replay speed selector">
					<option value="slow">Cinematic</option>
					<option value="normal" selected>Balanced</option>
					<option value="fast">Rapid</option>
				</select>
			</div>
		</section>

		<section class="card glass reveal" id="error-card">
			<div class="card-title">Error Details</div>
			<div class="metrics">
				<div><span>Type</span><strong id="error-type"></strong></div>
				<div><span>Line</span><strong id="error-line"></strong></div>
				<div><span>Timestamp</span><strong id="error-time"></strong></div>
			</div>
		</section>

		<section class="card telemetry-card reveal" id="latency-card">
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

		<section class="card root-cause reveal hidden" id="root-cause-card">
			<div class="card-title">Checkpoint Details</div>
			<div class="checkpoint-strip">
				<span class="state-badge" id="state-badge"></span>
				<span class="checkpoint-timestamp" id="checkpoint-timestamp"></span>
			</div>
			<p id="root-cause-text"></p>
		</section>

		<section class="card code-card reveal" id="code-card">
			<div class="card-title">Relevant Code Segment</div>
			<p class="card-subtitle">Only impacted lines are shown</p>
			<div class="code-impact" id="changed-lines"></div>
			<div class="code-toggle" role="tablist" aria-label="Before and after code states">
				<button class="toggle-btn active" id="before-tab" data-state="before" type="button">Before</button>
				<button class="toggle-btn" id="after-tab" data-state="after" type="button">After</button>
			</div>
			<pre class="code-window" id="code-window" aria-live="polite"></pre>
		</section>

		<section class="card flow-card reveal" id="impact-flow-card">
			<div class="card-title">Impact Flow</div>
			<div class="flow" id="impact-flow" aria-label="System impact flow"></div>
		</section>

		<section class="card analysis-card reveal" id="analysis-card">
			<div class="card-title">AI Analysis</div>
			<div class="analysis-block">
				<h3>Summary</h3>
				<p id="analysis-summary"></p>
			</div>
			<div class="analysis-block">
				<h3>Root Cause</h3>
				<p id="analysis-cause"></p>
			</div>
			<div class="analysis-block">
				<h3>Impact</h3>
				<p id="analysis-impact"></p>
			</div>
		</section>

		<section class="card control-card reveal">
			<div class="card-title">Controls</div>
			<div class="control-grid">
				<button class="btn" id="jump-root" type="button">Jump to Root Cause</button>
				<button class="btn btn-secondary" id="replay" type="button">Replay</button>
				<button class="btn btn-tertiary" id="previous" type="button">Previous</button>
				<button class="btn btn-tertiary" id="next" type="button">Next</button>
			</div>
			<div class="footer-row">
				<span>Theme</span>
				<button class="theme-toggle" id="theme-toggle" type="button">Auto</button>
			</div>
			<div class="footer-row">
				<span>Typography</span>
				<button class="theme-toggle" id="font-toggle" type="button">Mono</button>
			</div>
			<p class="hint">Shortcuts: ← / → navigate timeline, Space replay</p>
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
