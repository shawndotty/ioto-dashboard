import {
	DEFAULT_SCOPE_SECTIONS,
	type IoType,
	type NoteFacets,
	type NoteRecord,
	type TaskRecord,
} from "./types";

export interface FolderRoots {
	inputFolder: string;
	outputFolder: string;
	taskFolder: string;
	outcomeFolder: string;
}

export function normalizeFolder(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isInsideFolder(path: string, folder: string): boolean {
	const root = normalizeFolder(folder);
	if (!root) return false;
	if (root === "/") return true;
	return path === root || path.startsWith(`${root}/`);
}

export function resolveIoType(path: string, roots: FolderRoots): IoType {
	if (isInsideFolder(path, roots.taskFolder)) return "Task";
	if (isInsideFolder(path, roots.inputFolder)) return "Input";
	if (isInsideFolder(path, roots.outputFolder)) return "Output";
	if (isInsideFolder(path, roots.outcomeFolder)) return "Outcome";
	return "Unknown";
}

export function folderOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

/**
 * Folder-first project attribution: `3-任务/<Project>/...` belongs to
 * `<Project>` even without a `Project` frontmatter. Files directly under the
 * task root — and every path outside it — have no folder project.
 */
export function folderProjectName(
	path: string,
	taskFolder: string,
): string | undefined {
	const root = normalizeFolder(taskFolder);
	if (!root || !isInsideFolder(path, root) || path === root) return undefined;
	const relative = path.slice(root.length + 1);
	const segments = relative.split("/").filter((segment) => segment.length > 0);
	if (segments.length < 2) return undefined;
	const project = segments[0]?.trim();
	return project ? project : undefined;
}

export function readFrontmatterValue(
	frontmatter: Record<string, unknown> | undefined,
	...keys: string[]
): unknown {
	if (!frontmatter) return undefined;
	for (const key of keys) {
		if (key in frontmatter) return frontmatter[key];
	}
	return undefined;
}

/** Stringify only primitives; never fall back to `[object Object]`. */
export function toText(value: unknown): string | undefined {
	if (value === null || value === undefined) return undefined;
	if (typeof value === "string") {
		const text = value.trim();
		return text ? text : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}
	if (Array.isArray(value)) {
		const parts = value
			.map((item) => toText(item))
			.filter((item): item is string => Boolean(item));
		return parts.length > 0 ? parts.join(", ") : undefined;
	}
	return undefined;
}

function toProjectValue(value: unknown): string | undefined {
	return toText(value);
}

function toSubjectValue(value: unknown): string | string[] | undefined {
	if (Array.isArray(value)) {
		const list = value
			.map((item) => toText(item))
			.filter((item): item is string => Boolean(item));
		return list.length > 0 ? list : undefined;
	}
	return toText(value);
}

export interface NoteMetaInput {
	path: string;
	basename: string;
	ctime: number;
	mtime: number;
	size: number;
	ioType: IoType;
	frontmatter?: Record<string, unknown>;
	/** Folder-first project attribution; frontmatter `Project` still wins. */
	projectOverride?: string;
}

export function buildNoteRecord(
	meta: NoteMetaInput,
	tasks: TaskRecord[],
	sectionRoles: string[] = DEFAULT_SCOPE_SECTIONS,
): NoteRecord {
	const frontmatter = meta.frontmatter;
	const project =
		toProjectValue(readFrontmatterValue(frontmatter, "Project", "project")) ??
		meta.projectOverride;
	const subject = toSubjectValue(
		readFrontmatterValue(frontmatter, "Subject", "subject"),
	);
	const status = toProjectValue(
		readFrontmatterValue(frontmatter, "Status", "status"),
	);
	const sectionTasks = tasks.filter((task) =>
		sectionRoles.includes(task.sectionRole),
	);
	return {
		path: meta.path,
		basename: meta.basename,
		folder: folderOf(meta.path),
		ioType: meta.ioType,
		project,
		subject,
		status,
		ctime: meta.ctime,
		mtime: meta.mtime,
		size: meta.size,
		fileTaskCount: tasks.length,
		fileCompletedCount: tasks.filter((task) => task.isCompleted).length,
		sectionTaskCount: sectionTasks.length,
		sectionCompletedCount: sectionTasks.filter((task) => task.isCompleted)
			.length,
		frontmatter,
	};
}

export function collectFacets(notes: NoteRecord[]): NoteFacets {
	const projects = new Set<string>();
	const statuses = new Set<string>();
	const subjects = new Set<string>();
	for (const note of notes) {
		if (note.project) projects.add(note.project);
		if (note.status) statuses.add(note.status);
		if (Array.isArray(note.subject)) {
			note.subject.forEach((subject) => subjects.add(subject));
		} else if (note.subject) {
			subjects.add(note.subject);
		}
	}
	return {
		projects: Array.from(projects).sort(),
		statuses: Array.from(statuses).sort(),
		subjects: Array.from(subjects).sort(),
	};
}
