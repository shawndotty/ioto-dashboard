import { Menu } from "obsidian";
import { t } from "../../../lang/helpers";
import {
	clampPage,
	pageCountOf,
	renderPager,
	type PagerControls,
} from "../../ui/pager";
import type { DataObject, Dataset, DatasetCell, DatasetRow } from "../types";

export type CellLinkKind = "task" | "auto";

export interface CellLink {
	path: string;
	line?: number;
	kind: CellLinkKind;
}

/** 只做“数据层可判定”的归类；文件夹最终由运行时节点确认。 */
export function resolveCellLink(cell: DatasetCell | undefined): CellLink | null {
	if (!cell || typeof cell.path !== "string" || cell.path.length === 0) {
		return null;
	}
	return {
		path: cell.path,
		line: cell.line,
		kind: cell.line === undefined ? "auto" : "task",
	};
}

export const TABLE_GROUPS = [
	"none",
	"project",
	"section",
	"status",
	"ioType",
	"folder",
	"extension",
] as const;

export type TableGroup = (typeof TABLE_GROUPS)[number];

const GROUPS_BY_OBJECT: Record<DataObject, TableGroup[]> = {
	task: ["none", "project", "section", "status"],
	note: ["none", "ioType", "folder"],
	file: ["none", "extension", "folder"],
	folder: ["none"],
	project: ["none"],
};

const GROUP_LABEL_KEYS: Record<Exclude<TableGroup, "none">, string> = {
	project: "TABLE_GROUP_PROJECT",
	section: "TABLE_GROUP_SECTION",
	status: "TABLE_GROUP_STATUS",
	ioType: "TABLE_GROUP_IO_TYPE",
	folder: "TABLE_GROUP_FOLDER",
	extension: "TABLE_GROUP_EXTENSION",
};

/** Grouping dimensions offered for one dataset object. */
export function groupsForObject(object: DataObject): TableGroup[] {
	return [...(GROUPS_BY_OBJECT[object] ?? ["none"])];
}

export function groupLabelKey(group: TableGroup): string {
	return group === "none"
		? "TABLE_GROUP_NONE"
		: (GROUP_LABEL_KEYS[group] ?? "TABLE_GROUP_NONE");
}

export function resolveTableGroup(value: unknown): TableGroup {
	return typeof value === "string" &&
		(TABLE_GROUPS as readonly string[]).includes(value)
		? (value as TableGroup)
		: "none";
}

/** Stored grouping may come from another object; unusable dimensions fall back. */
export function resolveGroupFor(
	object: DataObject,
	value: unknown,
): TableGroup {
	const group = resolveTableGroup(value);
	return groupsForObject(object).includes(group) ? group : "none";
}

/** Every cell text matches, so search spans all visible and hidden columns. */
export function matchesTableRow(row: DatasetRow, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return true;
	return Object.values(row.cells).some((cell) =>
		(cell?.text ?? "").toLocaleLowerCase().includes(needle),
	);
}

function sortValueOf(row: DatasetRow, key: string): string | number {
	const cell = row.cells[key];
	return cell?.sortValue ?? cell?.text ?? "";
}

/** Numbers compare numerically; strings compare with numeric-aware locale order. */
export function compareTableValues(
	left: string | number,
	right: string | number,
	direction: 1 | -1,
): number {
	if (typeof left === "number" && typeof right === "number") {
		return (left - right) * direction;
	}
	return (
		String(left).localeCompare(String(right), undefined, {
			numeric: true,
			sensitivity: "base",
		}) * direction
	);
}

export function sortTableRows(
	rows: readonly DatasetRow[],
	key: string,
	direction: 1 | -1,
): DatasetRow[] {
	return [...rows].sort((a, b) =>
		compareTableValues(sortValueOf(a, key), sortValueOf(b, key), direction),
	);
}

export interface TableGroupSegment {
	key: string;
	label: string;
	rows: DatasetRow[];
}

/**
 * Groups rows without reordering: the group order follows the first appearance
 * in the (already sorted) row list, so groups stay contiguous.
 */
export function groupTableRows(
	rows: readonly DatasetRow[],
	group: TableGroup,
): TableGroupSegment[] {
	if (group === "none") {
		return rows.length === 0
			? []
			: [{ key: "", label: "", rows: [...rows] }];
	}
	const segments: TableGroupSegment[] = [];
	const index = new Map<string, TableGroupSegment>();
	for (const row of rows) {
		const label = row.cells[group]?.text ?? "—";
		let segment = index.get(label);
		if (!segment) {
			segment = { key: label, label, rows: [] };
			index.set(label, segment);
			segments.push(segment);
		}
		segment.rows.push(row);
	}
	return segments;
}

