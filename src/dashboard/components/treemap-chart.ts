import { renderResponsiveChart } from "../dataset/charts/chart-host";
import { yFormatOptionsForField } from "../dataset/charts/settings";
import {
	buildTreemapSpec,
	TREEMAP_ROW_CAP,
	type TreemapChartSpec,
	type TreemapTileSpec,
} from "../dataset/charts/treemap-spec";
import { firstCellPath } from "../dataset/cells";
import { columnsForObject } from "../dataset/columns";
import { columnMatchesAxis } from "../dataset/field-roles";
import { treemapObjectForQuery } from "../dataset/object";
import type {
	ComponentDefinition,
	ComponentSetting,
	SettingOption,
} from "../registry";

function groupFieldOptions(
	query: Parameters<typeof treemapObjectForQuery>[0],
	options: Record<string, unknown> | undefined,
): SettingOption[] {
	const object = treemapObjectForQuery(query, options);
	const columns = columnsForObject(object)
		.filter((column) => columnMatchesAxis(column, "category"))
		.map((column) => ({ value: column.key, labelKey: column.labelKey }));
	return [
		{ value: "auto", labelKey: "SETTING_TREEMAP_GROUP_AUTO" },
		{ value: "none", labelKey: "SETTING_TREEMAP_GROUP_NONE" },
		...columns,
	];
}

function treemapSettings(): ComponentSetting[] {
	return [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "noteGroupBy",
			kind: "select",
			group: "data",
			labelKey: "SETTING_TREEMAP_NOTE_GROUP",
			options: [
				{ value: "folder", labelKey: "SETTING_TREEMAP_NOTE_BY_FOLDER" },
				{ value: "project", labelKey: "SETTING_TREEMAP_NOTE_BY_PROJECT" },
			],
			fallback: "folder",
			target: "options",
			when: (_config, context) => context?.query?.target === "note",
		},
		{
			key: "xField",
			kind: "field",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_FIELD",
			role: "x",
			fallback: "name",
			target: "options",
			refreshOn: ["noteGroupBy"],
		},
		{
			key: "groupField",
			kind: "select",
			group: "axesX",
			labelKey: "SETTING_TREEMAP_GROUP_FIELD",
			options: ({ query, config }) => groupFieldOptions(query, config?.options),
			refreshOn: ["noteGroupBy"],
			fallback: "auto",
			target: "options",
		},
		{
			key: "topN",
			kind: "number",
			group: "axesX",
			labelKey: "SETTING_TREEMAP_TOP_N",
			min: 1,
			max: 200,
			step: 1,
			fallback: 30,
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
			refreshOn: ["noteGroupBy"],
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
			labelKey: "SETTING_TREEMAP_LABEL_MODE",
			options: [
				{ value: "name", labelKey: "SETTING_LABEL_NAME" },
				{ value: "value", labelKey: "SETTING_LABEL_VALUE" },
				{ value: "both", labelKey: "SETTING_LABEL_BOTH" },
				{ value: "none", labelKey: "SETTING_LABEL_NONE" },
			],
			fallback: "name",
			target: "options",
		},
		{
			key: "showLegend",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SHOW_LEGEND",
			fallback: false,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	];
}

function tileValue(
	tile: TreemapTileSpec,
	children: TreemapTileSpec[],
): number {
	if (children.length === 0) return tile.value;
	return children.reduce((sum, child) => sum + child.value, 0);
}

export const treemapChartComponent: ComponentDefinition = {
	type: "treemap-chart",
	labelKey: "COMPONENT_TREEMAP_NAME",
	descriptionKey: "COMPONENT_TREEMAP_DESC",
	icon: "layout-grid",
	category: "analysis",
	objects: ["task", "note", "file", "folder"],
	queryTargets: ["task", "note", "file", "folder"],
	views: ["treemap"],
	viewDefault: "treemap",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	size: { minW: 4, minH: 3 },
	createConfig: (queryId) => ({
		queryId,
		view: "treemap",
		measure: "count",
		options: {
			noteGroupBy: "folder",
			xField: "name",
			yField: "completed",
			yFormat: "auto",
			groupField: "auto",
			topN: 30,
			labelMode: "name",
			showLegend: false,
		},
		w: 6,
		h: 4,
	}),
	settings: treemapSettings(),
	toDatasetRequest: (config, query) => ({
		object: treemapObjectForQuery(query, config.options),
		measure: "count",
		queryId: config.queryId,
		limit: TREEMAP_ROW_CAP,
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		const dataset = ctx.dataset;
		if (!dataset) return;
		const object = treemapObjectForQuery(ctx.query, ctx.config.options);
		let lastSpec: TreemapChartSpec | null = null;
		renderResponsiveChart(
			el,
			(size) => {
				lastSpec = buildTreemapSpec(
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
					const spec = lastSpec;
					const tile = spec?.tiles.find(
						(entry) => entry.bucketKey === bucketKey,
					);
					if (!spec || !tile || tile.isOther) return;
					const children = spec.tiles.filter(
						(entry) => entry.parentKey === tile.bucketKey,
					);
					const refs = children.length
						? children.flatMap((entry) => entry.refs)
						: tile.refs;
					const relatedTotal = children.length
						? children.reduce((sum, entry) => sum + entry.relatedTotal, 0)
						: tile.relatedTotal;
					if (object === "project") {
						ctx.openChartBucket?.({
							bucketKey: tile.label,
							object: "project",
							cumulative: false,
							series: [
								{
									key: "y",
									label: spec.valueLabelKey,
									value: tileValue(tile, children),
								},
							],
							refs,
							relatedTotal,
							source: "project",
						});
						return;
					}
					if (object === "note" || object === "file") {
						ctx.openChartBucket?.({
							bucketKey: tile.label,
							object,
							cumulative: false,
							series: [
								{
									key: "y",
									label: spec.valueLabelKey,
									value: tileValue(tile, children),
								},
							],
							refs,
							relatedTotal,
						});
						return;
					}
					const row = dataset.rows.find(
						(entry) => entry.id === tile.rowIds[0],
					);
					const target = path ?? tile.targetPath ?? firstCellPath(row);
					if (!target) return;
					ctx.openLink?.(target, undefined, true);
				},
			},
			{ hasRows: dataset.rows.length > 0 },
		);
	},
};