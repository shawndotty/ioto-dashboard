import { t } from "../../lang/helpers";
import type { MetricBucket } from "../../metrics/types";
import type { ComponentDefinition } from "../registry";

function ratioText(bucket: MetricBucket): string {
	return bucket.ratio === null
		? "—"
		: `${Math.round(bucket.ratio * 100)}%`;
}

export const projectProgressComponent: ComponentDefinition = {
	type: "project-progress",
	labelKey: "COMPONENT_PROJECT_PROGRESS_NAME",
	descriptionKey: "COMPONENT_PROJECT_PROGRESS_DESC",
	category: "overview",
	objects: ["project"],
	queryTargets: ["task", "note"],
	views: ["progress"],
	viewDefault: "progress",
	measureDefault: "ratio",
	defaultQueryId: "builtin:tasks-all",
	createConfig: (queryId) => ({
		queryId,
		basis: "section",
		view: "progress",
		w: 6,
		h: 3,
	}),
	size: { maxH: 8 },
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{ key: "basis", kind: "basis", group: "data", fallback: "section" },
		{ key: "title", kind: "text", group: "display" },
	],
	toMetricRequest: (config) => ({
		kind: "project-progress",
		queryId: config.queryId,
		basis: config.basis ?? "section",
	}),
	isEmpty: (result) => (result.groups ?? []).length === 0,
	render: (el, ctx) => {
		el.addClass("ioto-project-progress");
		const groups = ctx.result?.groups ?? [];
		if (groups.length === 0) {
			el.createDiv({ cls: "ioto-empty-state", text: t("PROJECT_PROGRESS_EMPTY") });
			return;
		}
		const list = el.createDiv({ cls: "ioto-progress-list" });
		for (const group of groups) {
			const row = list.createDiv({ cls: "ioto-progress-row" });
			row.setAttr("role", "button");
			row.setAttr("tabindex", "0");
			row.onClickEvent(() => ctx.openProject(group));
			row.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					ctx.openProject(group);
				}
			});

			const head = row.createDiv({ cls: "ioto-progress-head" });
			head.createSpan({
				cls: "ioto-progress-name",
				text: group.nameKey
					? t(group.nameKey as Parameters<typeof t>[0])
					: group.name,
			});
			head.createSpan({
				cls: "ioto-progress-ratio",
				text: ratioText(group.bucket),
			});

			const bar = row.createDiv({ cls: "ioto-progress-bar" });
			const fill = bar.createDiv({ cls: "ioto-progress-fill" });
			fill.style.width = `${Math.round((group.bucket.ratio ?? 0) * 100)}%`;

			row.createDiv({
				cls: "ioto-progress-meta",
				text: [
					`${group.bucket.completed}/${group.bucket.total}`,
					`${t("PROJECT_PROGRESS_OPEN")} ${group.bucket.open}`,
					`${t("PROJECT_PROGRESS_CANCELLED")} ${group.bucket.cancelled}`,
					`${t("PROJECT_PROGRESS_FILES")} ${group.fileCount}`,
				].join(" · "),
			});
		}
	},
};
