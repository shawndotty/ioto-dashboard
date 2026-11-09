import { QUERY_TARGETS, type QueryDefinition, type QueryTarget } from "./types";

export type QuerySource = "builtin" | "saved" | "user";

export function querySourceOf(id: string): QuerySource | null {
	if (id.startsWith("builtin:")) return "builtin";
	if (id.startsWith("saved:")) return "saved";
	if (id.startsWith("user:")) return "user";
	return null;
}

/** Buckets queries by target without reordering `queries` inside a bucket. */
export function groupByTarget(
	queries: readonly QueryDefinition[],
): Record<QueryTarget, QueryDefinition[]> {
	const groups = {} as Record<QueryTarget, QueryDefinition[]>;
	for (const target of QUERY_TARGETS) groups[target] = [];
	for (const query of queries) groups[query.target].push(query);
	return groups;
}
