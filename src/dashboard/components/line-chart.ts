import { renderResponsiveChart } from "../dataset/charts/chart-host";
import { buildLineSpec } from "../dataset/charts/spec";
import { objectForQuery } from "../dataset/object";
import type { TimelineBucket, TimelineDateField } from "../dataset/types";
import type {
	ComponentDefinition,
	SettingContext,
	SettingOption,
} from "../registry";

function rangeOf(value: unknown): 7 | 30 | 90 | 180 {
	return value === 7 || value === 90 || value === 180 ? value : 30;
}

function bucketOf(value: unknown): TimelineBucket {
	return value === "week" || value === "month" ? value : "day";
}

function dateFieldOf(value: unknown): TimelineDateField {
	return value === "filename" || value === "created" || value === "modified"
		? value
		: "auto";
}

function objectOf(context?: SettingContext) {
	return objectForQuery(context?.query, "task");
}

const DAY_BUCKET: SettingOption = { value: "day", labelKey: "TIMELINE_BUCKET_DAY" };
const WEEK_BUCKET: SettingOption = {
	value: "week",
	labelKey: "TIMELINE_BUCKET_WEEK",
};
const MONTH_BUCKET: SettingOption = {
	value: "month",
	labelKey: "TIMELINE_BUCKET_MONTH",
};

/** Granularities that still produce a readable line for the chosen range. */
export function bucketOptionsForRange(range: unknown): SettingOption[] {
	const value = rangeOf(Number(range));
	if (value === 7) return [DAY_BUCKET];
	if (value === 30) return [DAY_BUCKET, WEEK_BUCKET];
	return [DAY_BUCKET, WEEK_BUCKET, MONTH_BUCKET];
}

/** Month buckets name their own formats; days/weeks keep the date formats. */
export function xLabelFormatOptionsForBucket(bucket: unknown): SettingOption[] {
	if (bucketOf(bucket) === "month") {
		return [
			{ value: "iso", labelKey: "AXIS_MONTH_ISO" },
			{ value: "short", labelKey: "AXIS_MONTH_SHORT" },
			{ value: "md", labelKey: "AXIS_MONTH_MD" },
		];
	}
	return [
		{ value: "iso", labelKey: "AXIS_DATE_ISO" },
		{ value: "md", labelKey: "AXIS_DATE_MD" },
		{ value: "short", labelKey: "AXIS_DATE_SHORT" },
	];
}

/** Sizes only ever format as KB/MB, never as raw counts. */
export function yFormatOptionsForField(field: unknown): SettingOption[] {
	if (field === "size") {
		return [{ value: "auto", labelKey: "AXIS_FORMAT_AUTO" }];
	}
	return [
		{ value: "auto", labelKey: "AXIS_FORMAT_AUTO" },
		{ value: "number", labelKey: "AXIS_FORMAT_NUMBER" },
		{ value: "compact", labelKey: "AXIS_FORMAT_COMPACT" },
	];
}

export const lineChartComponent: ComponentDefinition = {
	type: "line-chart",
	labelKey: "COMPONENT_LINE_NAME",
	descriptionKey: "COMPONENT_LINE_DESC",
	category: "analysis",
	objects: ["task", "note", "file"],
	queryTargets: ["task", "note", "file"],
	views: ["line"],
	viewDefault: "line",
	measureDefault: "timeline",
	defaultQueryId: "builtin:tasks-all",
	size: { minW: 4, minH: 3 },
	createConfig: (queryId) => ({
		queryId,
		view: "line",
		measure: "timeline",
		options: {
			range: "30",
			dateField: "auto",
			bucket: "day",
			xShowLabels: true,
			xLabelFormat: "md",
			xTitle: "",
			yField: "total",
			ySeriesCompleted: false,
			ySeriesOpen: false,
			yCumulative: false,
			yShowLabels: true,
			yShowGrid: false,
			yScale: "auto",
			yFormat: "auto",
			yTitle: "",
			showLegend: true,
		},
		w: 6,
		h: 3,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "dateField",
			kind: "select",
			group: "data",
			labelKey: "SETTING_TIMELINE_DATE_FIELD",
			options: [
				{ value: "auto", labelKey: "TIMELINE_DATE_AUTO" },
				{ value: "filename", labelKey: "TIMELINE_DATE_FILENAME" },
				{ value: "created", labelKey: "TIMELINE_DATE_CREATED" },
				{ value: "modified", labelKey: "TIMELINE_DATE_MODIFIED" },
			],
			fallback: "auto",
			target: "options",
			hintKey: "SETTING_TIMELINE_DATE_HINT",
		},
		{
			key: "bucket",
			kind: "select",
			group: "axesX",
			labelKey: "SETTING_TIMELINE_BUCKET",
			options: ({ config }) => bucketOptionsForRange(config?.options?.range),
			refreshOn: ["range"],
			fallback: "day",
			target: "options",
		},
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
			key: "xShowLabels",
			kind: "toggle",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_LABELS",
			fallback: true,
			target: "options",
		},
		{
			key: "xLabelFormat",
			kind: "select",
			group: "axesX",
			labelKey: "SETTING_AXIS_X_FORMAT",
			options: ({ config }) =>
				xLabelFormatOptionsForBucket(config?.options?.bucket),
			refreshOn: ["bucket"],
			fallback: "md",
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
			fallback: "total",
			target: "options",
		},
		{
			key: "ySeriesCompleted",
			kind: "toggle",
			group: "axesY",
			labelKey: "SETTING_AXIS_SERIES_COMPLETED",
			fallback: false,
			target: "options",
			when: (_config, ctx) => ["task", "note"].includes(objectOf(ctx)),
		},
		{
			key: "ySeriesOpen",
			kind: "toggle",
			group: "axesY",
			labelKey: "SETTING_AXIS_SERIES_OPEN",
			fallback: false,
			target: "options",
			when: (_config, ctx) => objectOf(ctx) === "task",
		},
		{
			key: "yCumulative",
			kind: "toggle",
			group: "axesY",
			labelKey: "SETTING_AXIS_CUMULATIVE",
			hintKey: "SETTING_AXIS_CUMULATIVE_HINT",
			fallback: false,
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
			key: "showLegend",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SHOW_LEGEND",
			fallback: true,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => {
		const object = objectForQuery(query, "task");
		const dateField = dateFieldOf(config.options?.dateField);
		return {
			object,
			measure: "timeline",
			queryId: config.queryId,
			range: rangeOf(Number(config.options?.range)),
			timeline: {
				bucket: bucketOf(config.options?.bucket),
				// Files have no meaningful "created" ordering; auto follows mtime.
				dateField:
					object === "file" && dateField === "auto" ? "modified" : dateField,
			},
		};
	},
	isEmptyDataset: (dataset) => (dataset.sourceTotal ?? dataset.total) === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		const dataset = ctx.dataset;
		if (!dataset) return;
		const object = objectForQuery(ctx.query, "task");
		renderResponsiveChart(el, (size) =>
			buildLineSpec(dataset, ctx.config.options ?? {}, size, object),
		);
	},
};
