import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";

export const kpiComponent: ComponentDefinition = {
	type: "kpi",
	labelKey: "COMPONENT_KPI_NAME",
	descriptionKey: "COMPONENT_KPI_DESC",
	defaultQueryId: "builtin:tasks-all",
	createConfig: (queryId) => ({ queryId, basis: "file", w: 3, h: 2 }),
	size: { maxH: 6 },
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{ key: "basis", kind: "basis", group: "data", fallback: "file" },
		{ key: "title", kind: "text", group: "display" },
	],
	toMetricRequest: (config) => ({
		kind: "task-count",
		queryId: config.queryId,
		basis: config.basis ?? "file",
	}),
	isEmpty: () => false,
	render: (el, ctx) => {
		el.addClass("ioto-kpi");
		const value = ctx.result?.scalar;
		el.createDiv({
			cls: "ioto-kpi-value",
			text: value === undefined ? "—" : String(value),
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
