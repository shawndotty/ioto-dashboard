import { renderResponsiveChart } from "../dataset/charts/chart-host";
import { buildBarSpec, type ChartSpec } from "../dataset/charts/spec";
import { yFormatOptionsForField } from "../dataset/charts/settings";
import { barObjectForQuery } from "../dataset/object";
import type { DatasetRow } from "../dataset/types";
import type { ComponentDefinition } from "../registry";

function firstCellPath(row: DatasetRow | undefined): string | undefined {
	if (!row) return undefined;
	for (const cell of Object.values(row.cells)) {
		if (cell.path) return cell.path;
	}
	return undefined;
}

export const barChartComponent: ComponentDefinition = {
	type: "bar-chart",
	labelKey: "COMPONENT_BAR_NAME",
	descriptionKey: "COMPONENT_BAR_DESC",
	category: "analysis",
	objects: ["task", "note", "file", "folder"],
	queryTargets: ["task", "note", "file", "folder"],
	views: ["bar"],
	viewDefault: "bar",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	size: { minW: 4, minH: 3 },
	createConfig: (queryId) => ({
		queryId,
		view: "bar",
		measure: "count",
		options: {
			xField: "name",
			xShowLabels: true,
			xRotate: "0",
			xSort: "dataset",
			xTitle: "",
			topN: 0,
			yField: "completed",
			yShowLabels: true,
			yShowGrid: false,
			yScale: "auto",
			yFormat: "auto",
			yTitle: "",
			showLabels: false,
			showValueLabels: false,
		},
		w: 6,
		h: 3,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "xField",
			kind: "field",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_FIELD",
			role: "x",
			fallback: "name",
			target: "options",
		},
		{
			key: "xShowLabels",
			kind: "toggle",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_LABELS",
			fallback: true,
			target: "options",
		},
		{
			key: "xRotate",
			kind: "select",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_ROTATE",
			options: [
				{ value: "0", labelKey: "AXIS_ROTATE_0" },
				{ value: "45", labelKey: "AXIS_ROTATE_45" },
				{ value: "90", labelKey: "AXIS_ROTATE_90" },
			],
			fallback: "0",
			target: "options",
		},
		{
			key: "xSort",
			kind: "select",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_SORT",
			options: [
				{ value: "dataset", labelKey: "AXIS_SORT_DATASET" },
				{ value: "value-desc", labelKey: "AXIS_SORT_VALUE_DESC" },
				{ value: "value-asc", labelKey: "AXIS_SORT_VALUE_ASC" },
				{ value: "label", labelKey: "AXIS_SORT_LABEL" },
			],
			fallback: "dataset",
			target: "options",
		},
		{
			key: "xTitle",
			kind: "text",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_TITLE",
			target: "options",
		},
		{
			key: "topN",
			kind: "number",
			group: "axesX",
			labelKey: "SETTING_AXIS_TOP_N",
			min: 0,
			max: 200,
			step: 1,
			fallback: 0,
			target: "options",
		},
		{
			key: "yField",
			kind: "field",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_FIELD",
			role: "y",
			fallback: "completed",
			target: "options",
		},
		{
			key: "yShowLabels",
			kind: "toggle",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_LABELS",
			fallback: true,
			target: "options",
		},
		{
			key: "yShowGrid",
			kind: "toggle",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_GRID",
			fallback: false,
			target: "options",
		},
		{
			key: "yScale",
			kind: "select",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_SCALE",
			hintKey: "SETTING_AXIS_Y_SCALE_HINT",
			options: [
				{ value: "auto", labelKey: "AXIS_SCALE_AUTO" },
				{ value: "manual", labelKey: "AXIS_SCALE_MANUAL" },
			],
			fallback: "auto",
			target: "options",
		},
		{
			key: "yMin",
			kind: "number",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_MIN",
			min: -1000000,
			max: 1000000,
			step: 1,
			fallback: 0,
			integer: false,
			target: "options",
			when: (config) => config.options?.yScale === "manual",
		},
		{
			key: "yMax",
			kind: "number",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_MAX",
			min: -1000000,
			max: 1000000,
			step: 1,
			fallback: 0,
			integer: false,
			target: "options",
			when: (config) => config.options?.yScale === "manual",
		},
		{
			key: "yFormat",
			kind: "select",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_FORMAT",
			options: ({ config }) => yFormatOptionsForField(config?.options?.yField),
			refreshOn: ["yField"],
			fallback: "auto",
			target: "options",
		},
		{
			key: "yTitle",
			kind: "text",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_TITLE",
			target: "options",
		},
		{
			key: "showLabels",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SHOW_DATA_LIST",
			fallback: false,
			target: "options",
		},
		{
			key: "showValueLabels",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_AXIS_SHOW_VALUES",
			fallback: false,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => ({
		object: barObjectForQuery(query),
		measure: "count",
		queryId: config.queryId,
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		const dataset = ctx.dataset;
		if (!dataset) return;
		const object = barObjectForQuery(ctx.query);
		let lastSpec: ChartSpec | null = null;
		renderResponsiveChart(
			el,
			(size) => {
				lastSpec = buildBarSpec(
					dataset,
					ctx.config.options ?? {},
					size,
					object,
				);
				return lastSpec;
			},
			80,
			{
				isEnabled: () => !ctx.editMode,
				onActivate: ({ bucketKey }) => {
					const row = dataset.rows.find((entry) => entry.id === bucketKey);
					const bar = lastSpec?.series[0]?.bars?.find(
						(entry) => entry.bucketKey === bucketKey,
					);
					if (object === "project") {
						const refs = row?.related ?? [];
						const relatedTotal = row?.relatedTotal ?? refs.length;
						const series = (lastSpec?.series ?? []).map((entry) => ({
							key: entry.key,
							label: entry.label,
							value:
								entry.bars?.find((item) => item.bucketKey === bucketKey)
									?.value ?? 0,
						}));
						// An empty project still opens: silence would read as a bug.
						ctx.openChartBucket?.({
							bucketKey,
							object: "project",
							cumulative: false,
							series,
							refs,
							relatedTotal,
							source: "project",
						});
						return;
					}
					const path = bar?.ref?.path ?? firstCellPath(row);
					if (!path) return;
					ctx.openLink?.(path, undefined, object === "file");
				},
			},
		);
	},
};
