import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";

export const unfinishedTasksComponent: ComponentDefinition = {
	type: "unfinished-tasks",
	labelKey: "COMPONENT_UNFINISHED_NAME",
	descriptionKey: "COMPONENT_UNFINISHED_DESC",
	category: "overview",
	objects: ["task"],
	views: ["list"],
	viewDefault: "list",
	measureDefault: "open",
	defaultQueryId: "builtin:tasks-unfinished",
	createConfig: (queryId) => ({
		queryId,
		basis: "section",
		measure: "open",
		view: "list",
		limit: 20,
		w: 6,
		h: 3,
	}),
	size: { maxH: 24 },
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{ key: "basis", kind: "basis", group: "data", fallback: "section" },
		{
			key: "limit",
			kind: "number",
			group: "data",
			min: 1,
			max: 100,
			step: 1,
			fallback: 20,
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config) => ({
		object: "task",
		measure: "open",
		queryId: config.queryId,
		basis: config.basis ?? "section",
		limit: config.limit ?? 20,
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: (result) => (result.items ?? []).length === 0,
	render: (el, ctx) => {
		el.addClass("ioto-unfinished");
		const rows = ctx.dataset?.rows ?? [];
		if (rows.length === 0) {
			el.createDiv({ cls: "ioto-empty-state", text: t("UNFINISHED_EMPTY") });
			return;
		}
		const list = el.createDiv({ cls: "ioto-unfinished-list" });
		for (const row of rows) {
			const textCell = row.cells.text;
			const noteCell = row.cells.note;
			const projectCell = row.cells.project;
			const path = textCell?.path ?? noteCell?.path;
			const rowEl = list.createDiv({ cls: "ioto-unfinished-row" });
			if (path) {
				rowEl.setAttr("role", "button");
				rowEl.setAttr("tabindex", "0");
				const open = () => ctx.openFile(path, textCell?.line);
				rowEl.onClickEvent(open);
				rowEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						open();
					}
				});
			}
			rowEl.createDiv({
				cls: "ioto-unfinished-text",
				text: textCell?.text ?? "",
			});
			rowEl.createDiv({
				cls: "ioto-unfinished-meta",
				text: [
					noteCell?.text ?? "",
					projectCell?.text ?? "",
				]
					.filter((value) => value.length > 0)
					.join(" · "),
			});
		}
	},
};
