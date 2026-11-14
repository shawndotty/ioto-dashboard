export type HeatmapLayout = "strip" | "calendar";

/** Enter a single row once cells reach this size. */
export const STRIP_ENTER_CELL = 14;
/** Leave a single row once cells fall below this size (10% hysteresis). */
export const STRIP_EXIT_CELL = 13;

export interface HeatmapFitInput {
	width: number;
	height: number; // <= 0: height is not a constraint
	columns: number;
	rows: number;
	gap: number;
	labelWidth: number; // weekday label column + gap; 0 without labels
	chromeHeight: number; // month labels + footer + host gap + scrollbar
	minCell: number;
	maxCell: number;
	stretch?: number; // 1 = square cells; 2 = up to 2:1
}

export interface HeatmapFit {
	/** Square edge before clamping; layout decisions use this raw value. */
	rawCell: number;
	cellW: number;
	cellH: number;
	leftover: number;
}

export interface HeatmapLayoutInput {
	range: number;
	width: number;
	height: number;
	calendarColumns: number;
	gap: number;
	minCell: number;
	maxCell: number;
	weekdayLabelWidth: number;
	calendarChromeHeight: number;
	stripChromeHeight: number;
	previous?: HeatmapLayout;
}

export interface HeatmapLayoutChoice {
	layout: HeatmapLayout;
	strip: HeatmapFit;
	calendar: HeatmapFit;
}

export function fitHeatmap(input: HeatmapFitInput): HeatmapFit {
	const { width, height, columns, rows, gap, labelWidth, chromeHeight } = input;
	if (columns <= 0 || rows <= 0) {
		return { rawCell: 0, cellW: 0, cellH: 0, leftover: Math.max(0, width) };
	}

	const cellByWidth = Math.floor(
		(width - labelWidth - (columns - 1) * gap) / columns,
	);
	const cellByHeight =
		height > 0
			? Math.floor((height - chromeHeight - (rows - 1) * gap) / rows)
			: Number.POSITIVE_INFINITY;
	const rawCell = Math.min(cellByWidth, cellByHeight);

	const cellH = Math.max(
		input.minCell,
		Math.min(input.maxCell, rawCell),
	);
	const ratio = Math.max(1, input.stretch ?? 1);
	const cellW = Math.max(
		cellH,
		Math.min(
			Math.floor(cellH * ratio),
			Math.floor(cellByWidth),
			input.maxCell,
		),
	);

	const used = labelWidth + columns * cellW + (columns - 1) * gap;
	return {
		rawCell,
		cellW,
		cellH,
		leftover: Math.max(0, width - used),
	};
}

export function chooseHeatmapLayout(
	input: HeatmapLayoutInput,
): HeatmapLayoutChoice {
	const common = {
		width: input.width,
		height: input.height,
		gap: input.gap,
		minCell: input.minCell,
		maxCell: input.maxCell,
		stretch: 1,
	};
	const strip = fitHeatmap({
		...common,
		columns: input.range,
		rows: 1,
		labelWidth: 0,
		chromeHeight: input.stripChromeHeight,
	});
	const calendar = fitHeatmap({
		...common,
		columns: input.calendarColumns,
		rows: 7,
		labelWidth: input.weekdayLabelWidth,
		chromeHeight: input.calendarChromeHeight,
	});
	const threshold =
		input.previous === "strip" ? STRIP_EXIT_CELL : STRIP_ENTER_CELL;
	return {
		layout: strip.rawCell >= threshold ? "strip" : "calendar",
		strip,
		calendar,
	};
}
