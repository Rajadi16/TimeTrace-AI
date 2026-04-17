import * as path from 'path';
import * as ts from 'typescript';
import type { WorkspaceDependencyGraph, WorkspaceFileSnapshot } from './types';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function normalizeFilePath(filePath: string): string {
	return path.normalize(filePath);
}

function parseImports(sourceFile: ts.SourceFile): string[] {
	const imports: string[] = [];

	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			imports.push(node.moduleSpecifier.text);
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return imports;
}

function parseExports(sourceFile: ts.SourceFile): string[] {
	const exports = new Set<string>();

	const addExport = (name: string): void => {
		if (name.trim()) {
			exports.add(name.trim());
		}
	};

	const visit = (node: ts.Node): void => {
		if (
			(ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) &&
			node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
			node.name
		) {
			addExport(node.name.text);
		}

		if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
			for (const declaration of node.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) {
					addExport(declaration.name.text);
				}
			}
		}

		if (ts.isExportAssignment(node)) {
			addExport('default');
		}

		if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
			for (const element of node.exportClause.elements) {
				addExport(element.name.text);
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return Array.from(exports).sort();
}

function resolveRelativeImport(fromFile: string, moduleSpecifier: string, availableFiles: Set<string>): string | undefined {
	if (!moduleSpecifier.startsWith('.')) {
		return undefined;
	}

	const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
	const candidates = [
		basePath,
		...SUPPORTED_EXTENSIONS.map((extension) => `${basePath}${extension}`),
		...SUPPORTED_EXTENSIONS.map((extension) => path.join(basePath, `index${extension}`)),
	];

	for (const candidate of candidates) {
		const normalized = normalizeFilePath(candidate);
		if (availableFiles.has(normalized)) {
			return normalized;
		}
	}

	return undefined;
}

export function buildWorkspaceDependencyGraph(files: WorkspaceFileSnapshot[], generatedAt: string): WorkspaceDependencyGraph {
	const tsLikeFiles = files.filter((file) => /typescript|javascript|tsx|jsx/i.test(file.language));
	const fileSet = new Set(tsLikeFiles.map((file) => normalizeFilePath(file.filePath)));
	const directDependents = new Map<string, Set<string>>();

	const graphFiles: WorkspaceDependencyGraph['files'] = {};

	for (const file of tsLikeFiles) {
		const normalizedFilePath = normalizeFilePath(file.filePath);
		const sourceFile = ts.createSourceFile(normalizedFilePath, file.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const importSpecifiers = parseImports(sourceFile);
		const resolvedImports = importSpecifiers
			.map((moduleSpecifier) => resolveRelativeImport(normalizedFilePath, moduleSpecifier, fileSet))
			.filter((resolved): resolved is string => typeof resolved === 'string');
		const exportedSymbols = parseExports(sourceFile);

		for (const importedFile of resolvedImports) {
			const current = directDependents.get(importedFile) ?? new Set<string>();
			current.add(normalizedFilePath);
			directDependents.set(importedFile, current);
		}

		graphFiles[normalizedFilePath] = {
			filePath: normalizedFilePath,
			imports: Array.from(new Set(resolvedImports)).sort(),
			exports: exportedSymbols,
			directDependents: [],
		};
	}

	for (const [filePath, node] of Object.entries(graphFiles)) {
		node.directDependents = Array.from(directDependents.get(filePath) ?? []).sort();
		graphFiles[filePath] = node;
	}

	return {
		generatedAt,
		files: graphFiles,
	};
}

function parseExportSignatures(code: string, filePath: string): Map<string, string> {
	const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const signatures = new Map<string, string>();

	const registerSignature = (name: string, node: ts.Node): void => {
		const signature = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
		signatures.set(name, signature);
	};

	const visit = (node: ts.Node): void => {
		if (
			(ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) &&
			node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
			node.name
		) {
			registerSignature(node.name.text, node);
		}

		if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
			for (const declaration of node.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) {
					registerSignature(declaration.name.text, declaration);
				}
			}
		}

		if (ts.isExportAssignment(node)) {
			registerSignature('default', node.expression);
		}

		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return signatures;
}

export interface ExportSignatureDelta {
	changed: boolean;
	changedSymbols: string[];
	addedSymbols: string[];
	removedSymbols: string[];
}

export function detectExportSignatureDelta(filePath: string, previousCode: string, currentCode: string): ExportSignatureDelta {
	const previous = parseExportSignatures(previousCode, filePath);
	const current = parseExportSignatures(currentCode, filePath);

	const changedSymbols: string[] = [];
	const addedSymbols: string[] = [];
	const removedSymbols: string[] = [];

	for (const [symbol, signature] of current.entries()) {
		if (!previous.has(symbol)) {
			addedSymbols.push(symbol);
			continue;
		}
		if (previous.get(symbol) !== signature) {
			changedSymbols.push(symbol);
		}
	}

	for (const symbol of previous.keys()) {
		if (!current.has(symbol)) {
			removedSymbols.push(symbol);
		}
	}

	const changed = changedSymbols.length > 0 || addedSymbols.length > 0 || removedSymbols.length > 0;
	return {
		changed,
		changedSymbols: changedSymbols.sort(),
		addedSymbols: addedSymbols.sort(),
		removedSymbols: removedSymbols.sort(),
	};
}
