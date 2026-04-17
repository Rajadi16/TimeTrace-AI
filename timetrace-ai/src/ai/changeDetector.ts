export function computeChangedLineRanges(previousCode: string, currentCode: string): number[][] {
	const previousLines = previousCode.split(/\r?\n/);
	const currentLines = currentCode.split(/\r?\n/);

	if (previousCode === currentCode) {
		return [];
	}

	const previousLength = previousLines.length;
	const currentLength = currentLines.length;
	const dp: number[][] = Array.from({ length: previousLength + 1 }, () => new Array<number>(currentLength + 1).fill(0));

	for (let previousIndex = previousLength - 1; previousIndex >= 0; previousIndex--) {
		for (let currentIndex = currentLength - 1; currentIndex >= 0; currentIndex--) {
			if (previousLines[previousIndex] === currentLines[currentIndex]) {
				dp[previousIndex][currentIndex] = dp[previousIndex + 1][currentIndex + 1] + 1;
			} else {
				dp[previousIndex][currentIndex] = Math.max(dp[previousIndex + 1][currentIndex], dp[previousIndex][currentIndex + 1]);
			}
		}
	}

	const changedLines = new Set<number>();
	let previousIndex = 0;
	let currentIndex = 0;

	while (previousIndex < previousLength && currentIndex < currentLength) {
		if (previousLines[previousIndex] === currentLines[currentIndex]) {
			previousIndex++;
			currentIndex++;
			continue;
		}

		if (dp[previousIndex + 1][currentIndex] >= dp[previousIndex][currentIndex + 1]) {
			changedLines.add(Math.min(currentLength, currentIndex + 1) || 1);
			previousIndex++;
		} else {
			changedLines.add(currentIndex + 1);
			currentIndex++;
		}
	}

	while (previousIndex < previousLength) {
		changedLines.add(Math.min(currentLength, currentIndex + 1) || 1);
		previousIndex++;
	}

	while (currentIndex < currentLength) {
		changedLines.add(currentIndex + 1);
		currentIndex++;
	}

	if (!changedLines.size) {
		return [];
	}

	const sortedLines = Array.from(changedLines).sort((left, right) => left - right);
	const ranges: number[][] = [];
	let start = sortedLines[0];
	let end = sortedLines[0];

	for (let index = 1; index < sortedLines.length; index++) {
		const lineNumber = sortedLines[index];
		if (lineNumber === end + 1) {
			end = lineNumber;
			continue;
		}

		ranges.push([start, end]);
		start = lineNumber;
		end = lineNumber;
	}

	ranges.push([start, end]);
	return ranges;
}