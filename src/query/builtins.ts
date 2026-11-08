import { createDefaultFilterState } from "../data/saved-query-adapter";
import { DEFAULT_SCOPE_SECTIONS } from "../data/types";
import type { QueryDefinition } from "./types";

export const BUILTIN_TASKS_ALL = "builtin:tasks-all";
export const BUILTIN_NOTES_ALL = "builtin:notes-all";
export const BUILTIN_TASKS_UNFINISHED = "builtin:tasks-unfinished";

export const DEFAULT_QUERY_ID = BUILTIN_TASKS_ALL;

export function builtinQueries(): QueryDefinition[] {
	return [
		{
			id: BUILTIN_TASKS_ALL,
			name: "All tasks",
			nameKey: "QUERY_BUILTIN_TASKS_ALL",
			target: "task",
			scope: {
				folders: [],
				includeSubfolders: true,
				sections: [...DEFAULT_SCOPE_SECTIONS],
			},
			filters: createDefaultFilterState(),
		},
		{
			id: BUILTIN_TASKS_UNFINISHED,
			name: "Unfinished tasks",
			nameKey: "QUERY_BUILTIN_TASKS_UNFINISHED",
			target: "task",
			scope: {
				folders: [],
				includeSubfolders: true,
				sections: [...DEFAULT_SCOPE_SECTIONS],
			},
			filters: createDefaultFilterState({ status: "incomplete" }),
		},
		{
			id: BUILTIN_NOTES_ALL,
			name: "All notes",
			nameKey: "QUERY_BUILTIN_NOTES_ALL",
			target: "note",
			scope: { folders: [], includeSubfolders: true },
			filters: createDefaultFilterState(),
		},
	];
}
