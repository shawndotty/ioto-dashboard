import type { CustomFilterDef, IndexSnapshot } from "../../data/types";
import type { DailyPoint, MetricResult } from "../../metrics/types";
import type { QueryDefinition } from "../../query/types";
import type { TimelineSourceRef } from "./timeline";

export type DataObject = "task" | "note" | "file" | "folder" | "project";

export type MeasureId =
	| "count"
	| "completed"
	| "open"
	| "ratio"
	| "size"
	| "mtime"
	| "series"
	| "timeline";

export type TimelineBucket = "day" | "week" | "month";

export type TimelineDateField = "auto" | "filename" | "created" | "modified";

export interface TimelineRequest {
	bucket: TimelineBucket;
	dateField: TimelineDateField;
}

export type ViewId =
	| "scalar"
	| "list"
	| "table"
	| "progress"
	| "bar"
	| "line"
	| "pie"
	| "donut"
	| "scatter"
	| "treemap"
	| "markdown";

export const DATA_OBJECTS: DataObject[] = [
	"task",
	"note",
	"file",
	"folder",
	"project",
];

export const MEASURE_IDS: MeasureId[] = [
	"count",
	"completed",
	"open",
	"ratio",
	"size",
	"mtime",
	"series",
	"timeline",
];

export const VIEW_IDS: ViewId[] = [
	"scalar",
	"list",
	"table",
	"progress",
	"bar",
	"line",
	"pie",
	"donut",
	"scatter",
	"treemap",
	"markdown",
];

export type DatasetCellType =
	| "text"
	| "number"
	| "date"
	| "percent"
	| "size"
	| "path";

export interface DatasetColumn {
	key: string;
	labelKey: string;
	type: DatasetCellType;
	align?: "left" | "right";
}

export interface DatasetCell {
	/** Already formatted for the column type; views never re-format. */
	text: string;
	sortValue?: string | number;
	path?: string;
	line?: number;
}

export interface DatasetRow {
	id: string;
	cells: Record<string, DatasetCell>;
	/** Timeline only: original records behind this bucket (capped at 500). */
	related?: TimelineSourceRef[];
	relatedTotal?: number;
}

export interface DatasetSummaryItem {
	labelKey: string;
	value: string;
	/** Which measure this item reports; views use it to highlight the active one. */
	measure?: MeasureId;
}

export interface DatasetSummary {
	items: DatasetSummaryItem[];
}

export interface Dataset {
	object: DataObject;
	measure: MeasureId;
	columns: DatasetColumn[];
	rows: DatasetRow[];
	/** Row count before `limit` truncation. */
	total: number;
	truncated: boolean;
	/** Scalar/ratio measures expose their headline number here. */
	scalarText?: string;
	ratio?: number | null;
	/** timeline: records inside the window, to tell "no data" from "all zero". */
	sourceTotal?: number;
	/** Full-collection figures, computed before row filtering and truncation. */
	summary?: DatasetSummary;
}

export interface DatasetRequest {
	object: DataObject;
	measure: MeasureId;
	queryId: string;
	basis?: "file" | "section";
	groupBy?: "project" | "ioType" | "sectionRole";
	limit?: number;
	/** Line/bar ranges in days. */
	range?: 7 | 30 | 90 | 180;
	/** Only read when `measure === "timeline"`. */
	timeline?: TimelineRequest;
}

export interface DatasetAdapterInput {
	request: DatasetRequest;
	query: QueryDefinition | undefined;
	snapshot: IndexSnapshot | undefined;
	metric?: MetricResult;
	dailySeries: (limit: number) => DailyPoint[];
	customFilters?: CustomFilterDef[];
	now?: () => number;
}

export type DatasetAdapter = (input: DatasetAdapterInput) => Dataset;

/** Stable cache key: same fields as `metricKey`, plus the object/range. */
export function datasetKey(request: DatasetRequest): string {
	return [
		request.object,
		request.measure,
		request.queryId,
		request.basis ?? "",
		request.groupBy ?? "",
		request.limit === undefined ? "" : String(request.limit),
		request.range === undefined ? "" : String(request.range),
		request.timeline?.bucket ?? "",
		request.timeline?.dateField ?? "",
	].join("|");
}

export function emptyDataset(
	request: DatasetRequest,
	columns: DatasetColumn[] = [],
): Dataset {
	return {
		object: request.object,
		measure: request.measure,
		columns,
		rows: [],
		total: 0,
		truncated: false,
	};
}

export function formatCount(value: number): string {
	return String(value);
}

export function formatPercent(ratio: number | null | undefined): string {
	return ratio === null || ratio === undefined
		? "—"
		: `${Math.round(ratio * 100)}%`;
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(mtime: number): string {
	if (!mtime) return "—";
	const date = new Date(mtime);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Applies `limit` consistently and reports truncation. */
export function truncateRows(
	rows: DatasetRow[],
	limit: number | undefined,
): { rows: DatasetRow[]; total: number; truncated: boolean } {
	const total = rows.length;
	if (limit === undefined || limit <= 0 || total <= limit) {
		return { rows, total, truncated: false };
	}
	return { rows: rows.slice(0, limit), total, truncated: true };
}
