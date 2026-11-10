export interface Point {
	x: number;
	y: number;
}

export interface Bar {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface BandScale {
	/** Full slot width (bar + gap). */
	step: number;
	/** Bar width inside the slot. */
	width: number;
	start(index: number): number;
	center(index: number): number;
}

/** Maps a value domain onto a pixel range; degenerate domains stay at range[0]. */
export function scaleLinear(
	domain: [number, number],
	range: [number, number],
): (value: number) => number {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0;
	if (!Number.isFinite(span) || span === 0) {
		return () => r0;
	}
	return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

function niceStep(rawStep: number): number {
	const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
	const normalized = rawStep / magnitude;
	return (
		(normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
		magnitude
	);
}

/** Rounded tick values that cover the domain, always including 0 for positives. */
export function niceTicks(min: number, max: number, count = 4): number[] {
	const low = Math.min(0, min);
	const high = Math.max(max, low === 0 ? 1 : low);
	const span = high - low || 1;
	const step = niceStep(span / Math.max(1, count));
	const ticks: number[] = [];
	for (
		let value = Math.ceil(low / step) * step;
		value <= high + step * 0.5;
		value += step
	) {
		ticks.push(Number(value.toFixed(10)));
	}
	return ticks;
}

/** Ticks inside an explicit domain (manual axes); unlike niceTicks it never forces 0. */
export function domainTicks(min: number, max: number, count = 4): number[] {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
	if (max <= min) return [min];
	const step = niceStep((max - min) / Math.max(1, count));
	if (!Number.isFinite(step) || step <= 0) return [min, max];
	const ticks: number[] = [];
	for (
		let value = Math.ceil(min / step) * step;
		value <= max + step * 0.5;
		value += step
	) {
		ticks.push(Number(value.toFixed(10)));
	}
	return ticks.length > 0 ? ticks : [min, max];
}

/** Evenly spaced category slots; `paddingRatio` reserves the gap between bars. */
export function bandScale(
	count: number,
	range: [number, number],
	paddingRatio = 0.2,
): BandScale {
	const [r0, r1] = range;
	const span = r1 - r0;
	const safeCount = Math.max(0, count);
	const step = safeCount > 0 ? span / safeCount : 0;
	const padding = Math.min(0.9, Math.max(0, paddingRatio));
	const width = Math.max(1, step * (1 - padding));
	return {
		step,
		width,
		start: (index) => r0 + step * index + (step - width) / 2,
		center: (index) => r0 + step * (index + 0.5),
	};
}

/** Vertical bars mapped through an explicit value domain. */
export function barLayoutInDomain(
	values: number[],
	width: number,
	height: number,
	gap: number,
	domain: [number, number],
): Bar[] {
	if (values.length === 0) return [];
	const slot = width / values.length;
	const barWidth = Math.max(1, slot - gap);
	const scale = scaleLinear(domain, [height, 0]);
	const zero = Math.max(0, Math.min(height, scale(0)));
	return values.map((value, index) => {
		const pixel = Math.max(0, Math.min(height, scale(value)));
		const top = Math.min(zero, pixel);
		const rawHeight = Math.abs(zero - pixel);
		return {
			x: index * slot + gap / 2,
			y: rawHeight < 1 ? Math.max(0, zero - 1) : top,
			w: barWidth,
			h: rawHeight < 1 ? 1 : rawHeight,
		};
	});
}

/** Points for a line chart mapped through an explicit value domain. */
export function linePointsInDomain(
	values: number[],
	width: number,
	height: number,
	domain: [number, number],
): Point[] {
	if (values.length === 0) return [];
	const scale = scaleLinear(domain, [height, 0]);
	const step = values.length === 1 ? 0 : width / (values.length - 1);
	return values.map((value, index) => ({
		x: values.length === 1 ? width / 2 : index * step,
		y: Math.max(0, Math.min(height, scale(value))),
	}));
}

/** Keeps the first and last item and thins the middle to at most `maxCount`. */
export function thinLabels<T>(items: T[], maxCount: number): T[] {
	if (items.length <= maxCount) return items.slice();
	if (maxCount <= 1) return items.length > 0 ? [items[0] as T] : [];
	if (maxCount === 2) {
		return [items[0] as T, items[items.length - 1] as T];
	}
	const indices = new Set<number>();
	const last = items.length - 1;
	for (let index = 0; index < maxCount; index += 1) {
		indices.add(Math.round((index * last) / (maxCount - 1)));
	}
	return [...indices]
		.sort((left, right) => left - right)
		.map((index) => items[index] as T);
}

function isWideCharacter(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return (
		code >= 0x1100 &&
		(code <= 0x115f ||
			(code >= 0x2e80 && code <= 0xa4cf) ||
			(code >= 0xac00 && code <= 0xd7a3) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xfe30 && code <= 0xfe4f) ||
			(code >= 0xff00 && code <= 0xff60) ||
			(code >= 0xffe0 && code <= 0xffe6))
	);
}

/** Rough text width: wide (CJK) glyphs 1em, everything else 0.6em. */
export function estimateTextWidth(text: string, fontSize: number): number {
	let units = 0;
	for (const char of text) {
		units += isWideCharacter(char) ? 1 : 0.6;
	}
	return units * fontSize;
}

/** Cuts text to fit `maxWidth`, appending an ellipsis when anything is removed. */
export function truncateText(
	text: string,
	maxWidth: number,
	fontSize: number,
): string {
	if (maxWidth <= 0) return "";
	if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
	const ellipsis = "…";
	const budget = Math.max(0, maxWidth - estimateTextWidth(ellipsis, fontSize));
	let result = "";
	for (const char of text) {
		if (estimateTextWidth(result + char, fontSize) > budget) break;
		result += char;
	}
	return result.length > 0 ? `${result}${ellipsis}` : ellipsis;
}

export function arcRatio(value: number, total: number): number {
	if (!Number.isFinite(total) || total <= 0) return 0;
	return Math.min(1, Math.max(0, value / total));
}
