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
	{ key: "folder", labelKey: "DATASET_COL_FOLDER", type: "path" },
	{ key: "extension", labelKey: "DATASET_COL_EXTENSION", type: "text" },
	{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	{ key: "mtime", labelKey: "DATASET_COL_MTIME", type: "date", align: "right" },
];

export const fileAdapter: DatasetAdapter = (input): Dataset => {
	const { request, query, snapshot } = input;
	if (!query || !snapshot) return emptyDataset(request, COLUMNS);
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
		columns: COLUMNS,
		...truncated,
		scalarText: String(files.length),
	};
};
