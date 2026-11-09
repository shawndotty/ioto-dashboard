import { t } from "../../../lang/helpers";
import type { Dataset, DatasetRow } from "../types";

export interface TableOptions {
	showRowNumber?: boolean;
}

function compare(
	left: DatasetRow,
	right: DatasetRow,
	key: string,
	direction: 1 | -1,
): number {
	const a = left.cells[key]?.sortValue ?? left.cells[key]?.text ?? "";
	const b = right.cells[key]?.sortValue ?? right.cells[key]?.text ?? "";
	if (typeof a === "number" && typeof b === "number") {
		return (a - b) * direction;
	}
	return String(a).localeCompare(String(b)) * direction;
}

/**
 * Renders a sortable table straight from a Dataset. Sorting is local to this
 * card; the underlying query never changes.
 */
export function renderTable(
	el: HTMLElement,
	dataset: Dataset,
	openFile: (path: string, line?: number) => void,
	options: TableOptions = {},
): void {
	el.addClass("ioto-table");
	if (dataset.rows.length === 0) {
		el.createDiv({ cls: "ioto-empty-state", text: t("DASHBOARD_TABLE_EMPTY") });
		return;
	}

	const wrapper = el.createDiv({ cls: "ioto-table-wrapper" });
	const table = wrapper.createEl("table", { cls: "ioto-table-el" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	if (options.showRowNumber) {
		headRow.createEl("th", { cls: "ioto-table-index", text: "#" });
	}

	let sortKey = "";
	let direction: 1 | -1 = 1;
	const headerEls = new Map<string, HTMLElement>();
	for (const column of dataset.columns) {
		const th = headRow.createEl("th", {
			text: t(column.labelKey as Parameters<typeof t>[0]),
			cls: column.align === "right" ? "is-right" : undefined,
		});
		th.addClass("is-sortable");
		th.addEventListener("click", () => {
			direction = sortKey === column.key && direction === 1 ? -1 : 1;
			sortKey = column.key;
			for (const other of headerEls.values()) {
				other.removeClass("is-asc", "is-desc");
			}
			th.addClass(direction === 1 ? "is-asc" : "is-desc");
			renderBody(
				[...dataset.rows].sort((a, b) =>
					compare(a, b, column.key, direction),
				),
			);
		});
		headerEls.set(column.key, th);
	}

	const tbody = table.createEl("tbody");
	const renderBody = (rows: DatasetRow[]): void => {
		tbody.empty();
		rows.forEach((row, index) => {
			const tr = tbody.createEl("tr");
			const path = row.cells[dataset.columns[0]?.key ?? ""]?.path;
			if (path) {
				tr.addClass("is-clickable");
				tr.addEventListener("click", () => {
					const line = row.cells[dataset.columns[0]?.key ?? ""]?.line;
					openFile(path, line);
				});
			}
			if (options.showRowNumber) {
				tr.createEl("td", {
					cls: "ioto-table-index",
					text: String(index + 1),
				});
			}
			for (const column of dataset.columns) {
				const cell = row.cells[column.key];
				const td = tr.createEl("td", {
					text: cell?.text ?? "",
					cls: column.align === "right" ? "is-right" : undefined,
				});
				if (cell?.path) td.setAttr("title", cell.path);
			}
		});
	};

	renderBody(dataset.rows);

	if (dataset.truncated) {
		el.createDiv({
			cls: "ioto-table-footer",
			text: t("DASHBOARD_TRUNCATED", [
				String(dataset.rows.length),
				String(dataset.total),
			]),
		});
	}
}

