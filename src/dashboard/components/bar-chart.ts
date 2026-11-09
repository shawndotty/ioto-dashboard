import { renderBarChart } from "../dataset/charts/svg";
import type { ComponentDefinition } from "../registry";

export const barChartComponent: ComponentDefinition = {
	type: "bar-chart",
	labelKey: "COMPONENT_BAR_NAME",
	descriptionKey: "COMPONENT_BAR_DESC",
	category: "analysis",
	objects: ["project"],
	views: ["bar"],
	viewDefault: "bar",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	size: { minW: 4, minH: 3 },
	createConfig: (queryId) => ({
		queryId,
		view: "bar",
		measure: "count",
		options: { showLabels: true },
		w: 6,
		h: 3,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "showLabels",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SHOW_LABELS",
			fallback: true,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config) => ({
		object: "project",
		measure: "count",
		queryId: config.queryId,
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		if (!ctx.dataset) return;
		renderBarChart(
			el,
			ctx.dataset.rows.map((row) => ({
				label: row.cells.name?.text ?? "",
				value: Number(row.cells.completed?.sortValue ?? 0),
			})),
		);
	},
};
