import { columnMatchesAxis } from "../field-roles";
import type { TimelineSourceRef } from "../timeline";
import type { DataObject, Dataset, DatasetColumn } from "../types";
import { truncateText } from "./geometry";
import { allocatePercents } from "./pie-spec";
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

/** Safety valve for file queries: rows beyond this are dropped before layout. */
export const TREEMAP_ROW_CAP = 500;
/** Height reserved at the top of every group tile for its title bar. */
export const TREEMAP_HEADER_H = 14;

const DEFAULT_TOP_N = 30;
const MAX_TOP_N = 200;
const OTHER_BUCKET = "other";
const UNGROUPED_KEY = "__ungrouped__";
const LEGEND_ROW_HEIGHT = 22;
const LEGEND_ITEMS_PER_ROW = 2;
const LABEL_FONT = 11;

export type TreemapLabelMode = "name" | "value" | "both" | "none";

export interface TreemapRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface TreemapTileSpec {
	/** Global internal key: `row:<id>` / `group:<key>` / `other`. */
	bucketKey: string;
	/** Display text, truncated to the tile. The bucket modal uses it as a title. */
	label: string;
	/** Localised replacement for `label` (the synthetic “other” tile). */
	labelKey?: string;
	/** Full text for the tooltip and native `<title>`. */
	fullLabel: string;
	value: number;
	/** 0–1 share of the whole treemap. */
	percent: number;
	integerPercent: number;
	rect: TreemapRect;
	/** 0 = root tile (leaf or group), 1 = child inside a group. */
	depth: 0 | 1;
	colorIndex: number;
	className: string;
	rowIds: string[];
	refs: TimelineSourceRef[];
	relatedTotal: number;
	targetPath?: string;
	parentKey?: string;
	isOther: boolean;
}

export interface TreemapChartSpec extends RenderableSpecBase {
	kind: "treemap";
	tiles: TreemapTileSpec[];
	labelMode: TreemapLabelMode;
	formatValue: (value: number) => string;
	/** i18n key of the numeric column, used by the bucket modal. */
	valueLabelKey: string;
}

const TREEMAP_DEFAULT_FIELDS: Record<DataObject, { x: string; y: string }> = {
	task: { x: "date", y: "total" },
	note: { x: "note", y: "tasks" },
	file: { x: "name", y: "size" },
	folder: { x: "name", y: "files" },
	project: { x: "name", y: "completed" },
};

function emptyRect(rect: TreemapRect): TreemapRect {
	return { x: rect.x, y: rect.y, w: 0, h: 0 };
}

/** Worst aspect ratio of one row laid along `side`; Infinity when unusable. */
function worstRatio(values: number[], side: number): number {
	const sum = values.reduce((total, value) => total + value, 0);
	if (!(sum > 0) || !(side > 0)) return Number.POSITIVE_INFINITY;
	let max = values[0] ?? 0;
	let min = values[0] ?? 0;
	for (const value of values) {
		if (value > max) max = value;
		if (value < min) min = value;
	}
	const sumSq = sum * sum;
	const sideSq = side * side;
	return Math.max((sideSq * max) / sumSq, sumSq / (sideSq * min));
}

/** Inward gap; tiny tiles keep at least one pixel instead of going negative. */
function insetRect(rect: TreemapRect, gap: number): TreemapRect {
	if (!(gap > 0)) return rect;
	const insetAxis = (start: number, size: number): [number, number] => {
		if (!(size > 1)) return [start, Math.max(0, size)];
		const pad = Math.min(gap / 2, (size - 1) / 2);
		return [start + pad, Math.max(1, size - pad * 2)];
	};
	const [x, w] = insetAxis(rect.x, rect.w);
	const [y, h] = insetAxis(rect.y, rect.h);
	return { x, y, w, h };
}

interface SizedItem {
	index: number;
	value: number;
}

/**
 * Squarified treemap layout. Returns one rect per input value in input order;
 * non-positive or non-finite values get a zero-area rect at the origin.
 */
