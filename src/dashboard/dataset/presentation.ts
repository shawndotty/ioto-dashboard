import type { DataObject, DatasetCell, DatasetColumn, DatasetRow } from "./types";

export type RowFilterOp =
	| "contains"
	| "notContains"
	| "is"
	| "isNot"
	| "empty"
	| "notEmpty"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "between";

export interface RowFilter {
	key: string;
	op: RowFilterOp;
	value?: string;
	value2?: string;
}

export type ArrangeSortDir = 1 | -1;

export interface ArrangeSort {
	key: string;
	dir: ArrangeSortDir;
}

/** Row-level presentation owned by one card; never part of the dataset key. */
export interface PresentationSpec {
	v: 1;
	group?: string;
	sort?: ArrangeSort;
	filters?: RowFilter[];
}

export const PRESENTATION_VERSION = 1;
const MAX_FILTERS = 20;

export const ROW_FILTER_OPS: RowFilterOp[] = [
	"contains",
	"notContains",
	"is",
	"isNot",
	"empty",
	"notEmpty",
	"gt",
	"gte",
	"lt",
	"lte",
	"between",
];

const TEXT_OPS: RowFilterOp[] = [
	"contains",
	"notContains",
	"is",
	"isNot",
	"empty",
	"notEmpty",
];

const NUMBER_OPS: RowFilterOp[] = [
	...TEXT_OPS,
	"gt",
	"gte",
	"lt",
	"lte",
	"between",
];

export function isRowFilterOp(value: unknown): value is RowFilterOp {
	return (
		typeof value === "string" &&
		(ROW_FILTER_OPS as readonly string[]).includes(value)
	);
}

/** Operators offered for a column type; text/path stay string-only. */
export function operatorsForColumn(type: DatasetColumn["type"]): RowFilterOp[] {
	return type === "text" || type === "path" ? TEXT_OPS : NUMBER_OPS;
}

/* -------------------------------------------------------------------------- */
/* Grouping catalogue (shared with the table view)                            */
/* -------------------------------------------------------------------------- */

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

/** Grouping dimensions offered for one dataset object (first entry is "none"). */
export function groupsForObject(object: DataObject): TableGroup[] {
	return [...(GROUPS_BY_OBJECT[object] ?? ["none"])];
}

export function groupLabelKey(group: TableGroup): string {
	return group === "none"
		? "TABLE_GROUP_NONE"
		: (GROUP_LABEL_KEYS[group] ?? "TABLE_GROUP_NONE");
}

/* -------------------------------------------------------------------------- */
/* Arrange column whitelist (shared by sort and filter pickers)                */
/* -------------------------------------------------------------------------- */

/** Default to every column and subtract only fields the object does not have. */
const EXCLUDED_ARRANGE_KEYS: Partial<Record<DataObject, readonly string[]>> = {
	note: ["tasks", "completed"], // notes have no completion state
	// task / file / folder / project keep every column (task.status included).
};

/** Columns offered by the sort/filter pickers for one dataset object. */
export function arrangeColumnsFor(
	object: DataObject,
	columns: readonly DatasetColumn[],
): DatasetColumn[] {
	const excluded = new Set(EXCLUDED_ARRANGE_KEYS[object] ?? []);
	return columns.filter((column) => !excluded.has(column.key));
}

export function sortColumnsForObject(
	object: DataObject,
	columns: readonly DatasetColumn[],
): DatasetColumn[] {
	return arrangeColumnsFor(object, columns);
}

