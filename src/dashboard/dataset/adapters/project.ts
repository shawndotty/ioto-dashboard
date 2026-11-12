import {
	emptyDataset,
	formatPercent,
	truncateRows,
	type Dataset,
	type DatasetAdapter,
	type DatasetColumn,
} from "../types";
import type { TimelineSourceRef } from "../timeline";
import { cell } from "./shared";

export const PROJECT_COLUMNS: DatasetColumn[] = [
	{ key: "name", labelKey: "DATASET_COL_NAME", type: "text" },
	{ key: "folder", labelKey: "DATASET_COL_FOLDER", type: "path" },
	{ key: "files", labelKey: "DATASET_COL_FILES", type: "number", align: "right" },
	{
		key: "completed",
		labelKey: "DATASET_COL_COMPLETED",
		type: "number",
		align: "right",
	},
	{ key: "open", labelKey: "DATASET_COL_OPEN", type: "number", align: "right" },
	{ key: "ratio", labelKey: "DATASET_COL_RATIO", type: "percent", align: "right" },
];

export const projectAdapter: DatasetAdapter = (input): Dataset => {
	const { request } = input;
	const groups = input.metric?.groups ?? [];
	const rows = groups.map((group) => ({
		id: group.key || "__unclassified__",
		cells: {
			name: cell(group.name, { path: group.folder }),
			folder: cell(group.folder, { path: group.folder }),
			files: cell(String(group.fileCount), { sortValue: group.fileCount }),
			completed: cell(String(group.bucket.completed), {
				sortValue: group.bucket.completed,
			}),
			open: cell(String(group.bucket.open), { sortValue: group.bucket.open }),
			ratio: cell(formatPercent(group.bucket.ratio), {
				sortValue: group.bucket.ratio ?? 0,
			}),
		},
		// Upstream already caps `pending` (PENDING_LIST_LIMIT); keep the real
		// total so the modal can say "first 200 of N".
		related: (group.pending ?? []).map(
			(task): TimelineSourceRef => ({
				path: task.path,
				line: task.line,
				label: task.text,
				kind: "task",
				marker: task.marker,
			}),
		),
		relatedTotal: group.pendingTotal ?? group.pending?.length ?? 0,
	}));
	if (rows.length === 0 && !input.metric) {
		return emptyDataset(request, PROJECT_COLUMNS);
	}
	const truncated = truncateRows(rows, request.limit);
	return {
		object: request.object,
		measure: request.measure,
		columns: PROJECT_COLUMNS,
		...truncated,
		scalarText: String(groups.length),
	};
};
