import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const provider = new TimeTraceSidebarProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(TimeTraceSidebarProvider.viewType, provider),
		vscode.commands.registerCommand('timetrace-ai.openSidebar', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.timetraceAi');
			await vscode.commands.executeCommand('timetraceAi.sidebar.focus');
		})
	);
}

export function deactivate() {}

class TimeTraceSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'timetraceAi.sidebar';

	public constructor(private readonly extensionUri: vscode.Uri) {}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		const webview = webviewView.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};

		webview.html = this.getHtml(webview);

		webview.onDidReceiveMessage((message: { type?: string }) => {
			if (message.type === 'jumpToRootCause') {
				void vscode.window.showInformationMessage('Focused root-cause evidence for the selected failure state.');
			}
		});
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
			<div class="section-label">Incident Timeline</div>
			<div class="scenario-row">
				<label for="scenario-select">Scenario</label>
				<select id="scenario-select" aria-label="Select debugging scenario"></select>
			</div>

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
			<div class="card-title">Latency Trace</div>
			<div class="sparkline-wrap">
				<svg class="sparkline" id="sparkline" viewBox="0 0 180 54" preserveAspectRatio="none" aria-label="Latency sparkline">
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
			<div class="card-title">Root Cause</div>
			<p id="root-cause-text"></p>
		</section>

		<section class="card code-card reveal" id="code-card">
			<div class="card-title">Relevant Code Segment</div>
			<p class="card-subtitle">Only impacted lines are shown</p>
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
