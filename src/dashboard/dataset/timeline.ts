import {
	formatSize,
	type DatasetCell,
	type DatasetColumn,
	type DatasetRow,
	type TimelineBucket,
	type TimelineDateField,
	type TimelineRange,
} from "./types";
import { cell } from "./adapters/shared";

const FILENAME_DATE = /(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?:[^\d]|$)/;

export interface TimelineRecord {
	basename: string;
	ctime: number;
	mtime: number;
	size?: number;
	tasks?: number;
	completed?: number;
	open?: number;
	/** Source file backing the record (enables the bucket detail list). */
	path?: string;
	line?: number;
	/** Row text; falls back to the basename. */
	text?: string;
	kind?: TimelineSourceRef["kind"];
	marker?: string;
}

/** One original record behind a timeline bucket. */
export interface TimelineSourceRef {
	path: string;
	line?: number;
	label: string;
	kind: "task" | "note" | "file";
	marker?: string;
	/** Local day used to group month buckets. */
	date?: string;
}

/** Hard cap per bucket so a month bucket cannot freeze the modal. */
export const MAX_BUCKET_ITEMS = 500;

export interface TimelineSeriesOptions {
	bucket: TimelineBucket;
	dateField: TimelineDateField;
	range: TimelineRange;
	now?: () => number;
}

export type TimelineObject = "task" | "note" | "file";

export const TIMELINE_COLUMNS: Record<TimelineObject, DatasetColumn[]> = {
	task: [
		{ key: "date", labelKey: "DATASET_COL_DATE", type: "date" },
		{ key: "total", labelKey: "DATASET_COL_TASKS", type: "number", align: "right" },
		{
			key: "completed",
			labelKey: "DATASET_COL_COMPLETED",
			type: "number",
			align: "right",
		},
		{ key: "open", labelKey: "DATASET_COL_OPEN", type: "number", align: "right" },
	],
	note: [
		{ key: "date", labelKey: "DATASET_COL_DATE", type: "date" },
		{ key: "total", labelKey: "DATASET_COL_NOTES", type: "number", align: "right" },
		{ key: "tasks", labelKey: "DATASET_COL_TASKS", type: "number", align: "right" },
		{
			key: "completed",
			labelKey: "DATASET_COL_COMPLETED",
			type: "number",
			align: "right",
		},
		{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	],
	file: [
		{ key: "date", labelKey: "DATASET_COL_DATE", type: "date" },
		{ key: "total", labelKey: "DATASET_COL_FILES", type: "number", align: "right" },
		{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	],
};

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function localDay(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function filenameDate(basename: string): number | null {
	const match = FILENAME_DATE.exec(basename);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null;
	}
	return date.getTime();
}

export function timelineDateOf(
	record: TimelineRecord,
	dateField: TimelineDateField,
): number | null {
	const parsed = filenameDate(record.basename);
	switch (dateField) {
		case "filename":
			return parsed;
		case "created":
			return record.ctime > 0 ? record.ctime : null;
		case "modified":
			return record.mtime > 0 ? record.mtime : null;
		default:
			if (parsed !== null) return parsed;
			return record.ctime > 0 ? record.ctime : null;
	}
}

export function bucketKeyOf(
	timestamp: number,
	bucket: TimelineBucket,
): string {
	const date = new Date(timestamp);
	if (bucket === "month") {
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
	}
	if (bucket === "week") {
		const offset = (date.getDay() + 6) % 7;
		return localDay(
			new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset),
		);
	}
	return localDay(date);
}

export function buildTimelineRows(
	records: TimelineRecord[],
	options: TimelineSeriesOptions,
	columns: DatasetColumn[],
): { rows: DatasetRow[]; columns: DatasetColumn[]; sourceTotal: number } {
	const end = new Date(options.now?.() ?? Date.now());
	end.setHours(0, 0, 0, 0);
	const endYear = end.getFullYear();
	const endMonth = end.getMonth();
	const endDay = end.getDate();
	const startTime = new Date(
		endYear,
		endMonth,
		endDay - (options.range - 1),
	).getTime();
	const endOfToday = new Date(endYear, endMonth, endDay + 1).getTime() - 1;

	const bucketKeys: string[] = [];
	const known = new Set<string>();
	for (let offset = 0; offset < options.range; offset += 1) {
		const key = bucketKeyOf(
			new Date(endYear, endMonth, endDay - (options.range - 1) + offset).getTime(),
			options.bucket,
		);
		if (known.has(key)) continue;
		known.add(key);
		bucketKeys.push(key);
	}

	const valueKeys = columns
		.map((column) => column.key)
		.filter((key) => key !== "date");
	const totals = new Map<string, number>();
	const sums = new Map<string, Record<string, number>>();
	const refsByBucket = new Map<string, TimelineSourceRef[]>();
	const relatedTotals = new Map<string, number>();
	for (const key of bucketKeys) {
		totals.set(key, 0);
		sums.set(key, {});
	}

	let sourceTotal = 0;
	for (const record of records) {
		const timestamp = timelineDateOf(record, options.dateField);
		if (timestamp === null) continue;
		if (timestamp < startTime || timestamp > endOfToday) continue;
		const key = bucketKeyOf(timestamp, options.bucket);
		if (!known.has(key)) continue;
		sourceTotal += 1;
		totals.set(key, (totals.get(key) ?? 0) + 1);
		relatedTotals.set(key, (relatedTotals.get(key) ?? 0) + 1);
		const refs = refsByBucket.get(key) ?? [];
		if (refs.length < MAX_BUCKET_ITEMS) {
			refs.push({
				path: record.path ?? "",
				line: record.line,
				label: record.text ?? record.basename,
				kind: record.kind ?? "file",
				marker: record.marker,
				date: localDay(new Date(timestamp)),
			});
			refsByBucket.set(key, refs);
		}
		const bucketSums = sums.get(key) ?? {};
		for (const valueKey of valueKeys) {
			if (valueKey === "total") continue;
			const value = (record as unknown as Record<string, number | undefined>)[
				valueKey
			];
			if (typeof value !== "number" || !Number.isFinite(value)) continue;
			bucketSums[valueKey] = (bucketSums[valueKey] ?? 0) + value;
		}
		sums.set(key, bucketSums);
	}

	if (sourceTotal === 0) {
		return { rows: [], columns, sourceTotal: 0 };
	}

	const rows = bucketKeys.map((key): DatasetRow => {
		const cells: Record<string, DatasetCell> = {
			date: cell(key, { sortValue: key }),
		};
		const bucketSums = sums.get(key) ?? {};
		for (const column of columns) {
			if (column.key === "date") continue;
			const value =
				column.key === "total"
					? (totals.get(key) ?? 0)
					: (bucketSums[column.key] ?? 0);
			cells[column.key] =
				column.type === "size"
					? cell(formatSize(value), { sortValue: value })
					: cell(String(value), { sortValue: value });
		}
		const refs = refsByBucket.get(key);
		if (!refs || refs.length === 0) return { id: key, cells };
		return {
			id: key,
			cells,
			related: refs,
			relatedTotal: relatedTotals.get(key) ?? refs.length,
		};
	});

	return { rows, columns, sourceTotal };
}