export function filterColumnsForObject(
	object: DataObject,
	columns: readonly DatasetColumn[],
): DatasetColumn[] {
	return arrangeColumnsFor(object, columns);
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

/* -------------------------------------------------------------------------- */
/* Table helpers (re-exported by the table view to keep its surface stable)   */
/* -------------------------------------------------------------------------- */

/** Cell text or its target path matches, so alias labels stay searchable by file. */
export function matchesTableRow(row: DatasetRow, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return true;
	return Object.values(row.cells).some(
		(cell) =>
			(cell?.text ?? "").toLocaleLowerCase().includes(needle) ||
			(cell?.path ?? "").toLocaleLowerCase().includes(needle),
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
		const label = groupLabelOf(row, group);
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

/** Label a row contributes to one grouping dimension. */
export function groupLabelOf(row: DatasetRow, group: string): string {
	return row.cells[group]?.text ?? "—";
}

/* -------------------------------------------------------------------------- */
/* Parse / normalise / serialise                                              */
/* -------------------------------------------------------------------------- */

function rawString(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

/**
 * Reads one stored `options.arrange` value. Bad JSON, unknown versions and
 * malformed shapes fall back to an empty spec instead of throwing.
 */
export function parseArrange(raw: unknown): PresentationSpec {
	let value = raw;
	if (typeof raw === "string") {
		if (raw.trim().length === 0) return { v: PRESENTATION_VERSION };
		try {
			value = JSON.parse(raw);
		} catch {
			return { v: PRESENTATION_VERSION };
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { v: PRESENTATION_VERSION };
	}
	const record = value as Record<string, unknown>;
	if (record.v !== PRESENTATION_VERSION) return { v: PRESENTATION_VERSION };

	const spec: PresentationSpec = { v: PRESENTATION_VERSION };
	if (typeof record.group === "string" && record.group !== "none") {
		spec.group = record.group;
	}
	const sort = record.sort;
	if (sort && typeof sort === "object" && !Array.isArray(sort)) {
		const sortRecord = sort as Record<string, unknown>;
		const key = rawString(sortRecord.key);
		if (key) {
			spec.sort = { key, dir: sortRecord.dir === -1 ? -1 : 1 };
		}
	}
	if (Array.isArray(record.filters)) {
		const filters: RowFilter[] = [];
		for (const entry of record.filters) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
			const filterRecord = entry as Record<string, unknown>;
			const key = rawString(filterRecord.key);
			const op = filterRecord.op;
			if (!key || !isRowFilterOp(op)) continue;
			const filter: RowFilter = { key, op };
			const value = rawString(filterRecord.value);
			const value2 = rawString(filterRecord.value2);
			if (value !== undefined) filter.value = value;
			if (value2 !== undefined) filter.value2 = value2;
			filters.push(filter);
			if (filters.length >= MAX_FILTERS) break;
		}
		if (filters.length > 0) spec.filters = filters;
	}
	return spec;
}

/**
 * Trims a spec to what the current dataset/object can actually render:
 * unknown group dimensions, columns and operators are dropped silently.
 */
export function normalizeArrange(
	raw: unknown,
	columns: readonly DatasetColumn[],
	object: DataObject,
): PresentationSpec {
	const spec = parseArrange(raw);
	const byKey = new Map(columns.map((column) => [column.key, column]));
	const next: PresentationSpec = { v: PRESENTATION_VERSION };

	if (spec.group !== undefined) {
		const group = resolveGroupFor(object, spec.group);
		if (group !== "none") next.group = group;
	}
	if (spec.sort) {
		const column = byKey.get(spec.sort.key);
		if (column) next.sort = { key: column.key, dir: spec.sort.dir };
	}
	if (spec.filters && spec.filters.length > 0) {
		const filters: RowFilter[] = [];
		for (const filter of spec.filters) {
			const column = byKey.get(filter.key);
			if (!column) continue;
			if (!operatorsForColumn(column.type).includes(filter.op)) continue;
			filters.push({ ...filter });
		}
		if (filters.length > 0) next.filters = filters;
	}
	return next;
}

/** Compact storage form; `undefined` means "remove the arrange key". */
export function serializeArrange(spec: PresentationSpec): string | undefined {
	const compact: PresentationSpec = { v: PRESENTATION_VERSION };
	if (spec.group) compact.group = spec.group;
	if (spec.sort) compact.sort = { ...spec.sort };
	if (spec.filters && spec.filters.length > 0) {
		compact.filters = spec.filters.map((filter) => ({ ...filter }));
	}
	if (!compact.group && !compact.sort && !compact.filters) return undefined;
	return JSON.stringify(compact);
}

/** Whether a spec rules rows out (used for the toggle badge and empty state). */
export function arrangeFiltersActive(spec: PresentationSpec | undefined): boolean {
	return (spec?.filters?.length ?? 0) > 0;
}

export function sameFilters(
	left: readonly RowFilter[] | undefined,
	right: readonly RowFilter[] | undefined,
): boolean {
	return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* -------------------------------------------------------------------------- */

function isNumericColumn(column: DatasetColumn): boolean {
	return column.type !== "text" && column.type !== "path";
}

function numericCellValue(
	cell: DatasetCell | undefined,
	column: DatasetColumn,
): number | null {
	if (!cell) return null;
	if (typeof cell.sortValue === "number" && Number.isFinite(cell.sortValue)) {
		return cell.sortValue;
	}
	if (column.type === "date") {
		const parsed = Date.parse(cell.text);
		return Number.isFinite(parsed) ? parsed : null;
	}
	const parsed = Number(cell.sortValue ?? cell.text);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Unparseable bounds are ignored so a half-typed number never empties the list. */
function numericFilterValue(
	raw: string | undefined,
	column: DatasetColumn,
): number | null {
	const text = (raw ?? "").trim();
	if (text.length === 0) return null;
	const direct = Number(text);
	if (Number.isFinite(direct)) return direct;
	if (column.type === "date") {
		const parsed = Date.parse(text);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export function matchesRowFilter(
	row: DatasetRow,
	filter: RowFilter,
	columns: readonly DatasetColumn[],
): boolean {
	const column = columns.find((item) => item.key === filter.key);
	if (!column) return true;
	const cell = row.cells[filter.key];
	const text = (cell?.text ?? "").trim();

	if (filter.op === "empty") return text.length === 0;
	if (filter.op === "notEmpty") return text.length > 0;

	if (isNumericColumn(column)) {
		const value = numericCellValue(cell, column);
		const left = numericFilterValue(filter.value, column);
		const right = numericFilterValue(filter.value2, column);
		if (filter.op === "between") {
			if (left === null && right === null) return true;
			if (value === null) return false;
			if (left !== null && value < left) return false;
			if (right !== null && value > right) return false;
			return true;
		}
		if (left === null) return true;
		if (value === null) return false;
		switch (filter.op) {
			case "gt":
				return value > left;
			case "gte":
				return value >= left;
			case "lt":
				return value < left;
			case "lte":
				return value <= left;
			default:
				break;
		}
	}

	const haystack = text.toLocaleLowerCase();
	const needle = (filter.value ?? "").trim().toLocaleLowerCase();
	switch (filter.op) {
		case "contains":
			return needle.length === 0 || haystack.includes(needle);
		case "notContains":
			return needle.length === 0 || !haystack.includes(needle);
		case "is":
			return haystack === needle;
		case "isNot":
			return haystack !== needle;
		default:
			return true;
	}
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

export interface ArrangeSegment {
	group: string;
	label: string;
	/** Full filtered count of the segment (never reduced to the current page). */
	count: number;
	/** Offset of the first row inside the sorted, filtered result. */
	start: number;
}

export interface ApplyArrangeOptions {
	columns: readonly DatasetColumn[];
	/** Used when the spec carries no explicit sort. */
	defaultSort?: ArrangeSort;
}

function pathKeyOf(row: DatasetRow): string {
	return String(row.cells.note?.path ?? row.id);
}

function compareForSort(
	left: DatasetRow,
	right: DatasetRow,
	sort: ArrangeSort,
	columns: readonly DatasetColumn[],
): number {
	const column = columns.find((item) => item.key === sort.key);
	let primary = 0;
	if (column && isNumericColumn(column)) {
		const a = numericCellValue(left.cells[sort.key], column) ?? 0;
		const b = numericCellValue(right.cells[sort.key], column) ?? 0;
		primary = (a - b) * sort.dir;
	} else {
		primary = compareTableValues(
			sortValueOf(left, sort.key),
			sortValueOf(right, sort.key),
			sort.dir,
		);
	}
	if (primary !== 0) return primary;
	// Stable pagination: the path/id tie-break never flips direction.
	return pathKeyOf(left).localeCompare(pathKeyOf(right));
}

/**
 * Keyword filtering happens in the component; this applies field filters,
 * sorting, grouping and reports contiguous segments for headers and counts.
 */
export function applyArrange(
	rows: readonly DatasetRow[],
	spec: PresentationSpec,
	options: ApplyArrangeOptions,
): { rows: DatasetRow[]; segments: ArrangeSegment[] } {
	const filters = spec.filters ?? [];
	const filtered =
		filters.length === 0
			? [...rows]
			: rows.filter((row) =>
					filters.every((filter) =>
						matchesRowFilter(row, filter, options.columns),
					),
				);

	const sort = spec.sort ?? options.defaultSort;
	const ordered = sort
		? filtered.sort((a, b) => compareForSort(a, b, sort, options.columns))
		: filtered;

	const segments: ArrangeSegment[] = [];
	if (spec.group) {
		let current: ArrangeSegment | null = null;
		ordered.forEach((row, index) => {
			const label = groupLabelOf(row, spec.group as string);
			if (!current || current.label !== label) {
				current = {
					group: spec.group as string,
					label,
					count: 0,
					start: index,
				};
				segments.push(current);
			}
			current.count += 1;
		});
	}

	return { rows: ordered, segments };
}