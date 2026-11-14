import type { QueryDefinition } from "../../query/types";
import type { DataObject } from "./types";

/** Query target → the data object a generic component should read. */
export function objectForQuery(
	query: QueryDefinition | undefined,
	fallback: DataObject = "task",
): DataObject {
	switch (query?.target) {
		case "note":
			return "note";
		case "file":
			return "file";
		case "folder":
			return "folder";
		case "task":
			return "task";
		default:
			return fallback;
	}
}

/**
 * Bar charts aggregate task/note queries per project; only file/folder queries
 * keep their own object. Do not replace this with `objectForQuery`, or task bars
 * degrade from project aggregation to raw task rows.
 */
export function barObjectForQuery(
	query: QueryDefinition | undefined,
	fallback: DataObject = "project",
): DataObject {
	switch (query?.target) {
		case "file":
			return "file";
		case "folder":
			return "folder";
		default:
			return fallback;
	}
}

/**
 * Scatter charts plot one record per row. Task queries have no numeric detail
 * columns, so they fall back to per-project aggregation like bar/pie charts.
 */
export function scatterObjectForQuery(
	query: QueryDefinition | undefined,
	fallback: DataObject = "project",
): DataObject {
	switch (query?.target) {
		case "note":
			return "note";
		case "folder":
			return "folder";
		case "file":
			return "file";
		default:
			return fallback;
	}
}

/**
 * Treemap object mapping. Task queries have no numeric detail columns, so they
 * aggregate per project. Notes can either stay per-record (folder grouping) or
 * aggregate per project, following the bar/pie convention.
 */
export function treemapObjectForQuery(
	query: QueryDefinition | undefined,
	options?: Record<string, unknown>,
): DataObject {
	switch (query?.target) {
		case "note":
			return options?.noteGroupBy === "project" ? "project" : "note";
		case "file":
			return "file";
		case "folder":
			return "folder";
		default:
			return "project";
	}
}

/** Field-picker object mapping; unknown component types read the query object. */
export function objectForComponentType(
	type: string | undefined,
	query: QueryDefinition | undefined,
	options?: Record<string, unknown>,
): DataObject {
	if (type === "treemap-chart") return treemapObjectForQuery(query, options);
	if (type === "bar-chart" || type === "pie-chart" || type === "donut-chart") {
		return barObjectForQuery(query);
	}
	if (type === "scatter-chart") return scatterObjectForQuery(query);
	return objectForQuery(query);
}