export interface TableViewState {
	page?: number;
	sortKey?: string;
	sortDir?: 1 | -1;
}

export interface TableOptions {
	showRowNumber?: boolean;
	editMode?: boolean;
	pageSize?: number;
	/** Requested visible column keys; the primary column is always kept. */
	columns?: string[];
	group?: TableGroup;
	state?: TableViewState;
	onStateChange?(patch: TableViewState & { pageSize?: number }): void;
	/** 任意带 path 的单元格点击；line 有值表示任务定位。 */
	openLink?(path: string, line: number | undefined, newTab: boolean): void;
	openFolder?(path: string): void;
	revealInExplorer?(path: string): void;
}

export interface TableHandle {
	setFilter(text: string): void;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];

function rowText(row: DatasetRow, keys: readonly string[]): string {
	return keys
		.map((key) => row.cells[key]?.text ?? "")
		.filter((text) => text.length > 0)
		.join(" · ");
}

async function copyText(value: string): Promise<void> {
	if (!value) return;
	try {
		await navigator.clipboard?.writeText(value);
	} catch (error) {
		console.warn("IOTO Dashboard: clipboard write failed", error);
	}
}

/**
 * Renders a sortable, searchable, paginated table straight from a Dataset.
 * Sorting/filtering/paging stay local to this card; the query never changes.
 */
