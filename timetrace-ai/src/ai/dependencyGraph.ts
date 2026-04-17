import * as path from 'path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// WorkspaceGraph — lightweight import/export graph over open workspace files
// ---------------------------------------------------------------------------

export interface WorkspaceGraph {
	/** filePath → set of absolute file paths it imports from (1-hop, no node_modules) */
	imports: Record<string, string[]>;
	/** filePath → set of exported symbol names */
	exports: Record<string, string[]>;
	/** filePath → map of exportedName → signature string (for diff) */
	exportSignatures: Record<string, Record<string, string>>;
}

export function emptyGraph(): WorkspaceGraph {
	return { imports: {}, exports: {}, exportSignatures: {} };
}

// ---------------------------------------------------------------------------
// Parse imports from a TS/JS source file
// ---------------------------------------------------------------------------

function getScriptKind(filePath: string): ts.ScriptKind {
	const ext = filePath.toLowerCase().split('.').pop() ?? '';
	if (ext === 'tsx') { return ts.ScriptKind.TSX; }
	if (ext === 'jsx') { return ts.ScriptKind.JSX; }
	if (ext === 'js' || ext === 'cjs' || ext === 'mjs') { return ts.ScriptKind.JS; }
	return ts.ScriptKind.TS;
}

function resolveImportPath(importSpec: string, fromFile: string, workspaceRoot: string): string | undefined {
	// Skip node_modules
	if (!importSpec.startsWith('.') && !importSpec.startsWith('/')) {
		return undefined;
	}

	const fromDir = path.dirname(fromFile);
	const resolved = path.resolve(fromDir, importSpec);

	// Try common extensions
	const candidates = [
		resolved,
		`${resolved}.ts`,
		`${resolved}.tsx`,
		`${resolved}.js`,
		`${resolved}/index.ts`,
		`${resolved}/index.js`,
	];

	// Return the first candidate that is within the workspace root
	for (const candidate of candidates) {
		if (candidate.startsWith(workspaceRoot)) {
			return candidate;
		}
	}

	return undefined;
}

export function parseFileImports(filePath: string, code: string, workspaceRoot: string): string[] {
	const resolved: string[] = [];

	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
	} catch {
		return resolved;
	}

	const visit = (node: ts.Node): void => {
		// import ... from '...'
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const target = resolveImportPath(node.moduleSpecifier.text, filePath, workspaceRoot);
			if (target) { resolved.push(target); }
		}

		// export ... from '...'
		if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			const target = resolveImportPath(node.moduleSpecifier.text, filePath, workspaceRoot);
			if (target) { resolved.push(target); }
		}

		// require('...')
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'require' &&
			node.arguments.length === 1 &&
			ts.isStringLiteral(node.arguments[0])
		) {
			const target = resolveImportPath(node.arguments[0].text, filePath, workspaceRoot);
			if (target) { resolved.push(target); }
		}

		ts.forEachChild(node, visit);
	};

	try { visit(sourceFile); } catch { /* ignore */ }
	return [...new Set(resolved)];
}

// ---------------------------------------------------------------------------
// Parse exported symbol names + signatures
// ---------------------------------------------------------------------------

export function parseFileExports(filePath: string, code: string): { names: string[]; signatures: Record<string, string> } {
	const names: string[] = [];
	const signatures: Record<string, string> = {};

	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
	} catch {
		return { names, signatures };
	}

	const visit = (node: ts.Node): void => {
		if (!ts.canHaveModifiers(node)) {
			ts.forEachChild(node, visit);
			return;
		}
		const mods = ts.getModifiers(node);
		const isExported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

		if (isExported) {
			if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
				ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
				ts.isEnumDeclaration(node)) && node.name) {
				names.push(node.name.text);
				signatures[node.name.text] = node.getText(sourceFile).slice(0, 200);
			}
			if (ts.isVariableStatement(node)) {
				for (const decl of node.declarationList.declarations) {
					if (ts.isIdentifier(decl.name)) {
						names.push(decl.name.text);
						signatures[decl.name.text] = decl.type?.getText(sourceFile) ?? 'unknown';
					}
				}
			}
		}

		ts.forEachChild(node, visit);
	};

	try { visit(sourceFile); } catch { /* ignore */ }
	return { names, signatures };
}

// ---------------------------------------------------------------------------
// Update graph for a single saved file
// ---------------------------------------------------------------------------

export function updateGraphForFile(
	graph: WorkspaceGraph,
	filePath: string,
	code: string,
	workspaceRoot: string,
): WorkspaceGraph {
	const imports = parseFileImports(filePath, code, workspaceRoot);
	const { names, signatures } = parseFileExports(filePath, code);

	return {
		imports: { ...graph.imports, [filePath]: imports },
		exports: { ...graph.exports, [filePath]: names },
		exportSignatures: { ...graph.exportSignatures, [filePath]: signatures },
	};
}

// ---------------------------------------------------------------------------
// Impact computation
// ---------------------------------------------------------------------------

/**
 * Returns file paths that directly import `filePath` (1-hop reverse lookup).
 * These are "impacted" if an exported signature changed.
 */
export function computeDirectDownstream(graph: WorkspaceGraph, filePath: string): string[] {
	const downstream: string[] = [];
	for (const [importer, importedFiles] of Object.entries(graph.imports)) {
		if (importedFiles.includes(filePath)) {
			downstream.push(importer);
		}
	}
	return downstream;
}

/**
 * Returns all files reachable from `filePath` in the import graph (N-hop).
 * These are "related" — contextually tied but not necessarily directly broken.
 */
export function computeTransitiveRelated(graph: WorkspaceGraph, filePath: string, maxDepth = 3): string[] {
	const visited = new Set<string>();
	const queue: Array<{ file: string; depth: number }> = [{ file: filePath, depth: 0 }];

	while (queue.length > 0) {
		const item = queue.shift();
		if (!item || item.depth >= maxDepth) { continue; }
		for (const [importer, importedFiles] of Object.entries(graph.imports)) {
			if (importedFiles.includes(item.file) && !visited.has(importer)) {
				visited.add(importer);
				queue.push({ file: importer, depth: item.depth + 1 });
			}
		}
	}

	visited.delete(filePath);
	return [...visited];
}
