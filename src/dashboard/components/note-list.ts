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

const pageMemory = new WeakMap<
	DashboardComponentConfig,
	{ queryId: string; page: number }
>();

interface NoteCardState {
	queryId: string;
	rows: readonly DatasetRow[];
	list?: PagedListHandle<DatasetRow>;
	search?: CardSearchHandle;
	emptyEl?: HTMLElement;
}

const cardStates = new WeakMap<DashboardComponentConfig, NoteCardState>();

function stateOf(config: DashboardComponentConfig): NoteCardState {
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

/** 最近修改在前；同一时间戳按路径升序兜底，保证分页顺序稳定。 */
export function sortNoteRows(rows: readonly DatasetRow[]): DatasetRow[] {
	return [...rows].sort(
		(a, b) =>
			Number(b.cells.mtime?.sortValue ?? 0) -
				Number(a.cells.mtime?.sortValue ?? 0) ||
			String(a.cells.note?.path ?? a.id).localeCompare(
				String(b.cells.note?.path ?? b.id),
			),
	);
}

/** 标题、文件夹或 IO 类型任一命中即保留；空关键词视为全部命中。 */
export function matchesNoteRow(row: DatasetRow, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return true;
	return [
		row.cells.note?.text,
		row.cells.folder?.text,
		row.cells.ioType?.text,
	].some((value) => (value ?? "").toLocaleLowerCase().includes(needle));
}

function applyFilter(
	state: NoteCardState,
	config: DashboardComponentConfig,
): void {
	const text = state.search?.text ?? cardSearchText(config);
	const query = text.trim();
	const isFiltering = query.length > 0;
	const filtered = isFiltering
		? state.rows.filter((row) => matchesNoteRow(row, text))
		: state.rows;
	if (state.emptyEl) {
		state.emptyEl.toggle(isFiltering && filtered.length === 0);
		if (isFiltering) state.emptyEl.setText(t("NOTE_LIST_NO_MATCH", [query]));
	}
	state.list?.setItems(filtered, { resetPage: true });
	if (isFiltering) {
		pageMemory.set(config, { queryId: config.queryId, page: 1 });
	}
}

export const noteListComponent: ComponentDefinition = {
	type: "note-list",
	labelKey: "COMPONENT_NOTE_LIST_NAME",
	descriptionKey: "COMPONENT_NOTE_LIST_DESC",
	category: "overview",
	objects: ["note"],
	queryTargets: ["note"],
	views: ["list"],
	viewDefault: "list",
	measureDefault: "count",
	defaultQueryId: "builtin:notes-all",
	createConfig: (queryId) => ({
		queryId,
		view: "list",
		limit: 20,
		w: 6,
		h: 3,
	}),
	size: { maxH: 24 },
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "limit",
			kind: "number",
			group: "data",
			labelKey: "COMPONENT_NOTE_LIST_PAGE_SIZE",
			min: 1,
			max: 100,
			step: 1,
			fallback: 20,
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config) => ({
		object: "note",
		measure: "count",
		queryId: config.queryId,
		// 不下发 limit：数据集返回全部匹配笔记，limit 只作每页条数，也不污染 datasetKey。
	}),
	isEmptyDataset: (dataset) => dataset.total === 0,
	isEmpty: () => false,
	render: (el, ctx) => {
		el.addClass("ioto-note-list");
		const rows = sortNoteRows(ctx.dataset?.rows ?? []);
		const state = stateOf(ctx.config);
		state.rows = rows;
		if (rows.length === 0) {
			el.createDiv({ cls: "ioto-empty-state", text: t("NOTE_LIST_EMPTY") });
			return;
		}
		const pageSize = Math.max(1, ctx.config.limit ?? 20);
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
			listClass: "ioto-note-list-items",
			labels,
			renderItem: (row) => {
				const noteCell = row.cells.note;
				const folderCell = row.cells.folder;
				const dateCell = row.cells.mtime;
				const path = noteCell?.path ?? row.id;
				const itemEl = document.createElement("li");
				itemEl.className = "ioto-note-list-item";
				itemEl.setAttr("data-io-type", row.cells.ioType?.text ?? "Unknown");
				const title = itemEl.createEl("a", {
					cls: "internal-link ioto-note-list-title",
					text: noteCell?.text ?? row.id,
					href: path,
				});
				title.addEventListener("click", (event) => {
					event.preventDefault();
					if (ctx.editMode) return;
					event.stopPropagation();
					ctx.openFile(path);
				});
				const metaEl = itemEl.createDiv({ cls: "ioto-note-list-meta" });
				const ioType = row.cells.ioType?.text ?? "";
				if (ioType.length > 0) {
					metaEl.createEl("span", {
						cls: "ioto-note-list-io",
						text: ioType,
					});
				}
				const folder = folderCell?.text ?? "";
				if (folder.length > 0) {
					metaEl.createEl("span", {
						cls: "ioto-note-list-folder",
						text: folder,
						attr: { title: folderCell?.path ?? folder },
					});
				}
				const date = dateCell?.text ?? "";
				if (date.length > 0) {
					metaEl.createEl("span", {
						cls: "ioto-note-list-date",
						text: date,
					});
				}
				itemEl.setAttr("tabindex", "0");
				itemEl.onClickEvent((event) => {
					if (ctx.editMode) return;
					if (
						event.target instanceof HTMLElement &&
						event.target.closest("a.internal-link")
					) {
						return;
					}
					ctx.openFile(path);
				});
				itemEl.addEventListener("keydown", (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					if (!ctx.editMode) ctx.openFile(path);
				});
				return itemEl;
			},
			onPageChange: (page) =>
				pageMemory.set(ctx.config, { queryId: ctx.config.queryId, page }),
		});
		state.emptyEl = el.createDiv({
			cls: "ioto-empty-state ioto-note-list-no-match",
		});
		state.emptyEl.hide();
		if (cardSearchText(ctx.config).length > 0) applyFilter(state, ctx.config);
	},
	renderHeaderActions: (header, ctx) => {
		const rows = ctx.dataset?.rows ?? [];
		// 空数据集时卡片本身就是空态，没有内容可过滤。
		if (rows.length === 0) return;
		const state = stateOf(ctx.config);
		state.search = mountCardSearch(header, {
			config: ctx.config,
			labels: {
				toggle: t("NOTE_LIST_SEARCH_TOGGLE"),
				placeholder: t("NOTE_LIST_SEARCH_PLACEHOLDER"),
				close: t("NOTE_LIST_SEARCH_CLOSE"),
			},
			onChange: () => applyFilter(state, ctx.config),
		});
	},
};
