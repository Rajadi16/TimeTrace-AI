import * as ts from 'typescript';
import type { FeatureSet, FindingKind } from './types';

const KNOWN_GLOBALS = new Set([
	'Array', 'Boolean', 'console', 'Date', 'Error', 'JSON', 'Math', 'Number', 'Object',
	'RegExp', 'String', 'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Symbol',
	'Intl', 'Reflect', 'undefined', 'NaN', 'Infinity', 'require', 'module', 'exports',
	'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'globalThis',
	'fetch', 'URL', 'URLSearchParams', 'Buffer', 'process', 'window', 'document',
	'__dirname', '__filename', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
]);

const GUARD_PATTERNS = [
	/if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\s*\)/g,
	/if\s*\(\s*([A-Za-z_$][\w$]*)\s*==\s*null\s*\)/g,
	/if\s*\(\s*([A-Za-z_$][\w$]*)\s*===\s*undefined\s*\)/g,
	/if\s*\(\s*([A-Za-z_$][\w$]*)\s*===\s*null\s*\)/g,
	/if\s*\(\s*([A-Za-z_$][\w$]*)\s*&&\s*([A-Za-z_$][\w$]*)?\s*\)/g,
];

const TRY_CATCH_PATTERN = /\btry\b[\s\S]*?\bcatch\b/g;
const LOOP_PATTERN = /\b(for|while|do)\b|\.forEach\s*\(|\.map\s*\(|\.filter\s*\(/g;
const TODO_PATTERN = /\b(TODO|FIXME|HACK)\b/gi;

function countMatches(code: string, pattern: RegExp): number {
	const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
	const globalPattern = new RegExp(pattern.source, flags);
	let count = 0;
	while (globalPattern.exec(code)) {
		count++;
	}
	return count;
}

function estimateComplexity(code: string): number {
	const branchMatches = code.match(/\b(if|else if|case|catch|switch|for|while|do)\b|\?|&&|\|\|/g);
	return branchMatches ? branchMatches.length : 0;
}

function getScriptKind(language: string): ts.ScriptKind {
	const n = language.toLowerCase();
	if (n.includes('tsx')) { return ts.ScriptKind.TSX; }
	if (n.includes('jsx')) { return ts.ScriptKind.JSX; }
	if (n.includes('javascript')) { return ts.ScriptKind.JS; }
	return ts.ScriptKind.TS;
}

function isJsOrTs(language: string): boolean {
	const n = language.toLowerCase();
	return n.includes('typescript') || n.includes('javascript') || n.includes('jsx') || n.includes('tsx');
}

function detectSyntaxFailure(language: string, code: string): boolean {
	if (isJsOrTs(language)) {
		const kind = getScriptKind(language);
		const sourceFile = ts.createSourceFile('analysis', code, ts.ScriptTarget.Latest, true, kind);
		return ((sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0;
	}

	let openBraces = 0;
	let openParens = 0;
	let openBrackets = 0;
	for (const ch of code) {
		if (ch === '{') { openBraces++; }
		if (ch === '}') { openBraces--; }
		if (ch === '(') { openParens++; }
		if (ch === ')') { openParens--; }
		if (ch === '[') { openBrackets++; }
		if (ch === ']') { openBrackets--; }
	}
	return openBraces < 0 || openParens < 0 || openBrackets < 0;
}

function collectDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
	const declared = new Set<string>();

	const addBinding = (name: ts.BindingName): void => {
		if (ts.isIdentifier(name)) {
			declared.add(name.text);
			return;
		}
		for (const el of name.elements) {
			if (!ts.isOmittedExpression(el)) {
				addBinding(el.name);
			}
		}
	};

	const visit = (node: ts.Node): void => {
		if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
			ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
			ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) {
			declared.add(node.name.text);
		}
		if (ts.isVariableDeclaration(node)) { addBinding(node.name); }
		if (ts.isParameter(node)) { addBinding(node.name); }
		if (ts.isCatchClause(node) && node.variableDeclaration) {
			declared.add(node.variableDeclaration.name.getText(sourceFile));
		}
		if (ts.isImportClause(node) && node.name) { declared.add(node.name.text); }
		if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) { declared.add(node.name.text); }
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return declared;
}

function detectUndefinedIdentifiers(language: string, code: string): boolean {
	if (!isJsOrTs(language)) { return false; }
	const kind = getScriptKind(language);
	const sourceFile = ts.createSourceFile('analysis', code, ts.ScriptTarget.Latest, true, kind);
	const declared = collectDeclaredNames(sourceFile);
	let found = false;

	const visit = (node: ts.Node): void => {
		if (found) { return; }
		if (ts.isIdentifier(node)) {
			const parent = node.parent;
			const isDecl =
				(ts.isVariableDeclaration(parent) && parent.name === node) ||
				(ts.isFunctionDeclaration(parent) && parent.name === node) ||
				(ts.isClassDeclaration(parent) && parent.name === node) ||
				(ts.isParameter(parent) && parent.name === node) ||
				(ts.isImportSpecifier(parent) && parent.name === node) ||
				(ts.isNamespaceImport(parent) && parent.name === node) ||
				(ts.isPropertyAssignment(parent) && parent.name === node) ||
				(ts.isPropertyDeclaration(parent) && parent.name === node) ||
				(ts.isPropertySignature(parent) && parent.name === node) ||
				(ts.isMethodDeclaration(parent) && parent.name === node) ||
				ts.isTypeReferenceNode(parent) ||
				(ts.isBindingElement(parent) && parent.name === node) ||
				(ts.isCatchClause(parent) && parent.variableDeclaration?.name === node) ||
				(ts.isPropertyAccessExpression(parent) && parent.name === node);

			if (!isDecl && !declared.has(node.text) && !KNOWN_GLOBALS.has(node.text) && node.text !== 'undefined') {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return found;
}

// ---------------------------------------------------------------------------
// Extract exported names and their signatures for diff
// ---------------------------------------------------------------------------

function extractExportSignatures(language: string, code: string): Map<string, string> {
	const sigs = new Map<string, string>();
	if (!isJsOrTs(language)) { return sigs; }

	const kind = getScriptKind(language);
	const sourceFile = ts.createSourceFile('analysis', code, ts.ScriptTarget.Latest, true, kind);

	const visit = (node: ts.Node): void => {
		if (!ts.canHaveModifiers(node)) {
			ts.forEachChild(node, visit);
			return;
		}
		const mods = ts.getModifiers(node);
		const isExported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
		if (!isExported) {
			ts.forEachChild(node, visit);
			return;
		}

		if (ts.isFunctionDeclaration(node) && node.name) {
			const params = node.parameters.map((p) => p.getText(sourceFile)).join(', ');
			const ret = node.type ? node.type.getText(sourceFile) : 'void';
			sigs.set(node.name.text, `(${params}): ${ret}`);
		} else if (ts.isVariableStatement(node)) {
			for (const decl of node.declarationList.declarations) {
				if (ts.isIdentifier(decl.name)) {
					const typeStr = decl.type ? decl.type.getText(sourceFile) : '';
					sigs.set(decl.name.text, typeStr || 'unknown');
				}
			}
		} else if (ts.isClassDeclaration(node) && node.name) {
			sigs.set(node.name.text, 'class');
		} else if (ts.isInterfaceDeclaration(node)) {
			sigs.set(node.name.text, node.getText(sourceFile).slice(0, 120));
		} else if (ts.isTypeAliasDeclaration(node)) {
			sigs.set(node.name.text, node.type.getText(sourceFile).slice(0, 120));
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return sigs;
}

// ---------------------------------------------------------------------------
// Extract symbol names from changed lines
// ---------------------------------------------------------------------------

function extractChangedSymbols(language: string, code: string, changedRanges: number[][]): string[] {
	if (!isJsOrTs(language) || !changedRanges.length) { return []; }
	const symbols = new Set<string>();
	const kind = getScriptKind(language);
	const sourceFile = ts.createSourceFile('analysis', code, ts.ScriptTarget.Latest, true, kind);
	const lines = code.split(/\r?\n/);

	// Build set of 0-based changed line indices
	const changedLineSet = new Set<number>();
	for (const [start, end] of changedRanges) {
		for (let l = start - 1; l <= end - 1; l++) {
			changedLineSet.add(l);
		}
	}

	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node)) {
			const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			if (changedLineSet.has(line)) {
				const parent = node.parent;
				// Only pick meaningful declaration names, not every identifier reference
				if (
					(ts.isFunctionDeclaration(parent) && parent.name === node) ||
					(ts.isClassDeclaration(parent) && parent.name === node) ||
					(ts.isVariableDeclaration(parent) && parent.name === node) ||
					(ts.isMethodDeclaration(parent) && parent.name === node)
				) {
					symbols.add(node.text);
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	// Fallback: also grab obvious identifiers from changed lines by regex
	for (const lineIdx of changedLineSet) {
		const line = lines[lineIdx] ?? '';
		for (const match of line.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*[(:=]/g)) {
			symbols.add(match[1]);
		}
	}

	try { visit(sourceFile); } catch { /* ignore AST errors on broken code */ }

	return [...symbols];
}

// ---------------------------------------------------------------------------
// Detect cosmetic-only changes (whitespace + comments only)
// ---------------------------------------------------------------------------

function stripWhitespaceAndComments(code: string): string {
	return code
		.replace(/\/\/[^\n]*/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function isCosmeticOnly(previousCode: string, currentCode: string): boolean {
	return stripWhitespaceAndComments(previousCode) === stripWhitespaceAndComments(currentCode);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function extractFeatures(input: {
	language: string;
	previousCode: string;
	currentCode: string;
	changedLineRanges?: number[][];
}): FeatureSet {
	const cosmetic = isCosmeticOnly(input.previousCode, input.currentCode);
	const previousOptionalChainCount = countMatches(input.previousCode, /\?\./g);
	const currentOptionalChainCount = countMatches(input.currentCode, /\?\./g);
	const previousNullishFallbackCount = countMatches(input.previousCode, /\?\?/g);
	const currentNullishFallbackCount = countMatches(input.currentCode, /\?\?/g);
	const nullSafetyGuardRemoved = previousOptionalChainCount > currentOptionalChainCount
		|| previousNullishFallbackCount > currentNullishFallbackCount;

	const previousMetrics = {
		complexity: estimateComplexity(input.previousCode),
		guardCount: GUARD_PATTERNS.reduce((t, p) => t + countMatches(input.previousCode, p), 0),
		tryCatchCount: countMatches(input.previousCode, TRY_CATCH_PATTERN),
		loopCount: countMatches(input.previousCode, LOOP_PATTERN),
		todoCommentCount: countMatches(input.previousCode, TODO_PATTERN),
	};

	const currentMetrics = {
		complexity: estimateComplexity(input.currentCode),
		guardCount: GUARD_PATTERNS.reduce((t, p) => t + countMatches(input.currentCode, p), 0),
		tryCatchCount: countMatches(input.currentCode, TRY_CATCH_PATTERN),
		loopCount: countMatches(input.currentCode, LOOP_PATTERN),
		todoCommentCount: countMatches(input.currentCode, TODO_PATTERN),
	};

	const changedLineRanges = input.changedLineRanges ?? [];
	const changedSymbols = cosmetic
		? []
		: extractChangedSymbols(input.language, input.currentCode, changedLineRanges);

	// Export signature diff
	const prevSigs = extractExportSignatures(input.language, input.previousCode);
	const currSigs = extractExportSignatures(input.language, input.currentCode);
	const exportedNamesChanged: string[] = [];
	const changedSet = new Set<string>();
	for (const [name, sig] of currSigs) {
		if (prevSigs.has(name) && prevSigs.get(name) !== sig) {
			changedSet.add(name);
		}
		if (!prevSigs.has(name)) {
			changedSet.add(name);
		}
	}

	for (const name of prevSigs.keys()) {
		if (!currSigs.has(name)) {
			changedSet.add(name);
		}
	}

	exportedNamesChanged.push(...changedSet);

	// Attribute feature flags to specific line ranges (best-effort)
	const featureLineRanges: Partial<Record<FindingKind, [number, number]>> = {};
	if (changedLineRanges.length > 0) {
		const first = changedLineRanges[0] as [number, number];
		if (!cosmetic) {
			if (previousMetrics.guardCount > currentMetrics.guardCount || nullSafetyGuardRemoved) {
				featureLineRanges['null_check_removed'] = first;
			}
			if (previousMetrics.tryCatchCount > currentMetrics.tryCatchCount) {
				featureLineRanges['try_catch_removed'] = first;
			}
			if (currentMetrics.loopCount > previousMetrics.loopCount) {
				featureLineRanges['heavy_loop_added'] = first;
			}
			if (currentMetrics.todoCommentCount > previousMetrics.todoCommentCount) {
				featureLineRanges['todo_hack_comment'] = first;
			}
		}
	}

	return {
		syntaxFailure: cosmetic ? false : detectSyntaxFailure(input.language, input.currentCode),
		undefinedIdentifierDetected: cosmetic ? false : detectUndefinedIdentifiers(input.language, input.currentCode),
		nullCheckRemoved: !cosmetic && (
			previousMetrics.guardCount > currentMetrics.guardCount
			|| nullSafetyGuardRemoved
		),
		tryCatchRemoved: !cosmetic && previousMetrics.tryCatchCount > currentMetrics.tryCatchCount,
		heavyLoopAdded: !cosmetic && currentMetrics.loopCount > previousMetrics.loopCount,
		complexityDelta: cosmetic ? 0 : Math.max(0, currentMetrics.complexity - previousMetrics.complexity),
		todoHackCommentAdded: !cosmetic && currentMetrics.todoCommentCount > previousMetrics.todoCommentCount,
		cosmetic,
		changedSymbols,
		exportedNamesChanged,
		featureLineRanges,
		currentMetrics,
		previousMetrics,
	};
}