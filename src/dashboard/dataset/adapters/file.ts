import { resolveQuery } from "../../../query/resolve";
import type { FileRecord } from "../../../data/types";
import {
	emptyDataset,
	formatDate,
	formatSize,
	truncateRows,
	type Dataset,
	type DatasetAdapter,
	type DatasetColumn,
	type MeasureId,
} from "../types";
import { cell } from "./shared";
import {
	buildTimelineRows,
	TIMELINE_COLUMNS,
	type TimelineRecord,
} from "../timeline";

export const FILE_COLUMNS: DatasetColumn[] = [
	{ key: "name", labelKey: "DATASET_COL_NAME", type: "text" },
	{ key: "folder", labelKey: "DATASET_COL_FOLDER", type: "path" },
	{ key: "extension", labelKey: "DATASET_COL_EXTENSION", type: "text" },
	{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	{ key: "mtime", labelKey: "DATASET_COL_MTIME", type: "date", align: "right" },
];

function scalarTextFor(files: FileRecord[], measure: MeasureId): string {
	if (files.length === 0) {
		return measure === "size" || measure === "mtime" ? "—" : "0";
	}
	if (measure === "size") {
		return formatSize(files.reduce((sum, file) => sum + file.size, 0));
	}
	if (measure === "mtime") {
		const latest = files.reduce(
			(max, file) => (file.mtime > max ? file.mtime : max),
			files[0]?.mtime ?? 0,
		);
		return formatDate(latest);
	}
	return String(files.length);
}

export const fileAdapter: DatasetAdapter = (input): Dataset => {
	const { request, query, snapshot } = input;
	if (request.measure === "timeline") {
		const columns = TIMELINE_COLUMNS.file;
		if (!query || !snapshot) return emptyDataset(request, columns);
		const files = resolveQuery(snapshot, query, {
			customFilters: input.customFilters,
			now: input.now,
		}).files ?? [];
		const records: TimelineRecord[] = files.map((file) => ({
			basename: file.basename,
			ctime: file.ctime,
			mtime: file.mtime,
			size: file.size,
		}));
		const timeline = buildTimelineRows(
			records,
			{
				bucket: request.timeline?.bucket ?? "day",
				dateField: request.timeline?.dateField ?? "auto",
				range: request.range ?? 30,
				now: input.now,
			},
			columns,
		);
		const truncated = truncateRows(timeline.rows, request.limit);
		return {
			object: request.object,
			measure: request.measure,
			columns: timeline.columns,
			...truncated,
			sourceTotal: timeline.sourceTotal,
		};
	}
	if (!query || !snapshot) return emptyDataset(request, FILE_COLUMNS);
	const files = resolveQuery(snapshot, query, {
		customFilters: input.customFilters,
		now: input.now,
	}).files ?? [];
	const rows = files.map((file) => ({
		id: file.path,
		cells: {
			name: cell(file.basename, { path: file.path }),
			folder: cell(file.folder, { path: file.folder }),
			extension: cell(file.extension),
			size: cell(formatSize(file.size), { sortValue: file.size }),
			mtime: cell(formatDate(file.mtime), { sortValue: file.mtime }),
		},
	}));
	const truncated = truncateRows(rows, request.limit);
	return {
		object: request.object,
		measure: request.measure,
		columns: FILE_COLUMNS,
		...truncated,
		scalarText: scalarTextFor(files, request.measure),
	};
};
