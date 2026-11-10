import { t } from "../../lang/helpers";
import { objectForQuery } from "../dataset/object";
import type { ComponentDefinition } from "../registry";

export const kpiComponent: ComponentDefinition = {
	type: "kpi",
	labelKey: "COMPONENT_KPI_NAME",
	descriptionKey: "COMPONENT_KPI_DESC",
	category: "overview",
	objects: ["task", "note"],
	queryTargets: ["task", "note"],
	views: ["scalar"],
	viewDefault: "scalar",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	createConfig: (queryId) => ({
		queryId,
		basis: "file",
		measure: "count",
		view: "scalar",
		w: 3,
		h: 2,
	}),
	size: { maxH: 6 },
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{ key: "basis", kind: "basis", group: "data", fallback: "file" },
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
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => ({
		object: objectForQuery(query),
		measure: config.measure ?? "count",
		queryId: config.queryId,
		basis: config.basis ?? "file",
	}),
	isEmptyDataset: () => false,
	isEmpty: () => false,
	render: (el, ctx) => {
		el.addClass("ioto-kpi");
		el.createDiv({
			cls: "ioto-kpi-value",
			text: ctx.dataset?.scalarText ?? "—",
		});
		const queryName = ctx.query
			? ctx.query.nameKey
				? t(ctx.query.nameKey as Parameters<typeof t>[0])
				: ctx.query.name
			: "—";
		const basisKey =
			(ctx.config.basis ?? "file") === "file"
				? "KPI_BASIS_FILE"
				: "KPI_BASIS_SECTION";
		el.createDiv({
			cls: "ioto-kpi-meta",
			text: `${queryName} · ${t(basisKey)}`,
		});
	},
};
