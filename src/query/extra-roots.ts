import { isInsideFolder, normalizeFolder } from "../data/note-source";
import type { IndexConfig } from "../data/types";
import type { QueryDefinition } from "./types";

/** Upper bound for folders indexed on demand in one refresh. */
export const MAX_EXTRA_ROOTS = 20;

/** The four framework roots, normalized and without empty entries. */
export function baseRoots(config: IndexConfig): string[] {
	return [
		config.inputFolder,
		config.outputFolder,
		config.taskFolder,
		config.outcomeFolder,
	]
		.map((root) => normalizeFolder(root))
		.filter((root) => root.length > 0);
}

/**
 * Normalizes, de-duplicates and narrows the requested extra roots: paths that
 * already live under a framework root are dropped, and nested paths collapse
 * into their outermost ancestor.
 */
export function normalizeExtraRoots(
	roots: string[],
	config: IndexConfig,
): string[] {
	const bases = baseRoots(config);
	const unique = new Set<string>();
	for (const raw of roots) {
		const root = normalizeFolder(raw.trim());
		if (root.length === 0) continue;
		if (bases.some((base) => isInsideFolder(root, base))) continue;
		unique.add(root);
	}
	const candidates = [...unique].sort();
	const kept = candidates.filter(
		(root) =>
			!candidates.some(
				(other) => other !== root && isInsideFolder(root, other),
			),
	);
	if (kept.length > MAX_EXTRA_ROOTS) {
		console.warn("IOTO Dashboard: extra query roots capped at 20");
		return kept.slice(0, MAX_EXTRA_ROOTS);
	}
	return kept;
}

/** Extra roots referenced by the current query set; empty folders contribute none. */
export function collectExtraRoots(
	queries: QueryDefinition[],
	config: IndexConfig,
): string[] {
	const roots: string[] = [];
	for (const query of queries) {
		// Persisted queries are only shape-checked at the top level.
		const scope: { folders?: unknown } = query.scope;
		if (!Array.isArray(scope.folders)) continue;
		for (const folder of scope.folders) {
			if (typeof folder === "string") roots.push(folder);
		}
	}
	return normalizeExtraRoots(roots, config);
}
