import { ALL_SECTION_ROLES } from "../../../data/types";
import { resolveQuery } from "../../../query/resolve";
import {
	emptyDataset,
	formatPercent,
	truncateRows,
	type Dataset,
	type DatasetAdapter,
	type DatasetColumn,
} from "../types";
import { cell } from "./shared";

export const TASK_COLUMNS: DatasetColumn[] = [
	{ key: "text", labelKey: "DATASET_COL_TEXT", type: "text" },
	{ key: "note", labelKey: "DATASET_COL_NOTE", type: "text" },
	{ key: "project", labelKey: "DATASET_COL_PROJECT", type: "text" },
	{ key: "section", labelKey: "DATASET_COL_SECTION", type: "text" },
	{ key: "status", labelKey: "DATASET_COL_STATUS", type: "text" },
];

export const TASK_SERIES_COLUMNS: DatasetColumn[] = [
	{ key: "date", labelKey: "DATASET_COL_DATE", type: "date" },
	{ key: "total", labelKey: "DATASET_COL_TASKS", type: "number", align: "right" },
	{
		key: "completed",
		labelKey: "DATASET_COL_COMPLETED",
		type: "number",
		align: "right",
	},
	{ key: "open", labelKey: "DATASET_COL_OPEN", type: "number", align: "right" },
];

export const taskAdapter: DatasetAdapter = (input): Dataset => {
	const { request, query, snapshot, metric } = input;

	if (request.measure === "series") {
		const points = metric?.points ?? input.dailySeries(request.range ?? 30);
		const rows = points.map((point) => ({
			id: point.date,
			cells: {
				date: cell(point.date, { sortValue: point.date }),
				total: cell(String(point.total), { sortValue: point.total }),
				completed: cell(String(point.completed), {
					sortValue: point.completed,
				}),
				open: cell(String(point.open), { sortValue: point.open }),
			},
		}));
		const truncated = truncateRows(rows, request.limit);
		return {
			object: request.object,
			measure: request.measure,
			columns: TASK_SERIES_COLUMNS,
			...truncated,
		};
	}

	if (!query || !snapshot) return emptyDataset(request, TASK_COLUMNS);
	const resolved = resolveQuery(snapshot, query, {
		customFilters: input.customFilters,
		sections: request.basis === "file" ? ALL_SECTION_ROLES : undefined,
		now: input.now,
	});
	let tasks = resolved.tasks;
	if (request.measure === "completed") {
		tasks = tasks.filter((task) => task.marker === "done");
	} else if (request.measure === "open") {
		tasks = tasks.filter((task) => task.marker === "open");
	}
	const rows = tasks.map((task) => ({
		id: `${task.path}:${task.line}`,
		cells: {
			text: cell(task.text, {
				path: task.path,
				line: task.line,
			}),
			note: cell(task.noteBasename, { path: task.path }),
			project: cell(task.project ?? ""),
			section: cell(task.sectionRole),
			status: cell(task.marker, { sortValue: task.marker }),
		},
	}));
	const truncated = truncateRows(rows, request.limit);
	const ratio = metric?.bucket?.ratio;
	const scalar =
		request.measure === "ratio"
			? formatPercent(ratio)
			: request.measure === "completed" || request.measure === "open"
				? String(metric?.scalar ?? tasks.length)
				: String(tasks.length);
	return {
		object: request.object,
		measure: request.measure,
		columns: TASK_COLUMNS,
		...truncated,
		scalarText: scalar,
		ratio: ratio ?? null,
	};
};