export function renderTable(
	el: HTMLElement,
	dataset: Dataset,
	openFile: (path: string, line?: number, newTab?: boolean) => void,
	options: TableOptions = {},
): TableHandle | null {
	el.addClass("ioto-table");
	el.toggleClass("is-editing", options.editMode === true);
	if (dataset.rows.length === 0) {
		el.createDiv({ cls: "ioto-empty-state", text: t("DASHBOARD_TABLE_EMPTY") });
		return null;
	}

	const available = dataset.columns;
	const requested = options.columns;
	let columns = available;
	if (requested && requested.length > 0) {
		const allowed = new Set(requested);
		const picked = available.filter((column) => allowed.has(column.key));
		columns = picked.length > 0 ? picked : available;
	}
	const primaryKey = available[0]?.key ?? "";
	if (primaryKey && !columns.some((column) => column.key === primaryKey)) {
		const primary = available.find((column) => column.key === primaryKey);
		if (primary) columns = [primary, ...columns];
	}

	const group = options.group ?? "none";
	const showRowNumber = options.showRowNumber === true;
	let pageSize = Math.max(1, options.pageSize ?? 50);
	let sortKey =
		options.state?.sortKey && available.some((c) => c.key === options.state?.sortKey)
			? options.state.sortKey
			: "";
	let sortDir: 1 | -1 = options.state?.sortDir === -1 ? -1 : 1;
	let page = options.state?.page ?? 1;
	let filterText = "";

	const wrapper = el.createDiv({ cls: "ioto-table-wrapper" });
	const table = wrapper.createEl("table", { cls: "ioto-table-el" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	const tbody = table.createEl("tbody");
	const noMatchEl = el.createDiv({
		cls: "ioto-empty-state ioto-table-no-match",
	});
	noMatchEl.hide();

	const footer = el.createDiv({ cls: "ioto-table-footer" });
	const summaryEl = footer.createDiv({ cls: "ioto-table-summary" });
	const controlsEl = footer.createDiv({ cls: "ioto-table-footer-controls" });
	controlsEl.createSpan({
		cls: "ioto-table-page-size-label",
		text: t("TABLE_PAGE_SIZE"),
	});
	const pageSizeSelect = controlsEl.createEl("select", {
		cls: "dropdown ioto-table-page-size",
		attr: { "aria-label": t("TABLE_PAGE_SIZE"), title: t("TABLE_PAGE_SIZE") },
	});
	const pagerHost = controlsEl.createDiv({
		cls: "ioto-card-pager ioto-table-pager",
	});
	let pager: PagerControls | null = null;

	const colspan = columns.length + (showRowNumber ? 1 : 0);
	const headerEls = new Map<string, HTMLElement>();

	const openRow = (row: DatasetRow, newTab = false): void => {
		if (options.editMode) return;
		const link = resolveCellLink(row.cells[primaryKey]);
		if (!link) return;
		if (options.openLink) {
			options.openLink(link.path, link.line, newTab);
			return;
		}
		// 兼容回退：仅旧宿主
		if (dataset.object === "folder" && options.openFolder) {
			options.openFolder(link.path);
			return;
		}
		openFile(link.path, link.line, newTab);
	};

	const rowMenu = (event: MouseEvent, row: DatasetRow): void => {
		if (options.editMode) return;
		const cell = row.cells[primaryKey];
		const path = cell?.path;
		if (!path) return;
		event.preventDefault();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("TABLE_ROW_REVEAL"))
				.setIcon("folder-open")
				.onClick(() => options.revealInExplorer?.(path)),
		);
		if (dataset.object !== "folder") {
			menu.addItem((item) =>
				item
					.setTitle(t("TABLE_ROW_OPEN_NEW_TAB"))
					.setIcon("file-plus")
					.onClick(() => openRow(row, true)),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle(t("TABLE_ROW_COPY_PATH"))
				.setIcon("copy")
				.onClick(() => void copyText(path)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("TABLE_ROW_COPY_TEXT"))
				.setIcon("clipboard")
				.onClick(() =>
					void copyText(
						rowText(
							row,
							columns.map((column) => column.key),
						),
					),
				),
		);
		menu.showAtMouseEvent(event);
	};

	const buildHead = (): void => {
		headRow.empty();
		headerEls.clear();
		if (showRowNumber) {
			const indexHead = headRow.createEl("th", {
				cls: "ioto-table-index",
				text: "#",
			});
			indexHead.setAttr("aria-hidden", "true");
		}
		for (const column of columns) {
			const sortable = options.editMode !== true;
			const th = headRow.createEl("th", {
				text: t(column.labelKey as Parameters<typeof t>[0]),
				cls: column.align === "right" ? "is-right" : undefined,
				attr: sortable
					? { tabindex: "0", title: t("TABLE_SORT_HINT") }
					: undefined,
			});
			if (sortable) th.addClass("is-sortable");
			const activate = (): void => {
				if (options.editMode) return;
				sortDir = sortKey === column.key && sortDir === 1 ? -1 : 1;
				sortKey = column.key;
				page = 1;
				syncHeadState();
				options.onStateChange?.({ sortKey, sortDir, page });
				draw();
			};
			th.addEventListener("click", activate);
			th.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				activate();
			});
			headerEls.set(column.key, th);
		}
		syncHeadState();
	};

	const syncHeadState = (): void => {
		for (const [key, th] of headerEls) {
			const active = key === sortKey;
			th.removeClass("is-asc", "is-desc");
			if (!active) {
				th.setAttr("aria-sort", "none");
				continue;
			}
			th.addClass(sortDir === 1 ? "is-asc" : "is-desc");
			th.setAttr(
				"aria-sort",
				sortDir === 1 ? "ascending" : "descending",
			);
			if (options.editMode !== true) {
				th.setAttr(
					"title",
					t(sortDir === 1 ? "TABLE_SORT_ASC" : "TABLE_SORT_DESC"),
				);
			}
		}
	};

	const buildPager = (): void => {
		pagerHost.empty();
		pager = renderPager(pagerHost, {
			labels: {
				prev: t("PAGINATION_PREV"),
				next: t("PAGINATION_NEXT"),
				page: (current, count) =>
					t("PAGINATION_PAGE", [String(current), String(count)]),
				range: (from, to, total) =>
					t("PAGINATION_RANGE", [String(from), String(to), String(total)]),
			},
			pageSize,
			onGo: (target) => {
				page = target;
				options.onStateChange?.({ page });
				draw();
			},
		});
	};

	const renderRows = (
		rows: readonly DatasetRow[],
		pageStart: number,
		groupCounts?: Map<string, number>,
	): void => {
		tbody.empty();
		if (rows.length === 0) return;
		const segments = groupTableRows(rows, group);
		let cursor = pageStart;
		for (const segment of segments) {
			if (segment.rows.length === 0) continue;
			const segmentStart = cursor;
			const segmentEnd = cursor + segment.rows.length;
			cursor = segmentEnd;
			const from = Math.max(pageStart, segmentStart);
			const to = Math.min(pageStart + pageSize, segmentEnd);
			if (from >= to) continue;
			if (group !== "none") {
				const headTr = tbody.createEl("tr", {
					cls: "ioto-table-group-row",
				});
				const groupHead = headTr.createEl("th", {
					attr: { colspan: String(colspan) },
				});
				groupHead.createSpan({
					cls: "ioto-table-group-label",
					text: segment.label,
				});
				groupHead.createSpan({
					cls: "ioto-table-group-count",
					text: t("TABLE_GROUP_COUNT", [
						String(groupCounts?.get(segment.label) ?? segment.rows.length),
					]),
				});
			}
			for (let offset = from; offset < to; offset += 1) {
				const row = segment.rows[offset - segmentStart];
				if (!row) continue;
				const tr = tbody.createEl("tr");
				const primaryCell = row.cells[primaryKey];
				const path = primaryCell?.path;
				if (path) {
					tr.addClass("is-clickable");
					tr.setAttr("tabindex", options.editMode ? "-1" : "0");
					tr.addEventListener("click", (event) =>
						openRow(row, event.metaKey || event.ctrlKey),
					);
					tr.addEventListener("keydown", (event) => {
						// 链接自己处理 Enter，避免冒泡后打开两次
						if (
							(event.target as HTMLElement | null)?.closest(
								"a.internal-link",
							)
						) {
							return;
						}
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						openRow(row);
					});
					tr.addEventListener("contextmenu", (event) =>
						rowMenu(event, row),
					);
				}
				if (showRowNumber) {
					tr.createEl("td", {
						cls: "ioto-table-index",
						text: String(offset + 1),
					});
				}
				for (const column of columns) {
					const cell = row.cells[column.key];
					const td = tr.createEl("td", {
						cls: column.align === "right" ? "is-right" : undefined,
					});
					const link = resolveCellLink(cell);
					if (link && !options.editMode && options.openLink) {
						const anchor = td.createEl("a", {
							cls: "internal-link",
							text: cell?.text ?? "",
							href: link.path,
						});
						anchor.addEventListener("click", (event) => {
							event.preventDefault();
							event.stopPropagation();
							options.openLink?.(link.path, link.line, true);
						});
						// 中键不会触发 click，单独拦截以免走原生 href
						anchor.addEventListener("auxclick", (event) => {
							if (event.button !== 1) return;
							event.preventDefault();
							event.stopPropagation();
							options.openLink?.(link.path, link.line, true);
						});
					} else {
						td.setText(cell?.text ?? "");
					}
					if (cell?.path) td.setAttr("title", cell.path);
				}
			}
		}
	};

	const filteredRows = (): DatasetRow[] => {
		const base =
			filterText.trim().length > 0
				? dataset.rows.filter((row) => matchesTableRow(row, filterText))
				: [...dataset.rows];
		return sortKey ? sortTableRows(base, sortKey, sortDir) : base;
	};

	const drawSummary = (): void => {
		summaryEl.empty();
		for (const item of dataset.summary?.items ?? []) {
			const itemEl = summaryEl.createSpan({
				cls: "ioto-table-summary-item",
			});
			if (item.measure && item.measure === dataset.measure) {
				itemEl.addClass("is-emphasis");
			}
			itemEl.createSpan({
				cls: "ioto-table-summary-label",
				text: t(item.labelKey as Parameters<typeof t>[0]),
			});
			itemEl.createSpan({
				cls: "ioto-table-summary-value",
				text: item.value,
			});
		}
		if (dataset.truncated) {
			summaryEl.createSpan({
				cls: "ioto-table-summary-item is-muted",
				text: t("DASHBOARD_TRUNCATED", [
					String(dataset.rows.length),
					String(dataset.total),
				]),
			});
		}
	};

	const draw = (): void => {
		const rows = filteredRows();
		const pageCount = pageCountOf(rows.length, pageSize);
		page = clampPage(page, pageCount);
		const start = (page - 1) * pageSize;
		const pageRows = rows.slice(start, start + pageSize);
		const filtering = filterText.trim().length > 0;
		noMatchEl.toggle(filtering && rows.length === 0);
		if (filtering && rows.length === 0) {
			noMatchEl.setText(t("TABLE_NO_MATCH", [filterText.trim()]));
		}
		const groupCounts =
			group === "none"
				? undefined
				: new Map(
						groupTableRows(rows, group).map((segment) => [
							segment.label,
							segment.rows.length,
						]),
					);
		renderRows(pageRows, start, groupCounts);
		pager?.update(page, pageCount, rows.length);
		pagerHost.toggleClass("is-hidden", pageCount <= 1);
	};

	for (const size of PAGE_SIZE_OPTIONS) {
		pageSizeSelect.createEl("option", {
			value: String(size),
			text: String(size),
		});
	}
	if (!PAGE_SIZE_OPTIONS.includes(pageSize)) {
		pageSizeSelect.createEl("option", {
			value: String(pageSize),
			text: String(pageSize),
		});
	}
	pageSizeSelect.value = String(pageSize);
	pageSizeSelect.addEventListener("change", () => {
		pageSize = Math.max(1, Number(pageSizeSelect.value) || pageSize);
		page = 1;
		options.onStateChange?.({ pageSize, page });
		buildPager();
		draw();
	});

	buildHead();
	buildPager();
	drawSummary();
	draw();

	return {
		setFilter(text: string) {
			const next = text ?? "";
			if (next === filterText) return;
			filterText = next;
			page = 1;
			options.onStateChange?.({ page });
			draw();
		},
	};
}
