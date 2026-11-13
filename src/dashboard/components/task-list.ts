import { t } from "../../lang/helpers";
import type { DatasetRow } from "../dataset/types";
import type { ComponentDefinition } from "../registry";
import type { DashboardComponentConfig } from "../types";
import {
	cardSearchText,
	mountCardSearch,
	type CardSearchHandle,
} from "../ui/card-search";
import {
	renderPagedList,
	type PagedListHandle,
	type PagerLabels,
} from "../ui/pager";

const TASK_STATUS_MARKERS: Record<string, string> = {
	open: " ",
	done: "x",
	cancelled: "-",
	"in-progress": "/",
	forwarded: ">",
};

const MAX_MARKDOWN_ROWS_PER_PAGE = 100;

const pageMemory = new WeakMap<
	DashboardComponentConfig,
	{ queryId: string; page: number }
>();

interface TaskCardState {
	queryId: string;
	rows: readonly DatasetRow[];
	list?: PagedListHandle<DatasetRow>;
	search?: CardSearchHandle;
	emptyEl?: HTMLElement;
}

const cardStates = new WeakMap<DashboardComponentConfig, TaskCardState>();

function stateOf(config: DashboardComponentConfig): TaskCardState {
	let state = cardStates.get(config);
	if (!state || state.queryId !== config.queryId) {
		state = { queryId: config.queryId, rows: [] };
		cardStates.set(config, state);
	}
	return state;
}

function rememberedPage(config: DashboardComponentConfig): number {
	const memory = pageMemory.get(config);
	return memory && memory.queryId === config.queryId ? memory.page : 1;
}

function markerOf(status: string | undefined): string {
	return TASK_STATUS_MARKERS[status ?? "open"] ?? " ";
}

/** 任务正文、笔记名或项目名任一命中即保留；空关键词视为全部命中。 */
export function matchesTaskRow(row: DatasetRow, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return true;
	return [row.cells.text?.text, row.cells.note?.text, row.cells.project?.text].some(
		(value) => (value ?? "").toLocaleLowerCase().includes(needle),
	);
}

function applyFilter(
	state: TaskCardState,
	config: DashboardComponentConfig,
): void {
	const text = state.search?.text ?? cardSearchText(config);
	const query = text.trim();
	const isFiltering = query.length > 0;
	const filtered = isFiltering
		? state.rows.filter((row) => matchesTaskRow(row, text))
		: state.rows;
	if (state.emptyEl) {
		state.emptyEl.toggle(isFiltering && filtered.length === 0);
		if (isFiltering) state.emptyEl.setText(t("TASK_LIST_NO_MATCH", [query]));
	}
	state.list?.setItems(filtered, { resetPage: true });
	if (isFiltering) {
		pageMemory.set(config, { queryId: config.queryId, page: 1 });
	}
}

export const taskListComponent: ComponentDefinition = {
	type: "task-list",
	labelKey: "COMPONENT_TASK_LIST_NAME",
	descriptionKey: "COMPONENT_TASK_LIST_DESC",
	icon: "list-todo",
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
			labelKey: "COMPONENT_TASK_LIST_PAGE_SIZE",
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
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: (result) => (result.items ?? []).length === 0,
	render: (el, ctx) => {
		el.addClass("ioto-task-list");
		const rows = ctx.dataset?.rows ?? [];
		const state = stateOf(ctx.config);
		state.rows = rows;
		if (rows.length === 0) {
			el.createDiv({ cls: "ioto-empty-state", text: t("TASK_LIST_EMPTY") });
			return;
		}
		const pageSize = Math.max(1, ctx.config.limit ?? 20);
		const renderInline = ctx.renderInlineMarkdown?.bind(ctx);
		const useMarkdown = Boolean(renderInline) && pageSize <= MAX_MARKDOWN_ROWS_PER_PAGE;
		const labels: PagerLabels = {
			prev: t("PAGINATION_PREV"),
			next: t("PAGINATION_NEXT"),
			page: (page, count) => t("PAGINATION_PAGE", [String(page), String(count)]),
			range: (from, to, total) =>
				t("PAGINATION_RANGE", [String(from), String(to), String(total)]),
		};
		state.list = renderPagedList({
			host: el,
			items: rows,
			pageSize,
			initialPage: rememberedPage(ctx.config),
			tagName: "ul",
			listClass: "contains-task-list ioto-task-list-items",
			labels,
			renderItem: (row) => {
				const textCell = row.cells.text;
				const noteCell = row.cells.note;
				const projectCell = row.cells.project;
				const statusCell = row.cells.status;
				const path = textCell?.path ?? noteCell?.path;
				const marker = markerOf(statusCell?.text);
				const itemEl = document.createElement("li");
				itemEl.className = "task-list-item ioto-task-list-item";
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
						if (ctx.editMode) return;
						event.stopPropagation();
						ctx.openFile(notePath);
					});
				}
				const project = projectCell?.text ?? "";
				if (project.length > 0) {
					if (metaEl.childElementCount > 0) metaEl.appendText(" · ");
					metaEl.createEl("span", { cls: "ioto-task-list-project", text: project });
				}
				if (!path) return itemEl;
				itemEl.setAttr("tabindex", "0");
				const open = () => {
					if (ctx.editMode) return;
					ctx.openFile(path, textCell?.line);
				};
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
				return itemEl;
			},
			onPageChange: (page) =>
				pageMemory.set(ctx.config, { queryId: ctx.config.queryId, page }),
		});
		state.emptyEl = el.createDiv({
			cls: "ioto-empty-state ioto-task-list-no-match",
		});
		state.emptyEl.hide();
		if (cardSearchText(ctx.config).length > 0) applyFilter(state, ctx.config);
	},
	renderHeaderActions: (header, ctx) => {
		const rows = ctx.dataset?.rows ?? [];
		// 空数据集时列表本身就是空态，没有内容可过滤。
		if (rows.length === 0) return;
		const state = stateOf(ctx.config);
		state.search = mountCardSearch(header, {
			config: ctx.config,
			labels: {
				toggle: t("TASK_LIST_SEARCH_TOGGLE"),
				placeholder: t("TASK_LIST_SEARCH_PLACEHOLDER"),
				close: t("TASK_LIST_SEARCH_CLOSE"),
			},
			onChange: () => applyFilter(state, ctx.config),
		});
	},
};
