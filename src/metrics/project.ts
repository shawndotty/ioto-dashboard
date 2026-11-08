import { folderProjectName, isInsideFolder, normalizeFolder } from "../data/note-source";
import type {
	IndexSnapshot,
	NoteRecord,
	ProjectRecord,
	TaskRecord,
} from "../data/types";

export interface ProjectInfo {
	key: string;
	name: string;
	folder: string;
}

function projectDisplayName(
	folder: string,
	records: ProjectRecord[],
): string {
	const record = records.find((item) => item.folder === folder);
	const name = record?.project ?? record?.name;
	return name && name.trim() ? name : folder.split("/").pop() ?? folder;
}

/**
 * The task-root project universe: direct sub-folders of the task root plus any
 * `_project.md`. Nested project notes are out of MVP scope.
 */
export function listProjectUniverse(
	snapshot: IndexSnapshot,
	taskFolder: string,
): ProjectInfo[] {
	const root = normalizeFolder(taskFolder);
	if (!root) return [];
	const keys = new Set<string>();
	for (const note of snapshot.notes) {
		if (!isInsideFolder(note.path, root)) continue;
		const relative = note.path.slice(root.length + 1);
		const segments = relative.split("/").filter((segment) => segment.length > 0);
		const key = segments[0];
		if (segments.length >= 2 && key) keys.add(key);
	}
	for (const record of snapshot.projects) {
		if (!isInsideFolder(record.path, root)) continue;
		const relative = record.path.slice(root.length + 1);
		const segments = relative.split("/").filter((segment) => segment.length > 0);
		const key = segments[0];
		if (segments.length >= 2 && key) keys.add(key);
	}
	return [...keys]
		.map((key) => {
			const folder = `${root}/${key}`;
			return {
				key,
				name: projectDisplayName(folder, snapshot.projects),
				folder,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Folder-first attribution for a note record (frontmatter already applied). */
export function resolveProjectName(
	note: NoteRecord,
	taskFolder: string,
): string | undefined {
	return note.project ?? folderProjectName(note.path, taskFolder);
}

export function projectTaskTotal(
	tasks: TaskRecord[],
	projectKey: string,
): number {
	return tasks.filter((task) => task.project === projectKey).length;
}
