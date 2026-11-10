import { resolveQuery } from "../../../query/resolve";
import {
	emptyDataset,
	formatDate,
	formatSize,
	truncateRows,
	type Dataset,
	type DatasetAdapter,
	type DatasetColumn,
} from "../types";
import { cell } from "./shared";

export const NOTE_COLUMNS: DatasetColumn[] = [
	{ key: "note", labelKey: "DATASET_COL_NOTE", type: "text" },
	{ key: "folder", labelKey: "DATASET_COL_FOLDER", type: "path" },
	{ key: "ioType", labelKey: "DATASET_COL_IO_TYPE", type: "text" },
	{ key: "tasks", labelKey: "DATASET_COL_TASKS", type: "number", align: "right" },
	{
		key: "completed",
		labelKey: "DATASET_COL_COMPLETED",
		type: "number",
		align: "right",
	},
	{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	{ key: "mtime", labelKey: "DATASET_COL_MTIME", type: "date", align: "right" },
];

export const noteAdapter: DatasetAdapter = (input): Dataset => {
	const { request, query, snapshot } = input;
	if (!query || !snapshot) return emptyDataset(request, NOTE_COLUMNS);
	const notes = resolveQuery(snapshot, query, {
		customFilters: input.customFilters,
		now: input.now,
	}).notes;
	const rows = notes.map((note) => ({
		id: note.path,
		cells: {
			note: cell(note.basename, { path: note.path }),
			folder: cell(note.folder, { path: note.path }),
			ioType: cell(note.ioType),
			tasks: cell(String(note.fileTaskCount), {
				sortValue: note.fileTaskCount,
			}),
			completed: cell(String(note.fileCompletedCount), {
				sortValue: note.fileCompletedCount,
			}),
			size: cell(formatSize(note.size), { sortValue: note.size }),
			mtime: cell(formatDate(note.mtime), { sortValue: note.mtime }),
		},
	}));
	const truncated = truncateRows(rows, request.limit);
	return {
		object: request.object,
		measure: request.measure,
		columns: NOTE_COLUMNS,
		...truncated,
		scalarText: String(notes.length),
	};
};
