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
