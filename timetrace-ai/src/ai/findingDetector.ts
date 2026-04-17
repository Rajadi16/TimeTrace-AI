import type { FeatureSet, Finding, FindingKind, FindingSeverity } from './types';

// ---------------------------------------------------------------------------
// Deterministic finding id — stable across saves as long as kind + location
// don't change. Simple enough to not need a real hash.
// ---------------------------------------------------------------------------

function makeFindingId(kind: FindingKind, filePath: string, lineStart: number): string {
	return `${kind}:${filePath}:${lineStart}`;
}

// ---------------------------------------------------------------------------
// Per-kind configuration
// ---------------------------------------------------------------------------

interface KindConfig {
	severity: FindingSeverity;
	baseConfidence: number;
	message: (symbol?: string) => string;
	evidence: (symbol?: string) => string;
}

const KIND_CONFIG: Record<FindingKind, KindConfig> = {
	syntax_error: {
		severity: 'error',
		baseConfidence: 0.95,
		message: () => 'Syntax error detected',
		evidence: () => 'The TypeScript/JavaScript parser reported a parse diagnostic in the current code.',
	},
	undefined_identifier: {
		severity: 'error',
		baseConfidence: 0.80,
		message: (s) => s ? `Possibly undefined identifier: ${s}` : 'Possibly undefined identifier introduced',
		evidence: (s) => s
			? `The identifier "${s}" is referenced but not declared or imported in scope.`
			: 'A reference to an undeclared identifier was introduced.',
	},
	null_check_removed: {
		severity: 'warning',
		baseConfidence: 0.75,
		message: (s) => s ? `Null safety check removed near "${s}"` : 'Null safety check removed',
		evidence: (s) => s
			? `A guard expression protecting "${s}" from null/undefined was deleted.`
			: 'The number of null/undefined guard expressions decreased, increasing runtime crash risk.',
	},
	try_catch_removed: {
		severity: 'warning',
		baseConfidence: 0.75,
		message: (s) => s ? `try/catch removed around "${s}"` : 'try/catch error handler removed',
		evidence: (s) => s
			? `The try/catch block protecting "${s}" was removed, leaving exceptions unhandled.`
			: 'A try/catch block was deleted, leaving exceptions unhandled.',
	},
	heavy_loop_added: {
		severity: 'warning',
		baseConfidence: 0.60,
		message: () => 'Heavier loop or iteration added',
		evidence: () => 'A new loop or iterative higher-order call was introduced, which may affect performance.',
	},
	complexity_spike: {
		severity: 'warning',
		baseConfidence: 0.55,
		message: (s) => s ? `Complexity spike near "${s}"` : 'Cyclomatic complexity spike',
		evidence: (s) =>
			s
				? `Branching complexity around "${s}" increased significantly, making the code harder to reason about.`
				: 'Branching complexity increased by more than 3 units in a single save.',
	},
	todo_hack_comment: {
		severity: 'info',
		baseConfidence: 0.50,
		message: () => 'TODO, FIXME, or HACK comment added',
		evidence: () => 'A deferred-work marker was introduced, indicating an incomplete or risky section.',
	},
	export_signature_changed: {
		severity: 'warning',
		baseConfidence: 0.85,
		message: (s) => s ? `Exported signature changed: ${s}` : 'Exported signature changed',
		evidence: (s) => s
			? `The exported symbol "${s}" changed its type signature, which may break downstream consumers.`
			: 'One or more exported symbols changed their signatures.',
	},
	downstream_impact: {
		severity: 'warning',
		baseConfidence: 0.65,
		message: (s) => s ? `"${s}" may impact downstream files` : 'Downstream files may be affected',
		evidence: (s) => s
			? `Files that import "${s}" may be affected by the signature or behaviour change in this file.`
			: 'This file is imported by other files that may need re-verification.',
	},
};

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

export function detectFindings(input: {
	filePath: string;
	timestamp: string;
	changedLineRanges: number[][];
}, features: FeatureSet): Finding[] {
	// Cosmetic-only saves produce zero findings
	if (features.cosmetic) {
		return [];
	}

	const findings: Finding[] = [];
	const { filePath, timestamp, changedLineRanges } = input;
	const firstRange = changedLineRanges[0];
	const firstLine = firstRange ? firstRange[0] : 0;

	function emit(
		kind: FindingKind,
		lineRange?: [number, number],
		relatedSymbol?: string,
		confidenceBoost = 0,
	): void {
		const config = KIND_CONFIG[kind];
		const line = lineRange?.[0] ?? firstLine;
		findings.push({
			id: makeFindingId(kind, filePath, line),
			kind,
			severity: config.severity,
			message: config.message(relatedSymbol),
			evidence: config.evidence(relatedSymbol),
			confidence: Math.min(0.99, config.baseConfidence + confidenceBoost),
			lineRange,
			relatedSymbol,
			filePath,
			timestamp,
		});
	}

	// Pick best symbol from changedSymbols as relatedSymbol for relevant findings
	const primarySymbol = features.changedSymbols[0];

	if (features.syntaxFailure) {
		emit('syntax_error', features.featureLineRanges['syntax_error'] ?? (firstRange as [number, number] | undefined));
	}

	if (!features.syntaxFailure && features.undefinedIdentifierDetected) {
		emit('undefined_identifier', features.featureLineRanges['undefined_identifier'] ?? (firstRange as [number, number] | undefined), primarySymbol);
	}

	if (features.nullCheckRemoved) {
		emit(
			'null_check_removed',
			features.featureLineRanges['null_check_removed'],
			primarySymbol,
			// Boost confidence if we also see an undefined identifier — likely related
			features.undefinedIdentifierDetected ? 0.10 : 0,
		);
	}

	if (features.tryCatchRemoved) {
		emit('try_catch_removed', features.featureLineRanges['try_catch_removed'], primarySymbol);
	}

	if (features.heavyLoopAdded) {
		emit('heavy_loop_added', features.featureLineRanges['heavy_loop_added'], primarySymbol);
	}

	// Only emit complexity spike for meaningful jumps (> 3) to reduce noise
	if (features.complexityDelta > 3) {
		emit('complexity_spike', firstRange as [number, number] | undefined, primarySymbol);
	}

	if (features.todoHackCommentAdded) {
		emit('todo_hack_comment', features.featureLineRanges['todo_hack_comment'], primarySymbol);
	}

	// Export signature findings — one per changed export name
	for (const exportName of features.exportedNamesChanged) {
		findings.push({
			id: makeFindingId('export_signature_changed', filePath, 0),
			kind: 'export_signature_changed',
			severity: 'warning',
			message: KIND_CONFIG['export_signature_changed'].message(exportName),
			evidence: KIND_CONFIG['export_signature_changed'].evidence(exportName),
			confidence: 0.85,
			relatedSymbol: exportName,
			filePath,
			timestamp,
		});
	}

	return findings;
}
