import { renderResponsiveChart } from "../dataset/charts/chart-host";
import { buildPieSpec, type PieChartSpec } from "../dataset/charts/pie-spec";
import { yFormatOptionsForField } from "../dataset/charts/settings";
import { firstCellPath } from "../dataset/cells";
import { barObjectForQuery } from "../dataset/object";
import type { ComponentDefinition, ComponentSetting } from "../registry";

interface PieFactoryOptions {
	type: "pie-chart" | "donut-chart";
	donut: boolean;
}

function pieSettings(): ComponentSetting[] {
	return [
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
			key: "topN",
			kind: "number",
			group: "axesX",
			labelKey: "SETTING_PIE_TOP_N",
			min: 1,
			max: 50,
			step: 1,
			fallback: 8,
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
			key: "labelMode",
			kind: "select",
			group: "display",
			labelKey: "SETTING_PIE_LABEL_MODE",
			options: [
				{ value: "percent", labelKey: "SETTING_LABEL_PERCENT" },
				{ value: "value", labelKey: "SETTING_LABEL_VALUE" },
				{ value: "both", labelKey: "SETTING_LABEL_BOTH" },
				{ value: "none", labelKey: "SETTING_LABEL_NONE" },
			],
			fallback: "percent",
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
		{
			key: "showLabels",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SHOW_DATA_LIST",
			fallback: false,
			target: "options",
		},
		{
			key: "innerRadius",
			kind: "number",
			group: "display",
			labelKey: "SETTING_DONUT_INNER_RADIUS",
			hintKey: "SETTING_DONUT_INNER_RADIUS_HINT",
			min: 0.35,
			max: 0.8,
			step: 0.05,
			fallback: 0.6,
			integer: false,
			target: "options",
			when: (config) => config.type === "donut-chart",
		},
		{ key: "title", kind: "text", group: "display" },
	];
}

function createPieComponent({ type, donut }: PieFactoryOptions): ComponentDefinition {
	const view = donut ? "donut" : "pie";
	return {
		type,
		labelKey: donut ? "COMPONENT_DONUT_NAME" : "COMPONENT_PIE_NAME",
		descriptionKey: donut ? "COMPONENT_DONUT_DESC" : "COMPONENT_PIE_DESC",
		category: "analysis",
		objects: ["task", "note", "file", "folder"],
		queryTargets: ["task", "note", "file", "folder"],
		views: [view],
		viewDefault: view,
		measureDefault: "count",
		defaultQueryId: "builtin:tasks-all",
		size: { minW: 3, minH: 3 },
		createConfig: (queryId) => ({
			queryId,
			view,
			measure: "count",
			options: {
				xField: "name",
				yField: "completed",
				yFormat: "auto",
				topN: 8,
				labelMode: "percent",
				showLegend: true,
				showLabels: false,
				innerRadius: 0.6,
			},
			w: 4,
			h: 4,
		}),
		settings: pieSettings(),
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
			let lastSpec: PieChartSpec | null = null;
			renderResponsiveChart(
				el,
				(size) => {
					lastSpec = buildPieSpec(
						dataset,
						ctx.config.options ?? {},
						size,
						object,
						donut ? "donut" : "pie",
					);
					return lastSpec;
				},
				80,
				{
					isEnabled: () => !ctx.editMode,
					onActivate: ({ bucketKey, path }) => {
						const row = dataset.rows.find((entry) => entry.id === bucketKey);
						if (object === "project") {
							const refs = row?.related ?? [];
							const relatedTotal = row?.relatedTotal ?? refs.length;
							const slice = lastSpec?.slices.find(
								(entry) => entry.bucketKey === bucketKey,
							);
							ctx.openChartBucket?.({
								bucketKey,
								object: "project",
								cumulative: false,
								series: [
									{
										key: "y",
										label: lastSpec?.valueLabelKey ?? "",
										value: slice?.value ?? 0,
									},
								],
								refs,
								relatedTotal,
								source: "project",
							});
							return;
						}
						const target = path ?? sliceTarget(lastSpec, bucketKey) ?? firstCellPath(row);
						if (!target) return;
						ctx.openLink?.(target, undefined, object === "file");
					},
				},
			);
		},
	};
}

function sliceTarget(
	spec: PieChartSpec | null,
	bucketKey: string,
): string | undefined {
	return spec?.slices.find((slice) => slice.bucketKey === bucketKey)
		?.targetPath;
}

export const pieChartComponent = createPieComponent({
	type: "pie-chart",
	donut: false,
});

export const donutChartComponent = createPieComponent({
	type: "donut-chart",
	donut: true,
});
