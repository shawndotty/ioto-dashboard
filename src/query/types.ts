import type {
	FilterState,
	IoType,
	NoteRecord,
	SectionRole,
	TaskRecord,
} from "../data/types";

export type QueryTarget = "note" | "task";

/**
 * "What to query". Sorting / grouping / paging belong to the presentation
 * layer and must never be stored here.
 */
export interface QueryScope {
	/** Vault-absolute folders; empty = the target's default root. */
	folders: string[];
	includeSubfolders: boolean;
	ioTypes?: IoType[];
	sections?: SectionRole[];
}

export interface QueryDefinition {
	/** `builtin:*` / `saved:*` / `user:*`. */
	id: string;
	/** Human-readable name; `nameKey` wins when present (i18n). */
	name: string;
	nameKey?: string;
	target: QueryTarget;
	scope: QueryScope;
	filters: FilterState;
}

/** Full result set: never sorted, grouped or paginated here. */
export interface QueryResolution {
	notes: NoteRecord[];
	tasks: TaskRecord[];
}
