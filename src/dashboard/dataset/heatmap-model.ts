import type { TimelineSourceRef } from "./timeline";
import type { DatasetRow, TimelineRange } from "./types";

export interface HeatmapModelOptions {
	range: TimelineRange;
	now?: () => number;
	/** 0 = Sunday. */
	firstDayOfWeek?: number;
	/** Reserved for a fixed colour scale shared across cards. */
	scaleMax?: number;
}

export interface HeatmapCell {
	/** Local YYYY-MM-DD. */
	key: string;
	inRange: boolean;
	isToday: boolean;
	count: number;
	level: 0 | 1 | 2 | 3 | 4;
	/** 0..6, relative to `firstDayOfWeek`. */
	row: number;
	/** Week index, includes leading/trailing days outside the range. */
	column: number;
	refs: TimelineSourceRef[];
	relatedTotal: number;
}

export interface HeatmapMonthMark {
	column: number;
	/** YYYY-MM; the view formats it with the active locale. */
	key: string;
}

export interface HeatmapBand {
	level: 0 | 1 | 2 | 3 | 4;
	/** Smallest count actually present in this band. */
	min: number;
	/** Largest count actually present in this band; level 4's max is the peak. */
	max: number;
}

export interface HeatmapModel {
	columns: number;
	cells: HeatmapCell[];
	months: HeatmapMonthMark[];
	activeDays: number;
	peak: number;
	thresholds: [number, number, number];
	/** Every in-range day whose count equals `peak`, in date order; empty when peak is 0. */
	peakKeys: string[];
	/** Smallest positive count; 0 when no day is active. */
	minActive: number;
	/** Every in-range day whose count equals `minActive`, in date order. */
	minActiveKeys: string[];
	/** Mean count across active days; 0 when no day is active. */
	averageActive: number;
	/** Bands actually present on the grid, ascending by level. */
	bands: HeatmapBand[];
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function dayKey(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function localMidnight(timestamp: number): Date {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date;
}

/** Calendar arithmetic never uses `new Date("YYYY-MM-DD")` (UTC parse). */
function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function countOf(row: DatasetRow | undefined): number {
	const raw = row?.cells.total?.sortValue;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	const parsed = Number(row?.cells.total?.text ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(sorted: number[], fraction: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor(fraction * sorted.length)),
	);
	return sorted[index] ?? 0;
}

function levelOf(count: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
	if (count <= 0) return 0;
	if (count <= thresholds[0]) return 1;
	if (count <= thresholds[1]) return 2;
	if (count <= thresholds[2]) return 3;
	return 4;
}

export function buildHeatmapModel(
	rows: DatasetRow[],
	options: HeatmapModelOptions,
): HeatmapModel {
	const range = options.range;
	const today = localMidnight(options.now?.() ?? Date.now());
	const start = addDays(today, -(range - 1));
	const firstDayOfWeek = options.firstDayOfWeek ?? 0;
	const todayKey = dayKey(today);

	const leading = (start.getDay() - firstDayOfWeek + 7) % 7;
	const gridStart = addDays(start, -leading);
	const trailing = (firstDayOfWeek + 6 - today.getDay() + 7) % 7;
	const gridEnd = addDays(today, trailing);

	const byKey = new Map(rows.map((row) => [row.id, row]));
	const cells: HeatmapCell[] = [];
	const months: HeatmapMonthMark[] = [];
	let previousMonth = "";
	let column = 0;

	for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 7)) {
		let monthSource: Date | null = null;
		for (let row = 0; row < 7; row += 1) {
			const date = addDays(cursor, row);
			const day = dayKey(date);
			const inRange = date >= start && date <= today;
			if (inRange && monthSource === null) monthSource = date;
			const source = inRange ? byKey.get(day) : undefined;
			const refs = source?.related ?? [];
			cells.push({
				key: day,
				inRange,
				isToday: day === todayKey,
				count: inRange ? countOf(source) : 0,
				level: 0,
				row,
				column,
				refs,
				relatedTotal: source?.relatedTotal ?? refs.length,
			});
		}
		if (monthSource) {
			const key = monthKey(monthSource);
			if (key !== previousMonth) {
				months.push({ column, key });
				previousMonth = key;
			}
		}
		column += 1;
	}

	const positive = cells
		.filter((cell) => cell.inRange && cell.count > 0)
		.map((cell) => cell.count)
		.sort((a, b) => a - b);
	const thresholds: [number, number, number] = [
		percentile(positive, 0.25),
		percentile(positive, 0.5),
		percentile(positive, 0.75),
	];
	const soleActive = positive.length === 1;
	const peakValue = positive[positive.length - 1] ?? 0;

	// p75 can land on the peak, which makes level 4 unreachable. Step it down
	// to the second-largest value so the top band still exists.
	if (!soleActive && positive.length >= 2 && thresholds[2] >= peakValue) {
		thresholds[2] = positive[positive.length - 2] ?? thresholds[2];
	}

	let activeDays = 0;
	let peak = 0;
	let sum = 0;
	for (const cell of cells) {
		if (!cell.inRange) continue;
		cell.level = soleActive && cell.count > 0 ? 4 : levelOf(cell.count, thresholds);
		if (cell.count > 0) {
			activeDays += 1;
			sum += cell.count;
		}
		if (cell.count > peak) peak = cell.count;
	}

	const bandBounds = new Map<0 | 1 | 2 | 3 | 4, HeatmapBand>();
	const peakKeys: string[] = [];
	const minActiveKeys: string[] = [];
	for (const cell of cells) {
		if (!cell.inRange) continue;
		const band = bandBounds.get(cell.level);
		if (!band) {
			bandBounds.set(cell.level, {
				level: cell.level,
				min: cell.count,
				max: cell.count,
			});
		} else {
			band.min = Math.min(band.min, cell.count);
			band.max = Math.max(band.max, cell.count);
		}
		if (peak > 0 && cell.count === peak) peakKeys.push(cell.key);
	}

	const minActive = positive[0] ?? 0;
	if (minActive > 0) {
		for (const cell of cells) {
			if (cell.inRange && cell.count === minActive) minActiveKeys.push(cell.key);
		}
	}

	const bands = [...bandBounds.values()].sort((a, b) => a.level - b.level);

	return {
		columns: column,
		cells,
		months,
		activeDays,
		peak,
		thresholds,
		peakKeys,
		minActive,
		minActiveKeys,
		averageActive: positive.length > 0 ? sum / positive.length : 0,
		bands,
	};
}
