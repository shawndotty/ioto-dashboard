import type { DataObject, Dataset } from "../types";
import { scaleLinear } from "./geometry";
import {
	buildNiceAxis,
	cellText,
	cellValue,
	computeLayout,
	optionBoolean,
	optionNumber,
	optionString,
	resolveColumn,
	type ChartOptions,
	type ChartSize,
	type ChartTick,
	type RenderableSpecBase,
} from "./spec";

export interface ScatterPoint {
	/** View-box pixel coordinates. */
	x: number;
	y: number;
	valueX: number;
	valueY: number;
	label: string;
	bucketKey: string;
	/** File/folder target for click-through. */
	targetPath?: string;
}

export interface ScatterChartSpec extends RenderableSpecBase {
	kind: "scatter";
	plot: { left: number; top: number; width: number; height: number };
	x: {
		min: number;
		max: number;
		ticks: ChartTick[];
		format: (value: number) => string;
		title?: string;
		labelKey: string;
	};
	y: {
		min: number;
		max: number;
		ticks: ChartTick[];
		format: (value: number) => string;
		title?: string;
		labelKey: string;
	};
	points: ScatterPoint[];
	pointRadius: number;
	showPointLabels: boolean;
}

const SCATTER_DEFAULT_FIELDS: Record<
	DataObject,
	{ x: string; y: string }
> = {
	task: { x: "total", y: "completed" },
	note: { x: "tasks", y: "completed" },
	file: { x: "size", y: "mtime" },
	folder: { x: "files", y: "size" },
	project: { x: "completed", y: "open" },
};

const DEFAULT_LIMIT = 500;
const MIN_LIMIT = 50;
const MAX_LIMIT = 2000;

export function buildScatterSpec(
	dataset: Dataset,
	options: ChartOptions,
	size: ChartSize,
	object: DataObject,
): ScatterChartSpec | null {
	if (dataset.rows.length === 0) return null;
	const defaults = SCATTER_DEFAULT_FIELDS[object] ?? SCATTER_DEFAULT_FIELDS.project;
	const xColumn = resolveColumn(
		dataset,
		optionString(options, "xField", defaults.x),
		"x",
		defaults.x,
		"number",
	);
	const yColumn = resolveColumn(
		dataset,
		optionString(options, "yField", defaults.y),
		"y",
		defaults.y,
		"number",
	);
	if (!xColumn || !yColumn) return null;

	const requestedLimit = Math.round(
		optionNumber(options, "limit") ?? DEFAULT_LIMIT,
	);
	const limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, requestedLimit));
	const rows =
		dataset.rows.length > limit ? dataset.rows.slice(0, limit) : dataset.rows;
	const hiddenCount = Math.max(
		0,
		(dataset.total > 0 ? dataset.total : dataset.rows.length) - rows.length,
	);

	const xValues = rows.map((row) => cellValue(row, xColumn.key));
	const yValues = rows.map((row) => cellValue(row, yColumn.key));
	const tickCount = Math.max(
		2,
		Math.min(6, Math.floor((size.h - 40) / 40)),
	);
	const xAxis = buildNiceAxis(
		xValues,
		xColumn.type,
		tickCount,
		optionString(options, "xFormat", "auto"),
	);
	const yAxis = buildNiceAxis(
		yValues,
		yColumn.type,
		tickCount,
		optionString(options, "yFormat", "auto"),
	);

	const layout = computeLayout(
		size,
		options,
		0,
		yAxis.labels,
		xAxis.labels,
		optionBoolean(options, "xShowLabels", true),
		optionString(options, "xTitle", ""),
		optionString(options, "yTitle", ""),
	);
	if (!layout) return null;
	const plot = layout.plot;
	const xScale = scaleLinear(
		[xAxis.min, xAxis.max],
		[plot.left, plot.left + plot.width],
	);
	const yScale = scaleLinear(
		[yAxis.min, yAxis.max],
		[plot.top + plot.height, plot.top],
	);
	const clamp = (value: number, min: number, max: number): number =>
		Math.max(min, Math.min(max, value));

	const xTicks: ChartTick[] = xAxis.ticks.map((value) => {
		const text = xAxis.format(value);
		return {
			value,
			label: text,
			fullLabel: text,
			position: clamp(xScale(value), plot.left, plot.left + plot.width),
		};
	});
	const yTicks: ChartTick[] = yAxis.ticks.map((value) => {
		const text = yAxis.format(value);
		return {
			value,
			label: text,
			fullLabel: text,
			position: clamp(yScale(value), plot.top, plot.top + plot.height),
		};
	});

	const points: ScatterPoint[] = rows.map((row, index) => ({
		x: clamp(xScale(xValues[index] ?? 0), plot.left, plot.left + plot.width),
		y: clamp(yScale(yValues[index] ?? 0), plot.top, plot.top + plot.height),
		valueX: xValues[index] ?? 0,
		valueY: yValues[index] ?? 0,
		label: cellText(row, xColumn.key) || String(index + 1),
		bucketKey: row.id,
		targetPath: row.cells[xColumn.key]?.path ?? row.cells[yColumn.key]?.path,
	}));

	const pointRadius = Math.max(
		2,
		Math.min(6, optionNumber(options, "pointSize") ?? 3.5),
	);

	return {
		kind: "scatter",
		width: size.w,
		height: size.h,
		ariaKey: "CHART_ARIA_SCATTER",
		showLegend: false,
		valueList: null,
		hiddenCount,
		extrasHeight: hiddenCount > 0 ? 20 : 0,
		interactive: true,
		plot,
		x: {
			min: xAxis.min,
			max: xAxis.max,
			ticks: xTicks,
			format: xAxis.format,
			title: layout.xTitle || undefined,
			labelKey: xColumn.labelKey,
		},
		y: {
			min: yAxis.min,
			max: yAxis.max,
			ticks: yTicks,
			format: yAxis.format,
			title: layout.yTitle || undefined,
			labelKey: yColumn.labelKey,
		},
		points,
		pointRadius,
		showPointLabels: optionBoolean(options, "showPointLabels", false),
	};
}
