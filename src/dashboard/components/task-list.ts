import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";

const TASK_STATUS_MARKERS: Record<string, string> = {
	open: " ",
	done: "x",
	cancelled: "-",
	"in-progress": "/",
	forwarded: ">",
};

const MAX_MARKDOWN_ROWS = 50;

function markerOf(status: string | undefined): string {
	return TASK_STATUS_MARKERS[status ?? "open"] ?? " ";
}

export const taskListComponent: ComponentDefinition = {
	type: "task-list",
	labelKey: "COMPONENT_TASK_LIST_NAME",
	descriptionKey: "COMPONENT_TASK_LIST_DESC",
	category: "overview",
	objects: ["task"],
	queryTargets: ["task"],
	views: ["list"],
	viewDefault: "list",
	measureDefault: "count",
	defaultQueryId: "builtin:tasks-all",
	createConfig: (queryId) => ({
		queryId,
		basis: "section",
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
		measure: config.measure ?? "count",
		queryId: config.queryId,
		basis: config.basis ?? "section",
		limit: config.limit ?? 20,
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: (result) => (result.items ?? []).length === 0,
	render: (el, ctx) => {
		el.addClass("ioto-task-list");
		const rows = ctx.dataset?.rows ?? [];
		if (rows.length === 0) {
			el.createDiv({ cls: "ioto-empty-state", text: t("TASK_LIST_EMPTY") });
			return;
		}
		const renderInline = ctx.renderInlineMarkdown?.bind(ctx);
		const useMarkdown = Boolean(renderInline) && rows.length <= MAX_MARKDOWN_ROWS;
		const list = el.createEl("ul", { cls: "contains-task-list ioto-task-list-items" });
		for (const row of rows) {
			const textCell = row.cells.text;
			const noteCell = row.cells.note;
			const projectCell = row.cells.project;
			const statusCell = row.cells.status;
			const path = textCell?.path ?? noteCell?.path;
			const marker = markerOf(statusCell?.text);
			const itemEl = list.createEl("li", {
				cls: "task-list-item ioto-task-list-item",
			});
			itemEl.setAttr("data-task", marker);
			const checkbox = itemEl.createEl("input", {
				cls: "task-list-item-checkbox",
				type: "checkbox",
			});
			checkbox.checked = marker === "x";
			checkbox.disabled = true;
			const content = itemEl.createDiv({ cls: "ioto-task-list-content" });
			const textEl = content.createDiv({ cls: "ioto-task-list-text" });
			const text = textCell?.text ?? "";
			if (useMarkdown && path && renderInline) {
				void renderInline(textEl, text, path);
			} else {
				textEl.setText(text);
			}
			const metaEl = content.createDiv({ cls: "ioto-task-list-meta" });
			const noteName = noteCell?.text ?? "";
			const notePath = noteCell?.path ?? path;
			if (noteName.length > 0 && notePath) {
				const link = metaEl.createEl("a", {
					cls: "internal-link",
					text: noteName,
					href: notePath,
				});
				link.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					ctx.openFile(notePath);
				});
			}
			const project = projectCell?.text ?? "";
			if (project.length > 0) {
				if (metaEl.childElementCount > 0) metaEl.appendText(" · ");
				metaEl.createEl("span", { cls: "ioto-task-list-project", text: project });
			}
			if (!path) continue;
			itemEl.setAttr("tabindex", "0");
			const open = () => ctx.openFile(path, textCell?.line);
			itemEl.onClickEvent((event) => {
				if (event.target instanceof HTMLElement && event.target.closest("a.internal-link")) {
					return;
				}
				open();
			});
			itemEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					open();
				}
			});
		}
		if (ctx.dataset?.truncated) {
			el.createDiv({
				cls: "ioto-task-list-footer",
				text: t("DASHBOARD_TRUNCATED", [
					String(rows.length),
					String(ctx.dataset.total),
				]),
			});
		}
	},
};
