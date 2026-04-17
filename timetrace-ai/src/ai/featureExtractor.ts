import * as ts from 'typescript';
import type { FeatureSet } from './types';

const KNOWN_GLOBALS = new Set([
	'Array', 'Boolean', 'console', 'Date', 'Error', 'JSON', 'Math', 'Number', 'Object',
	'RegExp', 'String', 'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Symbol',
	'Intl', 'Reflect', 'undefined', 'NaN', 'Infinity', 'require', 'module', 'exports',
	'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'globalThis',
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

function detectSyntaxFailure(language: string, code: string): boolean {
	const normalizedLanguage = language.toLowerCase();
	if (normalizedLanguage.includes('typescript') || normalizedLanguage.includes('javascript') || normalizedLanguage.includes('jsx') || normalizedLanguage.includes('tsx')) {
		const kind = normalizedLanguage.includes('tsx') ? ts.ScriptKind.TSX : normalizedLanguage.includes('jsx') ? ts.ScriptKind.JSX : normalizedLanguage.includes('javascript') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile('analysis', code, ts.ScriptTarget.Latest, true, kind);
		return ((sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0;
	}

	let openBraces = 0;
	let openParens = 0;
	let openBrackets = 0;
	for (const character of code) {
		if (character === '{') {
			openBraces++;
		}
		if (character === '}') {
			openBraces--;
		}
		if (character === '(') {
			openParens++;
		}
		if (character === ')') {
			openParens--;
		}
		if (character === '[') {
			openBrackets++;
		}
		if (character === ']') {
			openBrackets--;
		}
	}
	return openBraces < 0 || openParens < 0 || openBrackets < 0;
}

function collectDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
	const declaredNames = new Set<string>();

	const addBindingName = (name: ts.BindingName): void => {
		if (ts.isIdentifier(name)) {
			declaredNames.add(name.text);
			return;
		}
		for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) {
				continue;
			}
			addBindingName(element.name);
		}
	};

	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
			if (node.name) {
				declaredNames.add(node.name.text);
			}
		}

		if (ts.isVariableDeclaration(node)) {
			addBindingName(node.name);
		}

		if (ts.isParameter(node)) {
			addBindingName(node.name);
		}

		if (ts.isCatchClause(node) && node.variableDeclaration) {
			declaredNames.add(node.variableDeclaration.name.getText(sourceFile));
		}

		if (ts.isImportClause(node)) {
			if (node.name) {
				declaredNames.add(node.name.text);
			}
		}

		if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
			declaredNames.add(node.name.text);
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return declaredNames;
}

function detectUndefinedIdentifiers(language: string, code: string): boolean {
	const normalizedLanguage = language.toLowerCase();
	if (!normalizedLanguage.includes('typescript') && !normalizedLanguage.includes('javascript') && !normalizedLanguage.includes('jsx') && !normalizedLanguage.includes('tsx')) {
		return false;
	}

	const kind = normalizedLanguage.includes('tsx') ? ts.ScriptKind.TSX : normalizedLanguage.includes('jsx') ? ts.ScriptKind.JSX : normalizedLanguage.includes('javascript') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile('analysis', code, ts.ScriptTarget.Latest, true, kind);
	const declaredNames = collectDeclaredNames(sourceFile);
	let undefinedIdentifierDetected = false;

	const visit = (node: ts.Node): void => {
		if (undefinedIdentifierDetected) {
			return;
		}

		if (ts.isIdentifier(node)) {
			const parent = node.parent;
			const isDeclarationName =
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
				(ts.isTypeReferenceNode(parent)) ||
				(ts.isBindingElement(parent) && parent.name === node) ||
				(ts.isCatchClause(parent) && parent.variableDeclaration?.name === node) ||
				(ts.isPropertyAccessExpression(parent) && parent.name === node);

			if (!isDeclarationName && !declaredNames.has(node.text) && !KNOWN_GLOBALS.has(node.text) && node.text !== 'undefined') {
				undefinedIdentifierDetected = true;
				return;
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return undefinedIdentifierDetected;
}

export function extractFeatures(input: {
	language: string;
	previousCode: string;
	currentCode: string;
}): FeatureSet {
	const previousMetrics = {
		complexity: estimateComplexity(input.previousCode),
		guardCount: GUARD_PATTERNS.reduce((total, pattern) => total + countMatches(input.previousCode, pattern), 0),
		tryCatchCount: countMatches(input.previousCode, TRY_CATCH_PATTERN),
		loopCount: countMatches(input.previousCode, LOOP_PATTERN),
		todoCommentCount: countMatches(input.previousCode, TODO_PATTERN),
	};

	const currentMetrics = {
		complexity: estimateComplexity(input.currentCode),
		guardCount: GUARD_PATTERNS.reduce((total, pattern) => total + countMatches(input.currentCode, pattern), 0),
		tryCatchCount: countMatches(input.currentCode, TRY_CATCH_PATTERN),
		loopCount: countMatches(input.currentCode, LOOP_PATTERN),
		todoCommentCount: countMatches(input.currentCode, TODO_PATTERN),
	};

	return {
		syntaxFailure: detectSyntaxFailure(input.language, input.currentCode),
		undefinedIdentifierDetected: detectUndefinedIdentifiers(input.language, input.currentCode),
		nullCheckRemoved: previousMetrics.guardCount > currentMetrics.guardCount,
		tryCatchRemoved: previousMetrics.tryCatchCount > currentMetrics.tryCatchCount,
		heavyLoopAdded: currentMetrics.loopCount > previousMetrics.loopCount,
		complexityDelta: Math.max(0, currentMetrics.complexity - previousMetrics.complexity),
		todoHackCommentAdded: currentMetrics.todoCommentCount > previousMetrics.todoCommentCount,
		currentMetrics,
		previousMetrics,
	};
}