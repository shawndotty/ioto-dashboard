import type { FileRecord, FolderRecord } from "./types";

/** Minimal shape of an Obsidian `TFile` needed to build a record. */
export interface SourceFileLike {
	path: string;
	basename: string;
	extension: string;
	size: number;
	ctime: number;
	mtime: number;
}

export function folderPathOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

export function fileRecords(files: SourceFileLike[]): FileRecord[] {
	return files
		.map((file) => ({
			path: file.path,
			basename: file.basename,
			extension: file.extension,
			folder: folderPathOf(file.path),
			size: file.size,
			ctime: file.ctime,
			mtime: file.mtime,
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
}

function nameOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? path : path.slice(index + 1);
}

function depthOf(path: string): number {
	return path.split("/").filter((segment) => segment.length > 0).length;
}

/** Ancestors of a folder, nearest first, ending with the top-level root. */
function ancestorsOf(folder: string): string[] {
	const result: string[] = [];
	let current = folder;
	while (current.length > 0) {
		result.push(current);
		const index = current.lastIndexOf("/");
		current = index === -1 ? "" : current.slice(0, index);
	}
	return result;
}

/**
 * Bottom-up aggregation over an already-collected tree. Pure: the caller owns
 * traversal, so this stays unit-testable without an Obsidian vault.
 */
export function folderRecords(
	files: FileRecord[],
	folderPaths: string[],
): FolderRecord[] {
	const records = new Map<string, FolderRecord>();
	const ensure = (path: string): FolderRecord => {
		let record = records.get(path);
		if (!record) {
			record = {
				path,
				name: nameOf(path),
				depth: depthOf(path),
				directFiles: 0,
				directFolders: 0,
				fileCount: 0,
				noteCount: 0,
				totalSize: 0,
				latestMtime: 0,
			};
			records.set(path, record);
		}
		return record;
	};

	for (const folder of folderPaths) {
		if (folder.length === 0) continue;
		ensure(folder);
	}

	const directFolders = new Map<string, Set<string>>();
	for (const folder of records.keys()) {
		const parent = folderPathOf(folder);
		if (parent.length === 0) continue;
		const siblings = directFolders.get(parent) ?? new Set<string>();
		siblings.add(folder);
		directFolders.set(parent, siblings);
	}
	for (const [parent, children] of directFolders) {
		ensure(parent).directFolders = children.size;
	}

	for (const file of files) {
		const direct = records.get(file.folder);
		if (direct) direct.directFiles += 1;
		const isNote = file.extension === "md";
		for (const ancestor of ancestorsOf(file.folder)) {
			const record = ensure(ancestor);
			record.fileCount += 1;
			record.totalSize += file.size;
			record.latestMtime = Math.max(record.latestMtime, file.mtime);
			if (isNote) record.noteCount += 1;
		}
	}

	return [...records.values()].sort((a, b) => a.path.localeCompare(b.path));
}
