import type { DataObject, Dataset } from "../types";
import { arcPath, arcRatio, type Point } from "./geometry";
import {
	cellText,
	cellValue,
	formatterFor,
	optionBoolean,
	optionNumber,
	optionString,
	resolveColumn,
	type ChartOptions,
	type ChartSize,
	type RenderableSpecBase,
} from "./spec";

export type PieLabelMode = "percent" | "value" | "both" | "none";

export interface PieSliceSpec {
	/** Already formatted category text. */
	label: string;
	/** Set for the synthetic “other” slice; renderer localizes it. */
	labelKey?: string;
	value: number;
	/** 0–1 floating share, used for the slice angle. */
	percent: number;
	integerPercent: number;
	colorIndex: number;
	className: string;
	startAngle: number;
	endAngle: number;
	path: string;
	/** Dataset row id, or `other` for the aggregate slice. */
	bucketKey: string;
	/** File/folder target for click-through. */
	targetPath?: string;
	isOther: boolean;
}

export interface PieChartSpec extends RenderableSpecBase {
	kind: "pie" | "donut";
	center: Point;
	radius: number;
	innerRadius: number;
	slices: PieSliceSpec[];
	labelMode: PieLabelMode;
	formatValue: (value: number) => string;
	/** i18n key of the numeric column, used by the bucket modal. */
	valueLabelKey: string;
	/** Formatted total, shown inside a donut. */
	totalText: string;
	totalLabelKey: "SETTING_PIE_TOTAL";
}

const PIE_DEFAULT_FIELDS: Record<
	DataObject,
	{ x: string; y: string }
> = {
	task: { x: "date", y: "total" },
	note: { x: "note", y: "tasks" },
	file: { x: "name", y: "size" },
	folder: { x: "name", y: "files" },
	project: { x: "name", y: "completed" },
};

const DEFAULT_TOP_N = 8;
const OTHER_BUCKET = "other";
const LEGEND_ROW_HEIGHT = 22;
const LEGEND_ITEMS_PER_ROW = 2;

function labelModeOf(options: ChartOptions): PieLabelMode {
	const value = optionString(options, "labelMode", "percent");
	return value === "value" || value === "both" || value === "none"
		? value
		: "percent";
}

function innerRadiusOf(options: ChartOptions, donut: boolean): number {
	if (!donut) return 0;
	const raw = optionNumber(options, "innerRadius") ?? 0.6;
	return Math.max(0.35, Math.min(0.8, raw));
}

/** Largest-remainder integer split so the shares always add up to 100. */
export function allocatePercents(percents: number[]): number[] {
	const total = percents.reduce((sum, value) => sum + value, 0);
	if (!(total > 0)) return percents.map(() => 0);
	const raw = percents.map((value) => (value / total) * 100);
	const floored = raw.map((value) => Math.floor(value));
	const remaining = 100 - floored.reduce((sum, value) => sum + value, 0);
	const order = raw
		.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
		.sort((left, right) => right.fraction - left.fraction);
	for (let i = 0; i < remaining; i += 1) {
		const target = order[i % order.length];
		if (!target) break;
		floored[target.index] = (floored[target.index] ?? 0) + 1;
	}
	return floored;
}

interface PieDatum {
	label: string;
	labelKey?: string;
	value: number;
	bucketKey: string;
	targetPath?: string;
}