export function squarify(
	values: number[],
	rect: TreemapRect,
	gap = 2,
): TreemapRect[] {
	const result = values.map(() => emptyRect(rect));
	if (!(rect.w > 0) || !(rect.h > 0)) return result;

	const items: SizedItem[] = [];
	values.forEach((value, index) => {
		if (Number.isFinite(value) && value > 0) items.push({ index, value });
	});
	if (items.length === 0) return result;
	items.sort((left, right) => right.value - left.value);
	const total = items.reduce((sum, item) => sum + item.value, 0);
	if (!(total > 0)) return result;

	// 把度量值换算成面积单位：缩放后 sum === rect.w * rect.h。
	// worstRatio 的公式只在「值即面积」时才有意义，否则会退化成一行一块。
	const area = rect.w * rect.h;
	const scale = area / total;
	for (const item of items) item.value *= scale;

	let x = rect.x;
	let y = rect.y;
	let w = rect.w;
	let h = rect.h;
	let remaining = area;
	let start = 0;

	while (start < items.length && w > 0 && h > 0) {
		const side = Math.min(w, h);
		const first = items[start];
		if (!first) break;
		const row: SizedItem[] = [first];
		let rowValues: number[] = [first.value];
		let end = start + 1;
		while (end < items.length) {
			const next = items[end];
			if (!next) break;
			const candidate = [...rowValues, next.value];
			if (worstRatio(candidate, side) <= worstRatio(rowValues, side)) {
				row.push(next);
				rowValues = candidate;
				end += 1;
			} else {
				break;
			}
		}

		const rowSum = rowValues.reduce((sum, value) => sum + value, 0);
		const fraction = remaining > 0 ? rowSum / remaining : 1;
		if (w >= h) {
			const columnWidth = Math.max(0, Math.min(w, fraction * w));
			let cursor = y;
			for (const item of row) {
				const height = rowSum > 0 ? (item.value / rowSum) * h : 0;
				result[item.index] = insetRect(
					{ x, y: cursor, w: columnWidth, h: height },
					gap,
				);
				cursor += height;
			}
			x += columnWidth;
			w -= columnWidth;
		} else {
			const rowHeight = Math.max(0, Math.min(h, fraction * h));
			let cursor = x;
			for (const item of row) {
				const width = rowSum > 0 ? (item.value / rowSum) * w : 0;
				result[item.index] = insetRect(
					{ x: cursor, y, w: width, h: rowHeight },
					gap,
				);
				cursor += width;
			}
			y += rowHeight;
			h -= rowHeight;
		}
		remaining -= rowSum;
		start = end;
	}
	return result;
}

