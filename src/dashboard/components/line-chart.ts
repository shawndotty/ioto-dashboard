import { renderLineChart } from "../dataset/charts/svg";
import type { ComponentDefinition } from "../registry";

function rangeOf(value: unknown): 7 | 30 | 90 | 180 {
	return value === 7 || value === 90 || value === 180 ? value : 30;
}

export const lineChartComponent: ComponentDefinition = {
	type: "line-chart",
	labelKey: "COMPONENT_LINE_NAME",
	descriptionKey: "COMPONENT_LINE_DESC",
	category: "analysis",
	objects: ["task"],
	views: ["line"],
	viewDefault: "line",
	measureDefault: "series",
	defaultQueryId: "builtin:tasks-all",
	size: { minW: 4, minH: 3 },
	createConfig: (queryId) => ({
		queryId,
		view: "line",
		measure: "series",
		options: { range: "30", showLegend: true },
		w: 6,
		h: 3,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "range",
			kind: "select",
			group: "data",
			labelKey: "SETTING_RANGE",
			options: [
				{ value: "7", labelKey: "SETTING_RANGE_7" },
				{ value: "30", labelKey: "SETTING_RANGE_30" },
				{ value: "90", labelKey: "SETTING_RANGE_90" },
				{ value: "180", labelKey: "SETTING_RANGE_180" },
			],
			fallback: "30",
			target: "options",
		},
		{
			key: "showLegend",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SHOW_LEGEND",
			fallback: true,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config) => ({
		object: "task",
		measure: "series",
		queryId: config.queryId,
		range: rangeOf(Number(config.options?.range)),
	}),
	isEmptyDataset: (dataset) => dataset.rows.length === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		if (!ctx.dataset) return;
		renderLineChart(
			el,
			ctx.dataset.rows.map((row) => ({
				label: row.cells.date?.text ?? "",
				value: Number(row.cells.total?.sortValue ?? 0),
			})),
		);
	},
};
