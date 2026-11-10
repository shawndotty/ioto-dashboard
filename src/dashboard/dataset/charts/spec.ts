import {
	bandScale,
	domainTicks,
	estimateTextWidth,
	linePointsInDomain,
	niceTicks,
	scaleLinear,
	thinLabels,
	truncateText,
} from "./geometry";
import {
	formatPercent,
	formatSize,
	type DataObject,
	type Dataset,
	type DatasetCellType,
	type DatasetColumn,
} from "../types";

export interface ChartSize {
	w: number;
	h: number;
}

export type ChartOptions = Record<
	string,
	string | number | boolean | undefined
>;

export interface ChartTick {
	value: number;
	/** Display text (already formatted/truncated). */
	label: string;
	/** Full text for the tooltip. */
	fullLabel?: string;
	position: number;
}

export interface ChartAxisSpec {
	type: "date" | "category" | "number";
	title?: string;
	showLabels: boolean;
	ticks: ChartTick[];
}

export interface ChartPoint {
	x: number;
	y: number;
	label: string;
	value: number;
}

export interface ChartBar {
	x: number;
	y: number;
	w: number;
	h: number;
	label: string;
	value: number;
}

export interface ChartSeries {
	key: string;
	/** i18n key for the legend. */
	label: string;
	colorIndex: 1 | 2 | 3;
	points: ChartPoint[];
	bars?: ChartBar[];
}

export interface ChartSpec {
	kind: "line" | "bar";
	width: number;
	height: number;
	ariaKey: "CHART_ARIA_LINE" | "CHART_ARIA_BAR";
	x: ChartAxisSpec;
	y: ChartAxisSpec & {
		min: number;
		max: number;
		grid: boolean;
		format: (value: number) => string;
	};
	series: ChartSeries[];
	plot: { left: number; top: number; width: number; height: number };
	hiddenCount: number;
	showLegend: boolean;
	showValueLabels: boolean;
	valueList: Array<{ label: string; text: string }> | null;
	xRotate: 0 | 45 | 90;
}

const LABEL_FONT = 10;
const PAD_TOP = 6;
const PAD_RIGHT = 6;

const DEFAULT_FIELDS: Record<DataObject, { x: string; y: string }> = {
	task: { x: "date", y: "total" },
	note: { x: "note", y: "tasks" },
	file: { x: "name", y: "size" },
	folder: { x: "name", y: "files" },
	project: { x: "name", y: "completed" },
};

interface AxisLayout {
	plot: { left: number; top: number; width: number; height: number };
	xShow: boolean;
	yShow: boolean;
	yGrid: boolean;
	xTitle: string;
	yTitle: string;
}

interface YAxisResult {
	min: number;
	max: number;
	ticks: number[];
	labels: string[];
	format: (value: number) => string;
}

interface BarDatum {
	label: string;
	value: number;
}

function optionString(
	options: ChartOptions,
	key: string,
	fallback: string,
): string {
	const value = options[key];
	return typeof value === "string" ? value : fallback;
}

function optionBoolean(
	options: ChartOptions,
	key: string,
	fallback: boolean,
): boolean {
	const value = options[key];
	return typeof value === "boolean" ? value : fallback;
}