function lastSegment(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const slash = trimmed.lastIndexOf("/");
	return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function parentPath(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const slash = trimmed.lastIndexOf("/");
	return slash > 0 ? trimmed.slice(0, slash) : "";
}

type GroupMode =
	| { kind: "none" }
	| { kind: "folder" }
	| { kind: "parent" }
	| { kind: "column"; column: DatasetColumn };

interface RowGroup {
	key: string;
	label: string;
	labelKey?: string;
}

function groupModeFor(
	dataset: Dataset,
	object: DataObject,
	raw: string,
): GroupMode {
	if (raw === "none") return { kind: "none" };
	if (raw !== "auto") {
		const column = dataset.columns.find(
			(candidate) =>
				candidate.key === raw && columnMatchesAxis(candidate, "category"),
		);
		if (column) return { kind: "column", column };
	}
	if (object === "project" || object === "task") return { kind: "none" };
	if (object === "folder") return { kind: "parent" };
	return { kind: "folder" };
}

function ungrouped(): RowGroup {
	return { key: UNGROUPED_KEY, label: "", labelKey: "SETTING_TREEMAP_UNGROUPED" };
}

function groupOf(
	row: Dataset["rows"][number],
	mode: GroupMode,
): RowGroup {
	if (mode.kind === "none") return { key: "", label: "" };
	if (mode.kind === "column") {
		const text = cellText(row, mode.column.key).trim();
		if (!text) return ungrouped();
		return {
			key: text,
			label: mode.column.type === "path" ? lastSegment(text) : text,
		};
	}
	const path =
		mode.kind === "parent" ? cellText(row, "path") || row.id : cellText(row, "folder");
	const text = path.trim();
	if (!text) return ungrouped();
	if (mode.kind === "parent") {
		const key = parentPath(text);
		if (!key) return ungrouped();
		return { key, label: lastSegment(key) };
	}
	return { key: text, label: lastSegment(text) };
}

interface LeafDatum {
	rowId: string;
	label: string;
	value: number;
	group: RowGroup;
	targetPath?: string;
	refs: TimelineSourceRef[];
	relatedTotal: number;
}

interface TileNode {
	bucketKey: string;
	label: string;
	labelKey?: string;
	fullLabel: string;
	value: number;
	kind: "group" | "leaf" | "other";
	group?: RowGroup;
	leaves: LeafDatum[];
}

function labelModeOf(options: ChartOptions): TreemapLabelMode {
	const value = optionString(options, "labelMode", "name");
	return value === "value" || value === "both" || value === "none"
		? value
		: "name";
}

function refsKey(ref: TimelineSourceRef): string {
	return `${ref.path}|${ref.line ?? ""}`;
}

function mergeRefs(leaves: LeafDatum[]): TimelineSourceRef[] {
	const seen = new Set<string>();
	const merged: TimelineSourceRef[] = [];
	for (const leaf of leaves) {
		for (const ref of leaf.refs) {
			const key = refsKey(ref);
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(ref);
		}
	}
	return merged;
}

function rowIdSet(leaves: LeafDatum[]): string[] {
	return [...new Set(leaves.map((leaf) => leaf.rowId))];
}

function refTotal(leaves: LeafDatum[]): number {
	return leaves.reduce((sum, leaf) => sum + leaf.relatedTotal, 0);
}

function buildTiles(
	node: TileNode,
	rect: TreemapRect,
	index: number,
	total: number,
	totalInteger: number,
	leafInteger: Map<string, number>,
): TreemapTileSpec[] {
	const className = node.kind === "other"
		? "ioto-chart-cat-other"
		: `ioto-chart-cat-${(index % 8) + 1}`;
	const colorIndex = (index % 8) + 1;
	const baseLabel = node.label;
	const displayLabel = node.labelKey
		? baseLabel
		: truncateTileLabel(baseLabel, rect.w);

	if (node.kind !== "group") {
		const leaf = node.leaves[0];
		if (!leaf) return [];
		const isOther = node.kind === "other";
		return [
			{
				bucketKey: node.bucketKey,
				label: displayLabel,
				labelKey: node.labelKey,
				fullLabel: node.fullLabel,
				value: node.value,
				percent: total > 0 ? node.value / total : 0,
				integerPercent: isOther
					? totalInteger
					: leafInteger.get(leaf.rowId) ?? 0,
				rect,
				depth: 0,
				colorIndex,
				className,
				rowIds: isOther ? [] : [leaf.rowId],
				refs: isOther ? [] : leaf.refs,
				relatedTotal: isOther ? 0 : leaf.relatedTotal,
				targetPath: isOther ? undefined : leaf.targetPath,
				isOther,
			},
		];
	}

	const parent: TreemapTileSpec = {
		bucketKey: node.bucketKey,
		label: displayLabel,
		labelKey: node.labelKey,
		fullLabel: node.fullLabel,
		value: node.value,
		percent: total > 0 ? node.value / total : 0,
		integerPercent: totalInteger,
		rect,
		depth: 0,
		colorIndex,
		className,
		rowIds: rowIdSet(node.leaves),
		refs: mergeRefs(node.leaves),
		relatedTotal: refTotal(node.leaves),
		targetPath: node.group?.key && node.group.key !== UNGROUPED_KEY
			? node.group.key
			: undefined,
		isOther: false,
	};

	const content: TreemapRect = {
		x: rect.x,
		y: rect.y + TREEMAP_HEADER_H,
		w: rect.w,
		h: rect.h - TREEMAP_HEADER_H,
	};
	if (!(content.h > 0) || !(content.w > 0)) return [parent];

	const ordered = node.leaves
		.slice()
		.sort((left, right) => right.value - left.value);
	const rects = squarify(
		ordered.map((leaf) => leaf.value),
		content,
		2,
	);
	const children: TreemapTileSpec[] = ordered.map((leaf, childIndex) => {
		const childRect = rects[childIndex] ?? emptyRect(content);
		return {
			bucketKey: `row:${leaf.rowId}`,
			label: truncateTileLabel(leaf.label, childRect.w),
			fullLabel: leaf.label,
			value: leaf.value,
			percent: total > 0 ? leaf.value / total : 0,
			integerPercent: leafInteger.get(leaf.rowId) ?? 0,
			rect: childRect,
			depth: 1,
			colorIndex,
			className,
			rowIds: [leaf.rowId],
			refs: leaf.refs,
			relatedTotal: leaf.relatedTotal,
			targetPath: leaf.targetPath,
			parentKey: parent.bucketKey,
			isOther: false,
		};
	});
	return [parent, ...children];
}

function truncateTileLabel(text: string, width: number): string {
	if (width <= 0) return "";
	return truncateText(text, Math.max(0, width - 8), LABEL_FONT);
}

export function buildTreemapSpec(
	dataset: Dataset,
	options: ChartOptions,
	size: ChartSize,
	object: DataObject,
): TreemapChartSpec | null {
	if (dataset.rows.length === 0) return null;
	if (Math.min(size.w, size.h) < 60) return null;

	const defaults = TREEMAP_DEFAULT_FIELDS[object] ?? TREEMAP_DEFAULT_FIELDS.project;
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

	const mode = groupModeFor(
		dataset,
		object,
		optionString(options, "groupField", "auto"),
	);
	const leaves: LeafDatum[] = [];
	dataset.rows.forEach((row) => {
		const value = cellValue(row, yColumn.key);
		if (!(value > 0)) return;
		const label = cellText(row, xColumn.key) || row.id;
		let refs: TimelineSourceRef[] = [];
		let relatedTotal = 1;
		if (object === "project") {
			refs = row.related ?? [];
			relatedTotal = row.relatedTotal ?? refs.length;
		} else if (object === "note" || object === "file") {
			refs = [{ path: row.id, label, kind: object }];
		}
		leaves.push({
			rowId: row.id,
			label,
			value,
			group: groupOf(row, mode),
			targetPath:
				row.cells[xColumn.key]?.path ?? row.cells[yColumn.key]?.path,
			refs,
			relatedTotal,
		});
	});
	if (leaves.length === 0) return null;
	leaves.sort((left, right) => right.value - left.value);

	const total = leaves.reduce((sum, leaf) => sum + leaf.value, 0);
	if (!(total > 0)) return null;

	const topN = Math.max(
		1,
		Math.min(
			MAX_TOP_N,
			Math.round(optionNumber(options, "topN") ?? DEFAULT_TOP_N),
		),
	);
	const retained = leaves.slice(0, topN);
	const rest = leaves.slice(topN);
	const otherValue = rest.reduce((sum, leaf) => sum + leaf.value, 0);

	const nodes: TileNode[] = [];
	if (mode.kind === "none") {
		for (const leaf of retained) {
			nodes.push({
				bucketKey: `row:${leaf.rowId}`,
				label: leaf.label,
				fullLabel: leaf.label,
				value: leaf.value,
				kind: "leaf",
				leaves: [leaf],
			});
		}
	} else {
		const groups = new Map<string, LeafDatum[]>();
		for (const leaf of retained) {
			const bucket = groups.get(leaf.group.key);
			if (bucket) bucket.push(leaf);
			else groups.set(leaf.group.key, [leaf]);
		}
		for (const [groupKey, groupLeaves] of groups) {
			const first = groupLeaves[0];
			if (!first) continue;
			const groupTotal = groupLeaves.reduce(
				(sum, leaf) => sum + leaf.value,
				0,
			);
			nodes.push({
				bucketKey: `group:${groupKey}`,
				label: first.group.label,
				labelKey: first.group.labelKey,
				fullLabel:
					first.group.labelKey ?? first.group.key,
				value: groupTotal,
				kind: "group",
				group: first.group,
				leaves: groupLeaves,
			});
		}
	}
	if (rest.length > 0) {
		nodes.push({
			bucketKey: OTHER_BUCKET,
			label: "",
			labelKey: "SETTING_PIE_OTHER",
			fullLabel: "",
			value: otherValue,
			kind: "other",
			leaves: rest.slice(0, 1),
		});
	}
	if (nodes.length === 0) return null;
	nodes.sort((left, right) => right.value - left.value);

	const rootRects = squarify(
		nodes.map((node) => node.value),
		{ x: 0, y: 0, w: size.w, h: size.h },
		2,
	);
	const rootInteger = allocatePercents(nodes.map((node) => node.value));
	const leafValues = [
		...retained.map((leaf) => leaf.value),
		...(rest.length > 0 ? [otherValue] : []),
	];
	const leafIntegerList = allocatePercents(leafValues);
	const leafInteger = new Map<string, number>();
	retained.forEach((leaf, index) => {
		leafInteger.set(leaf.rowId, leafIntegerList[index] ?? 0);
	});
	const otherInteger = rest.length > 0
		? leafIntegerList[leafIntegerList.length - 1] ?? 0
		: 0;

	const labelMode = labelModeOf(options);
	const tiles: TreemapTileSpec[] = [];
	nodes.forEach((node, index) => {
		const rect = rootRects[index] ?? emptyRect({ x: 0, y: 0, w: size.w, h: size.h });
		tiles.push(
			...buildTiles(
				node,
				rect,
				index,
				total,
				node.kind === "other"
					? otherInteger
					: rootInteger[index] ?? 0,
				leafInteger,
			),
		);
	});

	const showLegend = optionBoolean(options, "showLegend", false);
	const hiddenCount = dataset.truncated
		? Math.max(0, dataset.total - dataset.rows.length)
		: 0;
	let extrasHeight = 0;
	if (showLegend && nodes.length > 0) {
		extrasHeight +=
			Math.ceil(nodes.length / LEGEND_ITEMS_PER_ROW) * LEGEND_ROW_HEIGHT;
	}
	if (hiddenCount > 0) extrasHeight += 20;

	return {
		kind: "treemap",
		width: size.w,
		height: size.h,
		ariaKey: "CHART_ARIA_TREEMAP",
		showLegend,
		valueList: null,
		hiddenCount,
		interactive: true,
		extrasHeight,
		tiles,
		labelMode,
		formatValue: formatterFor(
			yColumn.type,
			optionString(options, "yFormat", "auto"),
		),
		valueLabelKey: yColumn.labelKey,
	};
}