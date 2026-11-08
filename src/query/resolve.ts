import type { CustomFilterDef, IndexSnapshot, SectionRole } from "../data/types";
import { queryNotes } from "../data/note-query";
import { queryTasks } from "../data/task-query";
import type { QueryDefinition, QueryResolution } from "./types";

export interface ResolveOptions {
	/** Metric layer override (e.g. `basis: "file"` needs every section). */
	sections?: SectionRole[];
	customFilters?: CustomFilterDef[];
	/** Injectable clock for date-preset filters (tests). */
	now?: () => number;
}

/**
 * Resolves a query into full note/task sets. Ordering, grouping and paging are
 * deliberately left to the presentation layer.
 */
export function resolveQuery(
	snapshot: IndexSnapshot,
	query: QueryDefinition,
	options: ResolveOptions = {},
): QueryResolution {
	const paths = query.scope.folders;
	if (query.target === "note") {
		const notes = queryNotes(
			snapshot.notes,
			query.filters,
			options.customFilters ?? [],
			{
				paths,
				includeSubfolders: query.scope.includeSubfolders,
				ioTypes: query.scope.ioTypes,
			},
			options.now?.() ?? Date.now(),
		);
		return { notes, tasks: [] };
	}

	const sections =
		options.sections ?? query.scope.sections ?? ["task", "input", "output", "outcome"];
	const tasks = queryTasks(
		snapshot.tasks,
		query.filters,
		{
			folders: paths.length > 0 ? "all" : "task",
			sections,
			includeEmptyText: false,
			includePlaceholders: false,
			paths,
			includeSubfolders: query.scope.includeSubfolders,
		},
		options.customFilters ?? [],
		options.now?.() ?? Date.now(),
	);
	return { notes: [], tasks };
}
