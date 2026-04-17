export type AnalysisLanguage = 'typescript' | 'javascript' | 'python';

export type ChangedLineRange = [number, number];

export interface AnalysisRequest {
	filePath: string;
	language: AnalysisLanguage;
	timestamp: string;
	previousCode: string;
	currentCode: string;
	changedLineRanges: ChangedLineRange[];
	saveId: string;
}

const languageMap = new Map<string, AnalysisLanguage>([
	['typescript', 'typescript'],
	['typescriptreact', 'typescript'],
	['javascript', 'javascript'],
	['javascriptreact', 'javascript'],
	['python', 'python'],
]);

export function toAnalysisLanguage(languageId: string): AnalysisLanguage | undefined {
	return languageMap.get(languageId);
}
