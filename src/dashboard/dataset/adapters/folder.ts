import { resolveQuery } from "../../../query/resolve";
import type { FolderRecord } from "../../../data/types";
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
import { cell, summaryItem } from "./shared";

export const FOLDER_COLUMNS: DatasetColumn[] = [
	{ key: "name", labelKey: "DATASET_COL_NAME", type: "text" },
	{ key: "path", labelKey: "DATASET_COL_PATH", type: "path" },
	{ key: "files", labelKey: "DATASET_COL_FILES", type: "number", align: "right" },
	{ key: "notes", labelKey: "DATASET_COL_NOTES", type: "number", align: "right" },
	{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	{ key: "mtime", labelKey: "DATASET_COL_MTIME", type: "date", align: "right" },
];

function scalarTextFor(folders: FolderRecord[], measure: MeasureId): string {
	if (folders.length === 0) return measure === "mtime" ? "—" : "0";
	if (measure === "mtime") {
		const latest = folders.reduce(
			(max, folder) =>
				folder.latestMtime > max ? folder.latestMtime : max,
			folders[0]?.latestMtime ?? 0,
		);
		return formatDate(latest);
	}
	return String(folders.length);
}

export const folderAdapter: DatasetAdapter = (input): Dataset => {
	const { request, query, snapshot } = input;
	if (!query || !snapshot) return emptyDataset(request, FOLDER_COLUMNS);
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
	const totalFiles = folders.reduce((sum, folder) => sum + folder.fileCount, 0);
	const latestMtime = folders.reduce(
		(max, folder) => (folder.latestMtime > max ? folder.latestMtime : max),
		0,
	);
	return {
		object: request.object,
		measure: request.measure,
		columns: FOLDER_COLUMNS,
		...truncated,
		scalarText: scalarTextFor(folders, request.measure),
		summary: {
			items: [
				summaryItem(
					"DATASET_SUMMARY_FOLDERS_TOTAL",
					String(folders.length),
					"count",
				),
				summaryItem("DATASET_SUMMARY_FILES_TOTAL", String(totalFiles)),
				summaryItem(
					"DATASET_SUMMARY_LATEST_MTIME",
					formatDate(latestMtime),
					"mtime",
				),
			],
		},
	};
};
