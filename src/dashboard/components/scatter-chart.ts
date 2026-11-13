import { renderResponsiveChart } from "../dataset/charts/chart-host";
import {
	buildScatterSpec,
	type ScatterChartSpec,
} from "../dataset/charts/scatter-spec";
import { yFormatOptionsForField } from "../dataset/charts/settings";
import { firstCellPath } from "../dataset/cells";
import { scatterObjectForQuery } from "../dataset/object";
import type { ComponentDefinition } from "../registry";

export const scatterChartComponent: ComponentDefinition = {
	type: "scatter-chart",
	labelKey: "COMPONENT_SCATTER_NAME",
	descriptionKey: "COMPONENT_SCATTER_DESC",
	category: "analysis",
	objects: ["task", "note", "folder"],
	queryTargets: ["task", "note", "folder"],
	views: ["scatter"],
	viewDefault: "scatter",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	size: { minW: 4, minH: 3 },
	createConfig: (queryId) => ({
		queryId,
		view: "scatter",
		measure: "count",
		options: {
			xField: "completed",
			xShowLabels: true,
			xFormat: "auto",
			yField: "open",
			yShowLabels: true,
			yFormat: "auto",
			pointSize: 3.5,
			showPointLabels: false,
			limit: 500,
		},
		w: 6,
		h: 4,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "xField",
			kind: "field",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_FIELD",
			role: "x",
			axisType: "number",
			fallback: "completed",
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
			key: "xFormat",
			kind: "select",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_FORMAT",
			options: ({ config }) => yFormatOptionsForField(config?.options?.xField),
			refreshOn: ["xField"],
			fallback: "auto",
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
			key: "yField",
			kind: "field",
			group: "axesY",
			labelKey: "SETTING_AXIS_Y_FIELD",
			role: "y",
			axisType: "number",
			fallback: "open",
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
			key: "pointSize",
			kind: "number",
			group: "display",
			labelKey: "SETTING_SCATTER_POINT_SIZE",
			min: 2,
			max: 6,
			step: 0.5,
			fallback: 3.5,
			integer: false,
			target: "options",
		},
		{
			key: "showPointLabels",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SCATTER_POINT_LABELS",
			fallback: false,
			target: "options",
		},
		{
			key: "limit",
			kind: "number",
			group: "display",
			labelKey: "SETTING_SCATTER_LIMIT",
			hintKey: "SETTING_SCATTER_LIMIT_HINT",
			min: 50,
			max: 2000,
			step: 50,
			fallback: 500,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => ({
		object: scatterObjectForQuery(query),
		measure: "count",
		queryId: config.queryId,
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		const dataset = ctx.dataset;
		if (!dataset) return;
		const object = scatterObjectForQuery(ctx.query);
		let lastSpec: ScatterChartSpec | null = null;
		renderResponsiveChart(
			el,
			(size) => {
				lastSpec = buildScatterSpec(
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
				onActivate: ({ bucketKey, path }) => {
					const row = dataset.rows.find((entry) => entry.id === bucketKey);
					if (object === "project") {
						const point = lastSpec?.points.find(
							(entry) => entry.bucketKey === bucketKey,
						);
						const refs = row?.related ?? [];
						const relatedTotal = row?.relatedTotal ?? refs.length;
						ctx.openChartBucket?.({
							bucketKey,
							object: "project",
							cumulative: false,
							series: [
								{
									key: "x",
									label: lastSpec?.x.labelKey ?? "",
									value: point?.valueX ?? 0,
								},
								{
									key: "y",
									label: lastSpec?.y.labelKey ?? "",
									value: point?.valueY ?? 0,
								},
							],
							refs,
							relatedTotal,
							source: "project",
						});
						return;
					}
					const point = lastSpec?.points.find(
						(entry) => entry.bucketKey === bucketKey,
					);
					const target = path ?? point?.targetPath ?? firstCellPath(row);
					if (!target) return;
					ctx.openLink?.(target, undefined, object === "file");
				},
			},
		);
	},
};
