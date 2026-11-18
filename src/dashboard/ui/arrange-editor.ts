import { setIcon } from "obsidian";
import { t } from "../../lang/helpers";
import {
	groupLabelKey,
	groupsForObject,
	operatorsForColumn,
	type PresentationSpec,
	type RowFilter,
	type RowFilterOp,
} from "../dataset/presentation";
import type { DataObject, DatasetColumn } from "../dataset/types";
import type { ArrangeCapability } from "../registry";

const FILTER_INPUT_DEBOUNCE = 150;
const MAX_FILTERS = 20;

export interface ArrangeEditorChange {
	spec: PresentationSpec;
	/** `true` for discrete group/sort changes; `false` for session-only filters. */
	persist: boolean;
	focusKey?: string;
}

export interface ArrangeEditorOptions {
	columns: readonly DatasetColumn[];
	object: DataObject;
	spec: PresentationSpec;
	capability: ArrangeCapability;
	disabled?: boolean;
	/** Shows the "not saved yet" hint; filters are preview-only until saved. */
	filtersDirty?: boolean;
	onChange(change: ArrangeEditorChange): void;
	onSave?(): void;
	onReset?(): void;
}

export interface ArrangeEditorHandle {
	readonly spec: PresentationSpec;
}

const OP_LABEL_KEYS: Record<RowFilterOp, string> = {
	contains: "ARRANGE_OP_CONTAINS",
	notContains: "ARRANGE_OP_NOT_CONTAINS",
	is: "ARRANGE_OP_IS",
	isNot: "ARRANGE_OP_IS_NOT",
	empty: "ARRANGE_OP_EMPTY",
	notEmpty: "ARRANGE_OP_NOT_EMPTY",
	gt: "ARRANGE_OP_GT",
	gte: "ARRANGE_OP_GTE",
	lt: "ARRANGE_OP_LT",
	lte: "ARRANGE_OP_LTE",
	between: "ARRANGE_OP_BETWEEN",
};

function opNeedsValue(op: RowFilterOp): boolean {
	return op !== "empty" && op !== "notEmpty";
}

function cloneSpec(spec: PresentationSpec): PresentationSpec {
	const next: PresentationSpec = { v: 1 };
	if (spec.group) next.group = spec.group;
	if (spec.sort) next.sort = { ...spec.sort };
	if (spec.filters && spec.filters.length > 0) {
		next.filters = spec.filters.map((filter) => ({ ...filter }));
	}
	return next;
}

/**
 * Group / sort / filter editor used by both the inspector section and the
 * card's floating panel. Stateless from the caller's perspective: every edit
 * is reported through `onChange`, and the caller decides what to persist.
 */
