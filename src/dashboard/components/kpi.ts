import { t } from "../../lang/helpers";
import { measureLabelKey, measuresForObject, resolveMeasure } from "../dataset/measures";
import { objectForQuery } from "../dataset/object";
import type { ComponentDefinition } from "../registry";

export const kpiComponent: ComponentDefinition = {
	type: "kpi",
	labelKey: "COMPONENT_KPI_NAME",
	descriptionKey: "COMPONENT_KPI_DESC",
	icon: "gauge",
	category: "overview",
	objects: ["task", "note", "file", "folder"],
	queryTargets: ["task", "note", "file", "folder"],
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
		{
			key: "basis",
			kind: "basis",
			group: "data",
			fallback: "file",
			when: (_config, context) => objectForQuery(context?.query) === "task",
		},
		{
			key: "measure",
			kind: "select",
			group: "data",
			labelKey: "SETTING_MEASURE",
			options: ({ query }) =>
				measuresForObject(objectForQuery(query)).map((value) => ({
					value,
					labelKey: measureLabelKey(value),
				})),
			fallback: "count",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => {
		const object = objectForQuery(query);
		return {
			object,
			measure: resolveMeasure(config.measure, object),
			queryId: config.queryId,
			...(object === "task" ? { basis: config.basis ?? "file" } : {}),
		};
	},
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
		const object = objectForQuery(ctx.query);
		const measure = resolveMeasure(ctx.config.measure, object);
		const parts = [queryName, t(measureLabelKey(measure))];
		if (object === "task") {
			const basisKey =
				(ctx.config.basis ?? "file") === "file"
					? "KPI_BASIS_FILE"
					: "KPI_BASIS_SECTION";
			parts.push(t(basisKey));
		}
		el.createDiv({
			cls: "ioto-kpi-meta",
			text: parts.join(" · "),
		});
	},
};
