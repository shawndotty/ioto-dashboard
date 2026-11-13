import { t } from "../../lang/helpers";
import type {
	MetricBucket,
	MetricResult,
	ProjectProgressGroup,
} from "../../metrics/types";
import { BUILTIN_TASKS_ALL } from "../../query/builtins";
import type { ComponentDefinition } from "../registry";
import type { DashboardComponentConfig } from "../types";

export function percentText(ratio: number | null): string {
	if (ratio === null) return "—";
	if (ratio >= 1) return "100%";
	const pct = Math.floor(ratio * 1000) / 10;
	return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export function displayRatio(
	bucket: MetricBucket,
	ratioBase: string | undefined,
): number | null {
	if (ratioBase !== "excludeCancelled") return bucket.ratio;
	const denominator = bucket.total - bucket.cancelled;
	return denominator <= 0 ? null : bucket.completed / denominator;
}

export function visibleGroups(
	result: MetricResult | undefined,
	config?: DashboardComponentConfig,
): ProjectProgressGroup[] {
	const showEmpty = config?.options?.showEmptyProjects === true;
	const showUnclassified = config?.options?.showUnclassified !== false;
	return (result?.groups ?? []).filter((group) => {
		if (group.key === "") return showUnclassified;
		return showEmpty || group.bucket.total > 0;
	});
}

export function arrangeGroups(
	result: MetricResult | undefined,
	config: DashboardComponentConfig,
): ProjectProgressGroup[] {
	const groups = visibleGroups(result, config);
	const sort = String(config.options?.sort ?? "name");
	const ratioBase = String(config.options?.ratioBase ?? "all");
	const sorted = [...groups];
	if (sort === "ratio") {
		sorted.sort(
			(a, b) =>
				(displayRatio(b.bucket, ratioBase) ?? -1) -
					(displayRatio(a.bucket, ratioBase) ?? -1) ||
				a.name.localeCompare(b.name),
		);
	} else if (sort === "open") {
		sorted.sort(
			(a, b) => b.bucket.open - a.bucket.open || a.name.localeCompare(b.name),
		);
	} else {
		sorted.sort((a, b) => a.name.localeCompare(b.name));
	}
	const limit = config.limit ?? 0;
	return limit > 0 ? sorted.slice(0, limit) : sorted;
}

export const projectProgressComponent: ComponentDefinition = {
	type: "project-progress",
	labelKey: "COMPONENT_PROJECT_PROGRESS_NAME",
	descriptionKey: "COMPONENT_PROJECT_PROGRESS_DESC",
	icon: "target",
	category: "overview",
	objects: ["task"],
	queryTargets: ["task"],
	views: ["progress"],
	viewDefault: "progress",
	measureDefault: "ratio",
	defaultQueryId: BUILTIN_TASKS_ALL,
	createConfig: (queryId) => ({
		queryId,
		basis: "file",
		view: "progress",
		limit: 0,
		options: {
			ratioBase: "all",
			sort: "name",
			showEmptyProjects: false,
			showUnclassified: true,
		},
		w: 6,
		h: 3,
	}),
	settings: [
		{
			key: "queryId",
			kind: "query",
			group: "data",
			hintKey: "PROJECT_PROGRESS_QUERY_HINT",
		},
		{
			key: "basis",
			kind: "basis",
			group: "data",
			fallback: "file",
			hintKey: "PROJECT_PROGRESS_BASIS_HINT",
		},
		{
			key: "ratioBase",
			kind: "select",
			group: "data",
			labelKey: "PROJECT_PROGRESS_BASE_LABEL",
			options: [
				{ value: "all", labelKey: "PROJECT_PROGRESS_BASE_ALL" },
				{
					value: "excludeCancelled",
					labelKey: "PROJECT_PROGRESS_BASE_EXCLUDE_CANCELLED",
				},
			],
			fallback: "all",
			target: "options",
			hintKey: "PROJECT_PROGRESS_BASE_HINT",
		},
		{ key: "title", kind: "text", group: "display" },
		{
			key: "showEmptyProjects",
			kind: "toggle",
			group: "display",
			labelKey: "PROJECT_PROGRESS_SHOW_EMPTY",
			fallback: false,
			target: "options",
		},
		{
			key: "showUnclassified",
			kind: "toggle",
			group: "display",
			labelKey: "PROJECT_PROGRESS_SHOW_UNCLASSIFIED",
			fallback: true,
			target: "options",
		},
		{
			key: "sort",
			kind: "select",
			group: "display",
			labelKey: "PROJECT_PROGRESS_SORT_LABEL",
			options: [
				{ value: "name", labelKey: "PROJECT_PROGRESS_SORT_NAME" },
				{ value: "ratio", labelKey: "PROJECT_PROGRESS_SORT_RATIO" },
				{ value: "open", labelKey: "PROJECT_PROGRESS_SORT_OPEN" },
			],
			fallback: "name",
			target: "options",
		},
		{
			key: "limit",
			kind: "number",
			group: "display",
			labelKey: "PROJECT_PROGRESS_LIMIT",
			min: 0,
			max: 200,
			step: 1,
			fallback: 0,
			hintKey: "PROJECT_PROGRESS_LIMIT_HINT",
		},
	],
	toMetricRequest: (config, query) => ({
		kind: "project-progress",
		queryId:
			query && query.target !== "task" ? BUILTIN_TASKS_ALL : config.queryId,
		basis: config.basis ?? "file",
	}),
	isEmpty: (result, config) => visibleGroups(result, config).length === 0,
	render: (el, ctx) => {
		el.addClass("ioto-project-progress");
		const groups = arrangeGroups(ctx.result, ctx.config);
		if (groups.length === 0) {
			el.createDiv({ cls: "ioto-empty-state", text: t("PROJECT_PROGRESS_EMPTY") });
			return;
		}
		const ratioBase = String(ctx.config.options?.ratioBase ?? "all");
		const list = el.createDiv({ cls: "ioto-progress-list" });
		for (const group of groups) {
			const row = list.createDiv({ cls: "ioto-progress-row" });
			const name = group.nameKey
				? t(group.nameKey as Parameters<typeof t>[0])
				: group.name;
			row.setAttr("role", "button");
			row.setAttr("tabindex", "0");
			row.setAttr("aria-label", t("PROJECT_PROGRESS_ROW_HINT", [name]));
			row.onClickEvent(() => ctx.openProjectTasks(group, ratioBase));
			row.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					ctx.openProjectTasks(group, ratioBase);
				}
			});

			const head = row.createDiv({ cls: "ioto-progress-head" });
			head.createSpan({ cls: "ioto-progress-name", text: name });
			const ratio = displayRatio(group.bucket, ratioBase);
			const percent = ratio === null ? 0 : Math.floor(ratio * 1000) / 10;
			head.createSpan({
				cls: "ioto-progress-ratio",
				text: percentText(ratio),
			});

			const bar = row.createDiv({ cls: "ioto-progress-bar" });
			bar.setAttr("role", "progressbar");
			bar.setAttr("aria-valuemin", "0");
			bar.setAttr("aria-valuemax", "100");
			bar.setAttr("aria-valuenow", String(percent));
			bar.setAttr(
				"aria-label",
				`${name} ${t("PROJECT_PROGRESS_BAR_LABEL")}`,
			);
			if (percent > 0) {
				const fill = bar.createDiv({ cls: "ioto-progress-fill" });
				fill.style.width = `${percent}%`;
			}
			if (ratioBase === "all" && group.bucket.cancelled > 0) {
				const cancelled = bar.createDiv({
					cls: "ioto-progress-fill is-cancelled",
				});
				cancelled.style.width = `${
					(group.bucket.cancelled / group.bucket.total) * 100
				}%`;
			}

			const parts = [
				`${group.bucket.completed}/${group.bucket.total}`,
				`${t("PROJECT_PROGRESS_OPEN")} ${group.bucket.open}`,
				`${t("PROJECT_PROGRESS_CANCELLED")} ${group.bucket.cancelled}`,
			];
			if (group.bucket.other > 0) {
				parts.push(`${t("PROJECT_PROGRESS_OTHER")} ${group.bucket.other}`);
			}
			row.createDiv({ cls: "ioto-progress-meta", text: parts.join(" · ") });
		}
	},
};
