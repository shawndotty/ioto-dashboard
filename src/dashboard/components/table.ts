import { renderTable } from "../dataset/views/table";
import type { ComponentDefinition } from "../registry";
import { objectForQuery } from "../dataset/object";

export const tableComponent: ComponentDefinition = {
	type: "table",
	labelKey: "COMPONENT_TABLE_NAME",
	descriptionKey: "COMPONENT_TABLE_DESC",
	category: "analysis",
	objects: ["task", "note", "file", "folder"],
	queryTargets: ["task", "note", "file", "folder"],
	views: ["table"],
	viewDefault: "table",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	createConfig: (queryId) => ({
		queryId,
		view: "table",
		measure: "count",
		options: { showRowNumber: false },
		limit: 100,
		w: 6,
		h: 4,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "measure",
			kind: "select",
			group: "data",
			labelKey: "SETTING_MEASURE",
			options: [
				{ value: "count", labelKey: "DATASET_MEASURE_COUNT" },
				{ value: "completed", labelKey: "DATASET_MEASURE_COMPLETED" },
				{ value: "open", labelKey: "DATASET_MEASURE_OPEN" },
				{ value: "ratio", labelKey: "DATASET_MEASURE_RATIO" },
			],
			fallback: "count",
		},
		{
			key: "limit",
			kind: "number",
			group: "data",
			min: 1,
			max: 100,
			step: 1,
			fallback: 100,
		},
		{
			key: "showRowNumber",
			kind: "toggle",
			group: "display",
			labelKey: "DASHBOARD_TABLE_ROW_NUMBER",
			fallback: false,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => ({
		object: objectForQuery(query),
		measure: config.measure ?? "count",
		queryId: config.queryId,
		limit: config.limit ?? 100,
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		if (!ctx.dataset) return;
		renderTable(el, ctx.dataset, (path, line) => ctx.openFile(path, line), {
			showRowNumber: ctx.config.options?.showRowNumber === true,
		});
	},
};
