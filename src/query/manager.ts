import { QUERY_TARGETS, type QueryDefinition, type QueryTarget } from "./types";

export type QuerySource = "builtin" | "saved" | "user";

/** Translation keys; resolved by the UI layer, which owns `t()`. */
export const TARGET_LABEL_KEYS = {
	task: "QUERY_TARGET_TASK",
	note: "QUERY_TARGET_NOTE",
	file: "QUERY_TARGET_FILE",
	folder: "QUERY_TARGET_FOLDER",
} as const;

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

export function firstQueryOfTarget(
	queries: readonly QueryDefinition[],
	target: QueryTarget,
): QueryDefinition | undefined {
	return groupByTarget(queries)[target][0];
}

export interface QueryPickerState {
	/** Buckets to show, in `QUERY_TARGETS` order; legacy targets trail at the end. */
	targets: QueryTarget[];
	activeTarget: QueryTarget;
	current: QueryDefinition | undefined;
	groups: Record<QueryTarget, QueryDefinition[]>;
	/** The current value exists but this component cannot consume its type. */
	legacy: boolean;
	/** The current `queryId` no longer exists. */
	missing: boolean;
	needsTypeSelect: boolean;
}

/**
 * Resolves which buckets and value the inspector's query picker should show.
 * The type dropdown is derived from the stored `queryId`, never kept as state.
 */
export function resolveQueryPicker(
	allowed: readonly QueryTarget[],
	queries: readonly QueryDefinition[],
	queryId: string,
	remembered?: QueryTarget | null,
): QueryPickerState {
	const groups = groupByTarget(queries);
	const current = queries.find((query) => query.id === queryId);
	const supported =
		allowed.length > 0 ? allowed : [...QUERY_TARGETS];
	const legacy = current !== undefined && !supported.includes(current.target);

	const targets = QUERY_TARGETS.filter((target) => supported.includes(target));
	if (legacy && !targets.includes(current.target)) {
		targets.push(current.target);
	}

	const activeTarget =
		current?.target ??
		(remembered && targets.includes(remembered) ? remembered : undefined) ??
		targets.find((target) => groups[target].length > 0) ??
		targets[0] ??
		"task";

	return {
		targets,
		activeTarget,
		current,
		groups,
		legacy,
		missing: current === undefined,
		needsTypeSelect: targets.length > 1,
	};
}
