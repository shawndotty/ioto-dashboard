import type { FilterState, SavedQueryLike } from "./types";
import { normalizeDatePreset } from "./date-presets";

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
		status: "all",
		fileStatus: "",
		taskType: [],
		noteType: [],
		...rest,
		datePreset: normalizeDatePreset(rest.datePreset),
		custom: { ...(custom ?? {}) },
	};
}

/** Read-only adapter: SavedQuery is never handed to the data layer directly. */
export function savedQueryToFilterState(query: SavedQueryLike): FilterState {
	return createDefaultFilterState(query.filters);
}
