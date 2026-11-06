import type { FilterState, SavedQueryLike } from "./types";

export function createDefaultFilterState(
	overrides: Partial<FilterState> = {},
): FilterState {
	const { custom, ...rest } = overrides;
	return {
		name: "",
		project: "",
		subject: "",
		dateType: "created",
		dateStart: "",
		dateEnd: "",
		datePreset: "all",
		status: "all",
		fileStatus: "",
		taskType: [],
		noteType: [],
		...rest,
		custom: { ...(custom ?? {}) },
	};
}

/** Read-only adapter: SavedQuery is never handed to the data layer directly. */
export function savedQueryToFilterState(query: SavedQueryLike): FilterState {
	return createDefaultFilterState(query.filters);
}
