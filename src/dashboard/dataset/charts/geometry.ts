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

/** Nearest category index for a pointer position; O(1), no DOM or dots needed. */
export function nearestIndex(
	px: number,
	left: number,
	width: number,
	count: number,
): number {
	if (count <= 0) return -1;
	if (count === 1) return 0;
	if (!(width > 0)) return 0;
	const ratio = (px - left) / width;
	return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}

/**
 * Nearest band slot for a pointer x; O(1). Unlike `nearestIndex` this rounds by
 * slot, so the gap between two bars never selects the wrong bar.
 */
export function nearestBandIndex(
	px: number,
	left: number,
	width: number,
	count: number,
): number {
	if (count <= 0) return -1;
	if (count === 1) return 0;
	if (!(width > 0)) return 0;
	const slot = width / count;
	return Math.max(0, Math.min(count - 1, Math.floor((px - left) / slot)));
}

export function arcRatio(value: number, total: number): number {
	if (!Number.isFinite(total) || total <= 0) return 0;
	return Math.min(1, Math.max(0, value / total));
}

const FULL_TURN = Math.PI * 2;
const TAU_EPSILON = 1e-6;

/** Angle a starts at 12 o'clock and grows clockwise (SVG y points down). */
export function polarPoint(
	cx: number,
	cy: number,
	r: number,
	a: number,
): Point {
	return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/**
 * Pie/donut slice path from a0 to a1 (radians, clockwise from 12 o'clock).
 * An empty span yields ""; a near-full turn is split into two arcs so a single
 * 100% slice never degenerates into a line.
 */
export function arcPath(
	cx: number,
	cy: number,
	rOuter: number,
	rInner: number,
	a0: number,
	a1: number,
): string {
	const span = a1 - a0;
	if (!Number.isFinite(span) || span <= TAU_EPSILON) return "";
	const round = (value: number): number => Math.round(value * 1000) / 1000;
	const outer = Math.max(1, rOuter);
	const inner = Math.max(0, Math.min(rInner, outer));

	if (span >= FULL_TURN - TAU_EPSILON) {
		const top = polarPoint(cx, cy, outer, 0);
		const bottom = polarPoint(cx, cy, outer, Math.PI);
		const outerCircle = `M ${round(top.x)} ${round(top.y)} A ${round(outer)} ${round(outer)} 0 1 1 ${round(bottom.x)} ${round(bottom.y)} A ${round(outer)} ${round(outer)} 0 1 1 ${round(top.x)} ${round(top.y)} Z`;
		if (inner <= 0) return outerCircle;
		const topInner = polarPoint(cx, cy, inner, 0);
		const bottomInner = polarPoint(cx, cy, inner, Math.PI);
		// Reverse sweep on the inner ring punches the hole under nonzero fill.
		const innerCircle = `M ${round(topInner.x)} ${round(topInner.y)} A ${round(inner)} ${round(inner)} 0 1 0 ${round(bottomInner.x)} ${round(bottomInner.y)} A ${round(inner)} ${round(inner)} 0 1 0 ${round(topInner.x)} ${round(topInner.y)} Z`;
		return `${outerCircle} ${innerCircle}`;
	}

	const largeArc = span > Math.PI ? 1 : 0;
	const end = polarPoint(cx, cy, outer, a1);
	if (inner <= 0) {
		const start = polarPoint(cx, cy, outer, a0);
		return [
			`M ${round(cx)} ${round(cy)}`,
			`L ${round(start.x)} ${round(start.y)}`,
			`A ${round(outer)} ${round(outer)} 0 ${largeArc} 1 ${round(end.x)} ${round(end.y)}`,
			"Z",
		].join(" ");
	}
	const start = polarPoint(cx, cy, outer, a0);
	const innerEnd = polarPoint(cx, cy, inner, a1);
	const innerStart = polarPoint(cx, cy, inner, a0);
	return [
		`M ${round(start.x)} ${round(start.y)}`,
		`A ${round(outer)} ${round(outer)} 0 ${largeArc} 1 ${round(end.x)} ${round(end.y)}`,
		`L ${round(innerEnd.x)} ${round(innerEnd.y)}`,
		`A ${round(inner)} ${round(inner)} 0 ${largeArc} 0 ${round(innerStart.x)} ${round(innerStart.y)}`,
		"Z",
	].join(" ");
}
