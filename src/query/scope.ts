import { isInsideFolder, normalizeFolder } from "../data/note-source";

/** Normalizes, drops empty entries and de-duplicates, keeping first-seen order. */
export function normalizeScopeFolders(folders: string[]): string[] {
	const seen = new Set<string>();
	for (const raw of folders) {
		const path = normalizeFolder(raw.trim());
		if (path.length === 0) continue;
		seen.add(path);
	}
	return [...seen];
}

export function addScopeFolder(folders: string[], raw: string): string[] {
	return normalizeScopeFolders([...folders, raw]);
}

export function removeScopeFolderAt(
	folders: string[],
	index: number,
): string[] {
	if (index < 0 || index >= folders.length) return [...folders];
	return folders.filter((_, itemIndex) => itemIndex !== index);
}

/** An empty raw value removes the row; editing into a duplicate drops the row. */
export function replaceScopeFolderAt(
	folders: string[],
	index: number,
	raw: string,
): string[] {
	const path = normalizeFolder(raw.trim());
	if (path.length === 0) return removeScopeFolderAt(folders, index);
	if (index < 0 || index >= folders.length) return addScopeFolder(folders, path);
	const next = folders.map((item, itemIndex) =>
		itemIndex === index ? path : item,
	);
	return normalizeScopeFolders(next);
}

/** Parent/child pairs do not overlap when subfolders are excluded. */
export function findRedundantFolders(
	folders: string[],
	includeSubfolders: boolean,
): string[] {
	if (!includeSubfolders) return [];
	const unique = normalizeScopeFolders(folders);
	return unique.filter((path) =>
		unique.some((other) => other !== path && isInsideFolder(path, other)),
	);
}

/** First ancestor covering the path, for the inline "already covered" hint. */
export function findCoveringFolder(
	folders: string[],
	path: string,
): string | undefined {
	const target = normalizeFolder(path.trim());
	return normalizeScopeFolders(folders).find(
		(other) => other !== target && isInsideFolder(target, other),
	);
}
