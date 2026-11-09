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

const COLUMNS: DatasetColumn[] = [
	{ key: "name", labelKey: "DATASET_COL_NAME", type: "text" },
	{ key: "path", labelKey: "DATASET_COL_PATH", type: "path" },
	{ key: "files", labelKey: "DATASET_COL_FILES", type: "number", align: "right" },
	{ key: "notes", labelKey: "DATASET_COL_NOTES", type: "number", align: "right" },
	{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	{ key: "mtime", labelKey: "DATASET_COL_MTIME", type: "date", align: "right" },
];

export const folderAdapter: DatasetAdapter = (input): Dataset => {
	const { request, query, snapshot } = input;
	if (!query || !snapshot) return emptyDataset(request, COLUMNS);
	const folders = resolveQuery(snapshot, query, {
		customFilters: input.customFilters,
		now: input.now,
	}).folders ?? [];
	const rows = folders.map((folder) => ({
		id: folder.path,
		cells: {
			name: cell(folder.name, { path: folder.path }),
			path: cell(folder.path, { path: folder.path }),
			files: cell(String(folder.fileCount), { sortValue: folder.fileCount }),
			notes: cell(String(folder.noteCount), { sortValue: folder.noteCount }),
			size: cell(formatSize(folder.totalSize), {
				sortValue: folder.totalSize,
			}),
			mtime: cell(formatDate(folder.latestMtime), {
				sortValue: folder.latestMtime,
			}),
		},
	}));
	const truncated = truncateRows(rows, request.limit);
	return {
		object: request.object,
		measure: request.measure,
		columns: COLUMNS,
		...truncated,
		scalarText: String(folders.length),
	};
};