function optionNumber(options: ChartOptions, key: string): number | undefined {
	const value = options[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function columnMatches(column: DatasetColumn, role: "x" | "y"): boolean {
	if (role === "y") {
		return (
			column.type === "number" ||
			column.type === "percent" ||
			column.type === "size"
		);
	}
	return (
		column.type === "text" ||
		column.type === "date" ||
		column.type === "path"
	);
}

function resolveColumn(
	dataset: Dataset,
	requested: string,
	role: "x" | "y",
	defaultKey: string,
): DatasetColumn | undefined {
	const direct = dataset.columns.find((column) => column.key === requested);
	if (direct && columnMatches(direct, role)) return direct;
	const preferred = dataset.columns.find((column) => column.key === defaultKey);
	if (preferred && columnMatches(preferred, role)) return preferred;
	return dataset.columns.find((column) => columnMatches(column, role));
}

function cellValue(
	row: Dataset["rows"][number],
	key: string,
): number {
	const raw = row.cells[key]?.sortValue;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string" && raw.trim() !== "") {
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function cellText(row: Dataset["rows"][number], key: string): string {
	return row.cells[key]?.text ?? "";
}

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) return "—";
	const rounded = Math.round(value * 100) / 100;
	const [intPart = "", fracPart] = String(rounded).split(".");
	const negative = intPart.startsWith("-");
	const digits = negative ? intPart.slice(1) : intPart;
	const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return `${negative ? "-" : ""}${grouped}${
		fracPart ? `.${fracPart}` : ""
	}`;
}

function formatCompact(value: number): string {
	if (!Number.isFinite(value)) return "—";
	const absolute = Math.abs(value);
	const trim = (scaled: number): string =>
		scaled
			.toFixed(scaled >= 10 ? 0 : 1)
			.replace(/\.0$/, "");
	if (absolute >= 1e9) return `${trim(value / 1e9)}B`;
	if (absolute >= 1e6) return `${trim(value / 1e6)}M`;
	if (absolute >= 1e3) return `${trim(value / 1e3)}k`;
	return formatNumber(value);
}

function formatterFor(
	type: DatasetCellType,
	mode: string,
): (value: number) => string {
	if (mode === "compact") return formatCompact;
	if (mode === "number") return formatNumber;
	if (type === "percent") return (value) => formatPercent(value);
	if (type === "size") return formatSize;
	return formatNumber;
}

function dateLabel(text: string, format: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return text;
	const year = match[1] ?? "";
	const month = match[2] ?? "";
	const day = match[3] ?? "";
	if (format === "iso") return `${year}-${month}-${day}`;
	if (format === "short") return `${Number(month)}/${Number(day)}`;
	return `${month}-${day}`;
}

function rotateOf(options: ChartOptions): 0 | 45 | 90 {
	const value = optionString(options, "xRotate", "0");
	return value === "45" ? 45 : value === "90" ? 90 : 0;
}

function buildYAxis(
	options: ChartOptions,
	values: number[],
	type: DatasetCellType,
	tickCount: number,
): YAxisResult {
	const format = formatterFor(type, optionString(options, "yFormat", "auto"));
	let dataMin = 0;
	let dataMax = 0;
	for (const value of values) {
		if (value < dataMin) dataMin = value;
		if (value > dataMax) dataMax = value;
	}

	const manualMin = optionNumber(options, "yMin");
	const manualMax = optionNumber(options, "yMax");
	const manual =
		optionString(options, "yScale", "auto") === "manual" &&
		manualMin !== undefined &&
		manualMax !== undefined &&
		manualMin < manualMax;

	let min: number;
	let max: number;
	let ticks: number[];
	if (manual) {
		min = manualMin;
		max = manualMax;
		ticks = domainTicks(min, max, tickCount);
	} else {
		ticks = niceTicks(dataMin, dataMax, tickCount);
		min = ticks[0] ?? 0;
		max = ticks[ticks.length - 1] ?? 1;
	}
	if (!(max > min)) {
		min = 0;
		max = 1;
		ticks = [0, 0.5, 1];
	}
	if (ticks.length === 0) ticks = [min, max];
	return { min, max, ticks, labels: ticks.map(format), format };
}

function computeLayout(
	size: ChartSize,
	options: ChartOptions,
	rotate: 0 | 45 | 90,
	yLabels: string[],
	xShowRequested: boolean,
	xTitleRaw: string,
	yTitleRaw: string,
): AxisLayout | null {
	const narrow = size.w < 320;
	const short = size.h < 180;
	let yShow = optionBoolean(options, "yShowLabels", true) && !narrow;
	let yGrid = optionBoolean(options, "yShowGrid", false) && !short;
	let xTitle = narrow ? "" : xTitleRaw.trim();
	let yTitle = narrow ? "" : yTitleRaw.trim();
	const xShow = xShowRequested;

	let maxLabelWidth = 0;
	for (const label of yLabels) {
		maxLabelWidth = Math.max(
			maxLabelWidth,
			estimateTextWidth(label, LABEL_FONT),
		);
	}
	// A gutter wider than 28% of the card would squeeze the plot: drop the
	// tick text instead of shrinking the data area further.
	if (yShow && maxLabelWidth + 8 > size.w * 0.28) yShow = false;

	let bottom = 8;
	if (xShow) bottom += rotate === 0 ? 12 : rotate === 45 ? 24 : 36;
	if (xTitle) bottom += 14;
	let left = yShow
		? Math.min(Math.ceil(maxLabelWidth) + 8, Math.round(size.w * 0.28))
		: 8;
	if (yTitle) left += 14;

	let plotWidth = size.w - left - PAD_RIGHT;
	let plotHeight = size.h - PAD_TOP - bottom;
	if (plotWidth < 40 || plotHeight < 30) {
		yShow = false;
		yGrid = false;
		xTitle = "";
		yTitle = "";
		left = 8;
		bottom = xShow ? 16 : 4;
		plotWidth = size.w - left - PAD_RIGHT;
		plotHeight = size.h - PAD_TOP - bottom;
	}
	if (plotWidth <= 0 || plotHeight <= 0) return null;

	return {
		plot: {
			left,
			top: PAD_TOP,
			width: plotWidth,
			height: plotHeight,
		},
		xShow,
		yShow,
		yGrid,
		xTitle,
		yTitle,
	};
}

function clampPosition(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function sortEntries(entries: BarDatum[], mode: string): BarDatum[] {
	const copy = entries.slice();
	if (mode === "value-desc") return copy.sort((a, b) => b.value - a.value);
	if (mode === "value-asc") return copy.sort((a, b) => a.value - b.value);
	if (mode === "label") return copy.sort((a, b) => a.label.localeCompare(b.label));
	return copy;
}

export function buildLineSpec(
	dataset: Dataset,
	options: ChartOptions,
	size: ChartSize,
	object: DataObject,
): ChartSpec | null {
	if (dataset.rows.length === 0) return null;
	const rows = dataset.rows;
	const defaults = DEFAULT_FIELDS[object] ?? DEFAULT_FIELDS.task;
	const xColumn = resolveColumn(dataset, defaults.x, "x", defaults.x);
	if (!xColumn) return null;

	const requestedKeys = [optionString(options, "yField", defaults.y)];
	if (optionBoolean(options, "ySeriesCompleted", false)) {
		requestedKeys.push("completed");
	}
	if (optionBoolean(options, "ySeriesOpen", false)) {
		requestedKeys.push("open");
	}

	const used = new Set<string>();
	const seriesData: Array<{
		key: string;
		label: string;
		type: DatasetCellType;
		values: number[];
	}> = [];
	for (const requestedKey of requestedKeys) {
		const column = resolveColumn(dataset, requestedKey, "y", defaults.y);
		const key = column?.key ?? requestedKey;
		if (used.has(key)) continue;
		used.add(key);
		seriesData.push({
			key,
			label: column?.labelKey ?? key,
			type: column?.type ?? "number",
			values: rows.map((row) => cellValue(row, key)),
		});
	}
	if (seriesData.length === 0) return null;

	const fullLabels = rows.map(
		(row, index) => cellText(row, xColumn.key) || String(index + 1),
	);
	const labelFormat = optionString(options, "xLabelFormat", "md");
	const displayLabels = fullLabels.map((label) =>
		dateLabel(label, labelFormat),
	);
	const allValues = seriesData.flatMap((series) => series.values);
	const provisionalTicks = Math.max(
		2,
		Math.min(6, Math.floor((size.h - 40) / 40)),
	);
	const yAxis = buildYAxis(
		options,
		allValues,
		seriesData[0]?.type ?? "number",
		provisionalTicks,
	);
	const rotate = rotateOf(options);
	const layout = computeLayout(
		size,
		options,
		rotate,
		yAxis.labels,
		optionBoolean(options, "xShowLabels", true),
		optionString(options, "xTitle", ""),
		optionString(options, "yTitle", ""),
	);
	if (!layout) return null;
	const plot = layout.plot;
	const yScale = scaleLinear(
		[yAxis.min, yAxis.max],
		[plot.top + plot.height, plot.top],
	);
	const yTicks: ChartTick[] = yAxis.ticks.map((value) => {
		const label = yAxis.format(value);
		return {
			value,
			label,
			fullLabel: label,
			position: clampPosition(
				yScale(value),
				plot.top,
				plot.top + plot.height,
			),
		};
	});

	const xPosition = (index: number): number =>
		rows.length === 1
			? plot.left + plot.width / 2
			: plot.left + (plot.width * index) / (rows.length - 1);

	let xTicks: ChartTick[] = [];
	if (layout.xShow) {
		let kept: number[];
		if (plot.width < 40) {
			kept = rows.length === 1 ? [0] : [0, rows.length - 1];
		} else {
			let totalWidth = 0;
			for (const label of displayLabels) {
				totalWidth += estimateTextWidth(label, LABEL_FONT);
			}
			const average = totalWidth / Math.max(1, displayLabels.length);
			const maxLabels = Math.max(
				1,
				Math.floor(plot.width / (average + 12)),
			);
			kept = thinLabels(
				rows.map((_, index) => index),
				maxLabels,
			);
		}
		xTicks = kept.map((index) => ({
			value: index,
			label: displayLabels[index] ?? "",
			fullLabel: fullLabels[index] ?? "",
			position: xPosition(index),
		}));
	}

	const series: ChartSeries[] = seriesData.map((data, index) => ({
		key: data.key,
		label: data.label,
		colorIndex: Math.min(3, index + 1) as 1 | 2 | 3,
		points: linePointsInDomain(
			data.values,
			plot.width,
			plot.height,
			[yAxis.min, yAxis.max],
		).map((point, pointIndex) => ({
			x: plot.left + point.x,
			y: plot.top + point.y,
			label: fullLabels[pointIndex] ?? "",
			value: data.values[pointIndex] ?? 0,
		})),
	}));

	return {
		kind: "line",
		width: size.w,
		height: size.h,
		ariaKey: "CHART_ARIA_LINE",
		x: {
			type: "date",
			title: layout.xTitle || undefined,
			showLabels: layout.xShow,
			ticks: xTicks,
		},
		y: {
			type: "number",
			title: layout.yTitle || undefined,
			showLabels: layout.yShow,
			ticks: yTicks,
			min: yAxis.min,
			max: yAxis.max,
			grid: layout.yGrid,
			format: yAxis.format,
		},
		series,
		plot,
		hiddenCount: 0,
		showLegend:
			optionBoolean(options, "showLegend", true) && series.length > 1,
		showValueLabels: false,
		valueList: null,
		xRotate: rotate,
	};
}

export function buildBarSpec(
	dataset: Dataset,
	options: ChartOptions,
	size: ChartSize,
	object: DataObject,
): ChartSpec | null {
	if (dataset.rows.length === 0) return null;
	const rows = dataset.rows;
	const defaults = DEFAULT_FIELDS[object] ?? DEFAULT_FIELDS.project;
	const xColumn = resolveColumn(
		dataset,
		optionString(options, "xField", defaults.x),
		"x",
		defaults.x,
	);
	const yColumn = resolveColumn(
		dataset,
		optionString(options, "yField", defaults.y),
		"y",
		defaults.y,
	);
	if (!xColumn || !yColumn) return null;

	const entries: BarDatum[] = rows.map((row, index) => ({
		label: cellText(row, xColumn.key) || String(index + 1),
		value: cellValue(row, yColumn.key),
	}));
	const sorted = sortEntries(entries, optionString(options, "xSort", "dataset"));
	const topN = Math.max(0, Math.round(optionNumber(options, "topN") ?? 0));
	const shown =
		topN > 0 && sorted.length > topN ? sorted.slice(0, topN) : sorted;
	const hiddenCount = sorted.length - shown.length;

	const provisionalTicks = Math.max(
		2,
		Math.min(6, Math.floor((size.h - 40) / 40)),
	);
	const yAxis = buildYAxis(
		options,
		shown.map((entry) => entry.value),
		yColumn.type,
		provisionalTicks,
	);
	const rotate = rotateOf(options);
	const layout = computeLayout(
		size,
		options,
		rotate,
		yAxis.labels,
		optionBoolean(options, "xShowLabels", true),
		optionString(options, "xTitle", ""),
		optionString(options, "yTitle", ""),
	);
	if (!layout) return null;
	const plot = layout.plot;
	const yScale = scaleLinear(
		[yAxis.min, yAxis.max],
		[plot.top + plot.height, plot.top],
	);
	const yTicks: ChartTick[] = yAxis.ticks.map((value) => {
		const label = yAxis.format(value);
		return {
			value,
			label,
			fullLabel: label,
			position: clampPosition(
				yScale(value),
				plot.top,
				plot.top + plot.height,
			),
		};
	});

	const band = bandScale(shown.length, [plot.left, plot.left + plot.width], 0.2);
	const zeroY = clampPosition(
		yScale(0),
		plot.top,
		plot.top + plot.height,
	);
	const bars: ChartBar[] = shown.map((entry, index) => {
		const valueY = clampPosition(
			yScale(entry.value),
			plot.top,
			plot.top + plot.height,
		);
		const top = Math.min(zeroY, valueY);
		const rawHeight = Math.abs(zeroY - valueY);
		return {
			x: band.start(index),
			y: rawHeight < 1 ? Math.max(plot.top, zeroY - 1) : top,
			w: band.width,
			h: rawHeight < 1 ? 1 : rawHeight,
			label: entry.label,
			value: entry.value,
		};
	});

	let xTicks: ChartTick[] = [];
	if (layout.xShow) {
		const maxTextWidth =
			rotate === 0 ? Math.max(band.width - 2, 34) : 80;
		const displayLabels = shown.map((entry) =>
			truncateText(entry.label, maxTextWidth, LABEL_FONT),
		);
		let kept = shown.map((_, index) => index);
		if (band.step < 10) {
			const maxLabels = Math.max(1, Math.floor(plot.width / 16));
			kept = thinLabels(kept, maxLabels);
		}
		xTicks = kept.map((index) => ({
			value: index,
			label: displayLabels[index] ?? "",
			fullLabel: shown[index]?.label ?? "",
			position: band.center(index),
		}));
	}

	const showLabels = optionBoolean(options, "showLabels", true);
	return {
		kind: "bar",
		width: size.w,
		height: size.h,
		ariaKey: "CHART_ARIA_BAR",
		x: {
			type: "category",
			title: layout.xTitle || undefined,
			showLabels: layout.xShow,
			ticks: xTicks,
		},
		y: {
			type: "number",
			title: layout.yTitle || undefined,
			showLabels: layout.yShow,
			ticks: yTicks,
			min: yAxis.min,
			max: yAxis.max,
			grid: layout.yGrid,
			format: yAxis.format,
		},
		series: [
			{
				key: yColumn.key,
				label: yColumn.labelKey,
				colorIndex: 1,
				points: [],
				bars,
			},
		],
		plot,
		hiddenCount,
		showLegend: false,
		showValueLabels: optionBoolean(options, "showValueLabels", false),
		valueList: showLabels
			? shown.map((entry) => ({
					label: entry.label,
					text: yAxis.format(entry.value),
				}))
			: null,
		xRotate: rotate,
	};
}