export function buildArrangeEditor(
	host: HTMLElement,
	options: ArrangeEditorOptions,
): ArrangeEditorHandle {
	const { columns, object, capability } = options;
	const spec = cloneSpec(options.spec);
	const filters = spec.filters ?? [];
	spec.filters = filters.length > 0 ? filters : undefined;
	const disabled = options.disabled === true;
	const labelKey = (key: string): Parameters<typeof t>[0] =>
		key as Parameters<typeof t>[0];

	const commit = (persist: boolean, focusKey?: string): void => {
		if (spec.filters && spec.filters.length === 0) delete spec.filters;
		options.onChange({ spec: cloneSpec(spec), persist, focusKey });
	};

	const buildField = (parent: HTMLElement, label: string): HTMLElement => {
		const field = parent.createDiv({ cls: "ioto-arrange-field" });
		field.createEl("label", { cls: "ioto-arrange-label", text: label });
		return field;
	};

	/* ------------------------------- Group -------------------------------- */

	if (capability.group !== false) {
		const groups = groupsForObject(object).filter((group) => group !== "none");
		if (groups.length > 0) {
			const field = buildField(host, t("ARRANGE_GROUP_LABEL"));
			const select = field.createEl("select", {
				cls: "dropdown ioto-arrange-select",
				attr: { "data-arrange-focus": "group" },
			});
			select.createEl("option", {
				value: "",
				text: t("TABLE_GROUP_NONE"),
			});
			for (const group of groups) {
				select.createEl("option", {
					value: group,
					text: t(labelKey(groupLabelKey(group))),
				});
			}
			select.value = spec.group ?? "";
			select.disabled = disabled;
			select.addEventListener("change", () => {
				if (select.value.length === 0) delete spec.group;
				else spec.group = select.value;
				commit(true, "group");
			});
		}
	}

	/* -------------------------------- Sort -------------------------------- */

	if (capability.sort !== false) {
		const field = buildField(host, t("ARRANGE_SORT_LABEL"));
		const row = field.createDiv({ cls: "ioto-arrange-row" });
		const select = row.createEl("select", {
			cls: "dropdown ioto-arrange-select ioto-arrange-sort-key",
			attr: { "data-arrange-focus": "sort" },
		});
		select.createEl("option", {
			value: "",
			text: t("ARRANGE_SORT_DEFAULT"),
		});
		for (const column of columns) {
			select.createEl("option", {
				value: column.key,
				text: t(labelKey(column.labelKey)),
			});
		}
		select.value = spec.sort?.key ?? "";
		select.disabled = disabled;

		const dir = row.createEl("button", {
			cls: "clickable-icon ioto-arrange-dir",
			attr: {
				type: "button",
				"data-arrange-focus": "sort-dir",
				"aria-label": t(
					spec.sort?.dir === -1 ? "ARRANGE_SORT_DESC" : "ARRANGE_SORT_ASC",
				),
			},
		});
		setIcon(dir, spec.sort?.dir === -1 ? "arrow-down" : "arrow-up");
		dir.disabled = disabled || !spec.sort;

		select.addEventListener("change", () => {
			if (select.value.length === 0) delete spec.sort;
			else spec.sort = { key: select.value, dir: spec.sort?.dir ?? 1 };
			commit(true, "sort");
		});
		dir.addEventListener("click", () => {
			if (!spec.sort) return;
			spec.sort = {
				key: spec.sort.key,
				dir: spec.sort.dir === 1 ? -1 : 1,
			};
			commit(true, "sort-dir");
		});
	}

	/* ------------------------------- Filters ------------------------------ */

	if (capability.filter !== false) {
		const section = host.createDiv({ cls: "ioto-arrange-filters" });
		section.createDiv({
			cls: "ioto-arrange-filters-title",
			text: t("ARRANGE_FILTER_LABEL"),
		});
		const list = section.createDiv({ cls: "ioto-arrange-filter-list" });
		let timer = 0;

		const flushInput = (filter: RowFilter, index: number): void => {
			if (filter.value !== undefined && filter.value.trim() === "") {
				delete filter.value;
			}
			if (filter.value2 !== undefined && filter.value2.trim() === "") {
				delete filter.value2;
			}
			commit(false, `filter-${index}-value`);
		};
		const scheduleInput = (filter: RowFilter, index: number): void => {
			if (timer) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = 0;
				flushInput(filter, index);
			}, FILTER_INPUT_DEBOUNCE);
		};

		const buildRow = (filter: RowFilter, index: number): void => {
			const column =
				columns.find((item) => item.key === filter.key) ?? columns[0];
			if (!column) return;
			const row = list.createDiv({ cls: "ioto-arrange-filter-row" });

			const columnSelect = row.createEl("select", {
				cls: "dropdown ioto-arrange-select ioto-arrange-filter-col",
				attr: {
					"data-arrange-focus": `filter-${index}-col`,
					"aria-label": t("ARRANGE_FILTER_LABEL"),
				},
			});
			for (const item of columns) {
				columnSelect.createEl("option", {
					value: item.key,
					text: t(labelKey(item.labelKey)),
				});
			}
			columnSelect.value = column.key;
			columnSelect.disabled = disabled;

			const ops = operatorsForColumn(column.type);
			const op = ops.includes(filter.op) ? filter.op : (ops[0] ?? "contains");
			const opSelect = row.createEl("select", {
				cls: "dropdown ioto-arrange-select ioto-arrange-filter-op",
				attr: {
					"data-arrange-focus": `filter-${index}-op`,
					"aria-label": t("ARRANGE_FILTER_LABEL"),
				},
			});
			for (const item of ops) {
				opSelect.createEl("option", {
					value: item,
					text: t(labelKey(OP_LABEL_KEYS[item])),
				});
			}
			opSelect.value = op;
			opSelect.disabled = disabled;

			if (opNeedsValue(op)) {
				const value = row.createEl("input", {
					cls: "ioto-arrange-value",
					type: "text",
					attr: {
						"data-arrange-focus": `filter-${index}-value`,
						"aria-label": t("ARRANGE_FILTER_LABEL"),
						placeholder: t("ARRANGE_VALUE_PLACEHOLDER"),
					},
				});
				value.value = filter.value ?? "";
				value.disabled = disabled;
				value.addEventListener("input", () => {
					filter.value = value.value;
					scheduleInput(filter, index);
				});
			}
			if (op === "between") {
				const value2 = row.createEl("input", {
					cls: "ioto-arrange-value",
					type: "text",
					attr: {
						"data-arrange-focus": `filter-${index}-value2`,
						"aria-label": t("ARRANGE_VALUE2_PLACEHOLDER"),
						placeholder: t("ARRANGE_VALUE2_PLACEHOLDER"),
					},
				});
				value2.value = filter.value2 ?? "";
				value2.disabled = disabled;
				value2.addEventListener("input", () => {
					filter.value2 = value2.value;
					scheduleInput(filter, index);
				});
			}

			const remove = row.createEl("button", {
				cls: "clickable-icon ioto-arrange-filter-remove",
				attr: {
					type: "button",
					"data-arrange-focus": `filter-${index}-remove`,
					"aria-label": t("ARRANGE_FILTER_REMOVE"),
				},
			});
			setIcon(remove, "x");
			remove.disabled = disabled;

			columnSelect.addEventListener("change", () => {
				const nextColumn =
					columns.find((item) => item.key === columnSelect.value) ?? column;
				filter.key = nextColumn.key;
				const nextOps = operatorsForColumn(nextColumn.type);
				if (!nextOps.includes(filter.op)) {
					filter.op = nextOps[0] ?? "contains";
					delete filter.value;
					delete filter.value2;
				}
				renderFilters();
				commit(false, `filter-${index}-col`);
			});
			opSelect.addEventListener("change", () => {
				filter.op = opSelect.value as RowFilterOp;
				if (!opNeedsValue(filter.op)) {
					delete filter.value;
					delete filter.value2;
				}
				renderFilters();
				commit(false, `filter-${index}-op`);
			});
			remove.addEventListener("click", () => {
				const position = filters.indexOf(filter);
				if (position < 0) return;
				filters.splice(position, 1);
				spec.filters = filters.length > 0 ? filters : undefined;
				renderFilters();
				commit(false, "filter-add");
			});
		};

		const renderFilters = (): void => {
			list.empty();
			filters.forEach((filter, index) => buildRow(filter, index));
			if (filters.length === 0) {
				list.createDiv({
					cls: "ioto-arrange-empty",
					text: t("ARRANGE_FILTER_LABEL"),
				});
			}
			clear.disabled = disabled || filters.length === 0;
		};

		const actions = section.createDiv({ cls: "ioto-arrange-filter-actions" });
		const add = actions.createEl("button", {
			cls: "ioto-arrange-action",
			text: t("ARRANGE_FILTER_ADD"),
			attr: { type: "button", "data-arrange-focus": "filter-add" },
		});
		const clear = actions.createEl("button", {
			cls: "ioto-arrange-action ioto-arrange-filter-clear",
			text: t("ARRANGE_CLEAR_FILTERS"),
			attr: { type: "button" },
		});
		add.disabled = disabled;
		add.addEventListener("click", () => {
			if (filters.length >= MAX_FILTERS) return;
			const column = columns[0];
			if (!column) return;
			const ops = operatorsForColumn(column.type);
			filters.push({ key: column.key, op: ops[0] ?? "contains" });
			spec.filters = filters;
			renderFilters();
			commit(false, "filter-add");
		});
		clear.addEventListener("click", () => {
			filters.splice(0, filters.length);
			spec.filters = undefined;
			renderFilters();
			commit(false, "filter-add");
		});
		renderFilters();
	}

	/* ------------------------------- Footer ------------------------------- */

	if (options.filtersDirty) {
		host.createDiv({
			cls: "ioto-arrange-hint",
			text: t("ARRANGE_UNSAVED_HINT"),
		});
	}
	if (options.onSave || options.onReset) {
		const footer = host.createDiv({ cls: "ioto-arrange-footer" });
		if (options.onSave) {
			const save = footer.createEl("button", {
				cls: "ioto-arrange-action mod-cta",
				text: t("ARRANGE_SAVE_DEFAULT"),
				attr: { type: "button", "data-arrange-focus": "save" },
			});
			save.disabled = disabled;
			save.addEventListener("click", () => options.onSave?.());
		}
		if (options.onReset) {
			const reset = footer.createEl("button", {
				cls: "ioto-arrange-action",
				text: t("ARRANGE_RESET_DEFAULT"),
				attr: { type: "button", "data-arrange-focus": "reset" },
			});
			reset.disabled = disabled;
			reset.addEventListener("click", () => options.onReset?.());
		}
	}

	return {
		get spec() {
			return cloneSpec(spec);
		},
	};
}