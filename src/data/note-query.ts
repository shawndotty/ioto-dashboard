import type {
	CustomFilterDef,
	FilterState,
	IoType,
	NoteRecord,
} from "./types";
import { folderOf, isInsideFolder, normalizeFolder, toText } from "./note-source";

export interface NoteQueryScope {
	paths?: string[];
	includeSubfolders?: boolean;
	ioTypes?: IoType[];
}

export function matchesName(text: string, filter: string): boolean {
	if (!filter) return true;
	return text.toLowerCase().includes(filter.toLowerCase());
}

export function matchesDate(
	ctime: number,
	mtime: number,
	filters: FilterState,
	now: number = Date.now(),
): boolean {
	const value = filters.dateType === "created" ? ctime : mtime;
	const date = new Date(value);

	if (filters.datePreset !== "all" && filters.datePreset !== "custom") {
		let days = 0;
		if (filters.datePreset === "last3days") days = 3;
		else if (filters.datePreset === "last1day") days = 1;
		else if (filters.datePreset === "last7days") days = 7;
		else if (filters.datePreset === "last14days") days = 14;
		else if (filters.datePreset === "last30days") days = 30;

		const startDate = new Date(now);
		startDate.setDate(startDate.getDate() - days);
		startDate.setHours(0, 0, 0, 0);
		if (date < startDate) return false;
	} else if (filters.datePreset === "custom") {
		if (filters.dateStart) {
			const startDate = new Date(filters.dateStart);
			if (date < startDate) return false;
		}
		if (filters.dateEnd) {
			const endDate = new Date(filters.dateEnd);
			endDate.setHours(23, 59, 59, 999);
			if (date > endDate) return false;
		}
	}
	return true;
}

export function matchesCustomFilters(
	frontmatter: Record<string, unknown> | undefined,
	filters: FilterState,
	defs: CustomFilterDef[],
	target: "note" | "task",
): boolean {
	if (defs.length === 0 || !filters.custom) return true;
	for (const def of defs) {
		const defTarget = def.target ?? "all";
		if (defTarget !== "all" && defTarget !== target) continue;

		const filterValue = filters.custom[def.name];
		if (
			filterValue === undefined ||
			filterValue === "" ||
			filterValue === "all"
		) {
			continue;
		}

		const fileValue = frontmatter?.[def.name];
		if (def.type === "text" || def.type === "list") {
			const fileText = toText(fileValue) ?? "";
			const filterText = toText(filterValue) ?? "";
			if (!fileText || !fileText.toLowerCase().includes(filterText.toLowerCase())) {
				return false;
			}
		} else if (def.type === "number") {
			if (fileValue === undefined) return false;
			if (Number(fileValue) !== Number(filterValue)) return false;
		} else if (def.type === "boolean") {
			const expected = filterValue === "true";
			const actual =
				fileValue === true ||
				fileValue === "true" ||
				fileValue === "True";
			if (actual !== expected) return false;
		} else if (def.type === "date") {
			if (!fileValue) return false;
			if (toText(fileValue) !== toText(filterValue)) return false;
		}
	}
	return true;
}

export function matchesSubject(
	subject: string | string[] | undefined,
	filter: string,
): boolean {
	if (!filter) return true;
	if (Array.isArray(subject)) {
		return subject.some((item) =>
			item.toLowerCase().includes(filter.toLowerCase()),
		);
	}
	return Boolean(
		subject && subject.toLowerCase().includes(filter.toLowerCase()),
	);
}

function inScopePaths(path: string, scope: NoteQueryScope): boolean {
	const paths = (scope.paths ?? [])
		.map((item) => normalizeFolder(item))
		.filter((item) => item.length > 0);
	if (paths.length === 0) return true;
	const includeSubfolders = scope.includeSubfolders ?? true;
	return paths.some((root) =>
		includeSubfolders
			? isInsideFolder(path, root)
			: folderOf(path) === root,
	);
}

export function queryNotes(
	notes: NoteRecord[],
	filters: FilterState,
	customFilters: CustomFilterDef[] = [],
	scope: NoteQueryScope = {},
	now: number = Date.now(),
): NoteRecord[] {
	const noteTypes = filters.noteType ?? [];
	const typeFilterActive = noteTypes.length > 0;
	const scopeTypes = scope.ioTypes ?? [];
	return notes.filter((note) => {
		if (!inScopePaths(note.path, scope)) return false;
		if (scopeTypes.length > 0 && !scopeTypes.includes(note.ioType)) return false;
		if (typeFilterActive && !noteTypes.includes(note.ioType)) return false;
		if (!matchesName(note.basename, filters.name)) return false;
		if (filters.project) {
			if (
				!note.project ||
				!note.project
					.toLowerCase()
					.includes(filters.project.toLowerCase())
			) {
				return false;
			}
		}
		if (!matchesSubject(note.subject, filters.subject)) return false;
		if (filters.fileStatus) {
			if (
				!note.status ||
				!note.status
					.toLowerCase()
					.includes(filters.fileStatus.toLowerCase())
			) {
				return false;
			}
		}
		if (!matchesDate(note.ctime, note.mtime, filters, now)) return false;
		if (
			!matchesCustomFilters(
				note.frontmatter,
				filters,
				customFilters,
				"note",
			)
		) {
			return false;
		}
		return true;
	});
}
