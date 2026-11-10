import type { CustomFilterDef, IndexSnapshot, SectionRole } from "../data/types";
import {
	matchesFileExtension,
	normalizeExtensions,
} from "../data/file-extensions";
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
	if (query.target === "file" || query.target === "folder") {
		return resolveTreeQuery(snapshot, query);
	}
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

function inFolderScope(
	folder: string,
	paths: string[],
	includeSubfolders: boolean,
): boolean {
	if (paths.length === 0) return true;
	return paths.some((path) =>
		includeSubfolders
			? folder === path || folder.startsWith(`${path}/`)
			: folder === path,
	);
}

function matchesName(name: string, filter: string): boolean {
	const needle = filter.trim().toLowerCase();
	return needle.length === 0 || name.toLowerCase().includes(needle);
}

/** `file` / `folder` targets read the optional tree records from the snapshot. */
function resolveTreeQuery(
	snapshot: IndexSnapshot,
	query: QueryDefinition,
): QueryResolution {
	const paths = query.scope.folders;
	const includeSubfolders = query.scope.includeSubfolders ?? true;
	if (query.target === "file") {
		const extensions = normalizeExtensions(query.scope.extensions);
		const files = (snapshot.files ?? []).filter(
			(file) =>
				inFolderScope(file.folder, paths, includeSubfolders) &&
				matchesName(file.basename, query.filters.name) &&
				matchesFileExtension(file.extension, extensions),
		);
		return { notes: [], tasks: [], files };
	}
	const folders = (snapshot.folders ?? []).filter(
		(folder) =>
			inFolderScope(folder.path, paths, includeSubfolders) &&
			matchesName(folder.name, query.filters.name),
	);
	return { notes: [], tasks: [], folders };
}
