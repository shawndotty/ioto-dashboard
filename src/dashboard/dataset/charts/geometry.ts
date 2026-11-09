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

/** Rounded tick values that cover the domain, always including 0 for positives. */
export function niceTicks(min: number, max: number, count = 4): number[] {
	const low = Math.min(0, min);
	const high = Math.max(max, low === 0 ? 1 : low);
	const span = high - low || 1;
	const rawStep = span / Math.max(1, count);
	const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
	const normalized = rawStep / magnitude;
	const step =
		(normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
		magnitude;
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

/** Vertical bars, one per value, evenly spaced; zero values keep a hairline. */
export function barLayout(
	values: number[],
	width: number,
	height: number,
	gap = 4,
	max = Math.max(1, ...values),
): Bar[] {
	if (values.length === 0) return [];
	const slot = width / values.length;
	const barWidth = Math.max(1, slot - gap);
	return values.map((value, index) => {
		const ratio = max <= 0 ? 0 : Math.max(0, value) / max;
		const h = value <= 0 ? 1 : Math.max(1, ratio * height);
		return {
			x: index * slot + gap / 2,
			y: height - h,
			w: barWidth,
			h,
		};
	});
}

/** Points for a line chart; `values` are laid out left-to-right. */
export function linePoints(
	values: number[],
	width: number,
	height: number,
	max = Math.max(1, ...values),
): Point[] {
	if (values.length === 0) return [];
	const step = values.length === 1 ? 0 : width / (values.length - 1);
	return values.map((value, index) => ({
		x: index * step,
		y: height - (max <= 0 ? 0 : Math.max(0, value) / max) * height,
	}));
}

export function arcRatio(value: number, total: number): number {
	if (!Number.isFinite(total) || total <= 0) return 0;
	return Math.min(1, Math.max(0, value / total));
}
