import type { AnalyzeChangeOutput } from './types';

function joinReasons(reasons: string[]): string {
	if (!reasons.length) {
		return 'the risk score crossed the threshold';
	}

	if (reasons.length === 1) {
		return reasons[0];
	}

	if (reasons.length === 2) {
		return `${reasons[0]} and ${reasons[1]}`;
	}

	return `${reasons.slice(0, -1).join(', ')}, and ${reasons[reasons.length - 1]}`;
}

export function buildAnalysisSummary(result: Pick<AnalyzeChangeOutput, 'previousState' | 'state' | 'checkpoint' | 'reasons' | 'score'>): string {
	if (!result.checkpoint) {
		return `No checkpoint was created because the file changed but the overall risk state remained ${result.state}.`;
	}

	if (result.previousState === 'ERROR' && result.state === 'NORMAL') {
		return 'State changed from ERROR to NORMAL after the risky issue was fixed.';
	}

	if (result.previousState === 'WARNING' && result.state === 'NORMAL') {
		return 'State changed from WARNING to NORMAL after the risky edit was removed.';
	}

	if (result.previousState === 'ERROR' && result.state === 'WARNING') {
		return `State changed from ERROR to WARNING because ${joinReasons(result.reasons)}.`;
	}

	if (result.previousState === 'NORMAL' && result.state === 'WARNING') {
		return `State changed from NORMAL to WARNING because ${joinReasons(result.reasons)}.`;
	}

	if (result.previousState === 'NORMAL' && result.state === 'ERROR') {
		return `State changed from NORMAL to ERROR because ${joinReasons(result.reasons)}.`;
	}

	return `State changed from ${result.previousState} to ${result.state} because ${joinReasons(result.reasons)}.`;
}