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
