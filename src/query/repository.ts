import type { FolderRoots } from "../data/note-source";
import {
	createDefaultFilterState,
	savedQueryToFilterState,
} from "../data/saved-query-adapter";
import type { FilterState } from "../data/types";
import { builtinQueries } from "./builtins";
import type { QueryDefinition, QueryTarget } from "./types";

/** Structural view of `settings.SavedQuery`; the query layer must not import settings. */
export interface SavedQuerySource {
	id: string;
	name: string;
	category: "Input" | "Output" | "Outcome" | "Tasks" | "Notes";
	tab: "Notes" | "Tasks";
	type?: string;
	filters: Partial<FilterState>;
}

export function savedQueryToDefinition(
	query: SavedQuerySource,
	roots: FolderRoots,
): QueryDefinition {
	const target: QueryTarget = query.tab === "Tasks" ? "task" : "note";
	const folders = foldersForCategory(query.category, roots);
	const filters = savedQueryToFilterState(query);
	if (query.type && query.type !== "all") {
		if (target === "note") filters.noteType = [query.type];
		else filters.taskType = [query.type];
	}
	return {
		id: `saved:${query.id}`,
		name: query.name,
		target,
		scope: { folders, includeSubfolders: true },
		filters,
	};
}

function foldersForCategory(
	category: SavedQuerySource["category"],
	roots: FolderRoots,
): string[] {
	switch (category) {
		case "Input":
			return [roots.inputFolder];
		case "Output":
			return [roots.outputFolder];
		case "Outcome":
			return [roots.outcomeFolder];
		case "Tasks":
			return [roots.taskFolder];
		default:
			return [];
	}
}

/** User queries are persisted by `DashboardRepository`; this class only reads them. */
export class QueryRepository {
	private builtins = builtinQueries();
	private saved: QueryDefinition[];
	private user: QueryDefinition[];

	constructor(
		savedQueries: SavedQuerySource[],
		userQueries: QueryDefinition[],
		roots: FolderRoots,
	) {
		this.saved = savedQueries.map((query) =>
			savedQueryToDefinition(query, roots),
		);
		this.user = [...userQueries];
	}

	list(): QueryDefinition[] {
		return [...this.builtins, ...this.saved, ...this.user];
	}

	get(id: string): QueryDefinition | undefined {
		return this.list().find((query) => query.id === id);
	}

	byTarget(target: QueryTarget): QueryDefinition[] {
		return this.list().filter((query) => query.target === target);
	}

	defaultFor(target: QueryTarget): QueryDefinition | undefined {
		return this.list().find((query) => query.target === target);
	}

	static emptyFilters(): FilterState {
		return createDefaultFilterState();
	}
}