export function buildPieSpec(
	dataset: Dataset,
	options: ChartOptions,
	size: ChartSize,
	object: DataObject,
	kind: "pie" | "donut" = "pie",
): PieChartSpec | null {
	if (dataset.rows.length === 0) return null;
	if (Math.min(size.w, size.h) < 80) return null;

	const defaults = PIE_DEFAULT_FIELDS[object] ?? PIE_DEFAULT_FIELDS.project;
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

	const rows = dataset.rows;
	const entries: PieDatum[] = rows
		.map((row, index) => {
			const value = cellValue(row, yColumn.key);
			return {
				label: cellText(row, xColumn.key) || String(index + 1),
				value: Number.isFinite(value) ? Math.max(0, value) : 0,
				bucketKey: row.id,
				targetPath:
					row.cells[xColumn.key]?.path ?? row.cells[yColumn.key]?.path,
			};
		})
		.filter((entry) => entry.value > 0)
		.sort((left, right) => right.value - left.value);

	if (entries.length === 0) return null;
	const total = entries.reduce((sum, entry) => sum + entry.value, 0);
	if (!(total > 0)) return null;

	const topN = Math.max(
		1,
		Math.min(
			50,
			Math.round(optionNumber(options, "topN") ?? DEFAULT_TOP_N),
		),
	);
	const shown = entries.slice(0, topN);
	const rest = entries.slice(topN);
	if (rest.length > 0) {
		shown.push({
			label: "",
			labelKey: "SETTING_PIE_OTHER",
			value: rest.reduce((sum, entry) => sum + entry.value, 0),
			bucketKey: OTHER_BUCKET,
		});
	}
	const hiddenCount = rest.length;

	const percents = shown.map((entry) => arcRatio(entry.value, total));
	const integerPercents = allocatePercents(shown.map((entry) => entry.value));
	const innerRadiusRatio = innerRadiusOf(options, kind === "donut");
	const center: Point = { x: size.w / 2, y: size.h / 2 };
	const radius = Math.max(1, Math.min(size.w, size.h) / 2 - 8);

	let cursor = 0;
	const slices: PieSliceSpec[] = shown.map((entry, index) => {
		const percent = percents[index] ?? 0;
		const isLast = index === shown.length - 1;
		const startAngle = cursor;
		const endAngle = isLast ? Math.PI * 2 : cursor + percent * Math.PI * 2;
		cursor = endAngle;
		const isOther = entry.bucketKey === OTHER_BUCKET;
		return {
			label: entry.label,
			labelKey: entry.labelKey,
			value: entry.value,
			percent,
			integerPercent: integerPercents[index] ?? 0,
			colorIndex: (index % 8) + 1,
			className: isOther
				? "ioto-chart-cat-other"
				: `ioto-chart-cat-${(index % 8) + 1}`,
			startAngle,
			endAngle,
			path: arcPath(
				center.x,
				center.y,
				radius,
				radius * innerRadiusRatio,
				startAngle,
				endAngle,
			),
			bucketKey: entry.bucketKey,
			targetPath: entry.targetPath,
			isOther,
		};
	});

	const showLegend = optionBoolean(options, "showLegend", true);
	const showLabels = optionBoolean(options, "showLabels", false);
	const valueList = showLabels
		? slices.map((slice) => ({
				label: slice.label,
				labelKey: slice.labelKey,
				text: `${slice.integerPercent}%`,
			}))
		: null;
	let extrasHeight = 0;
	if (showLegend && slices.length > 0) {
		extrasHeight +=
			Math.ceil(slices.length / LEGEND_ITEMS_PER_ROW) * LEGEND_ROW_HEIGHT;
	}
	if (valueList) extrasHeight += Math.min(valueList.length, 6) * 20;
	if (hiddenCount > 0) extrasHeight += 20;

	const formatValue = formatterFor(
		yColumn.type,
		optionString(options, "yFormat", "auto"),
	);

	return {
		kind,
		width: size.w,
		height: size.h,
		ariaKey: kind === "donut" ? "CHART_ARIA_DONUT" : "CHART_ARIA_PIE",
		showLegend,
		valueList,
		hiddenCount,
		extrasHeight,
		interactive: true,
		center,
		radius,
		innerRadius: radius * innerRadiusRatio,
		slices,
		labelMode: labelModeOf(options),
		formatValue,
		valueLabelKey: yColumn.labelKey,
		totalText: formatValue(total),
		totalLabelKey: "SETTING_PIE_TOTAL",
	};
}
