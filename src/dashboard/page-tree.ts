import type { DashboardPage } from "./types";

export interface PageGroup {
	page: DashboardPage;
	children: DashboardPage[];
}

function topLevelIds(pages: readonly DashboardPage[]): Set<string> {
	const ids = new Set<string>();
	for (const page of pages) {
		if (!page.parentId) ids.add(page.id);
	}
	return ids;
}

/** Drops illegal `parentId`s (I1/I2) and regroups into I3 order. Idempotent. */
export function normalizePageTree(pages: DashboardPage[]): DashboardPage[] {
	const seen = new Set<string>();
	const unique: DashboardPage[] = [];
	for (const page of pages) {
		if (seen.has(page.id)) continue;
		seen.add(page.id);
		unique.push(page);
	}

	// Snapshot the original parents so chains (a→b→c) resolve deterministically.
	const rawParents = new Map<string, string>();
	for (const page of unique) {
		if (typeof page.parentId === "string" && page.parentId.length > 0) {
			rawParents.set(page.id, page.parentId);
		}
	}
	const topIds = topLevelIds(
		unique.filter((page) => !rawParents.has(page.id)),
	);
	const validParent = (pageId: string): string | undefined => {
		const parentId = rawParents.get(pageId);
		if (!parentId || parentId === pageId) return undefined;
		return topIds.has(parentId) ? parentId : undefined;
	};

	const children = new Map<string, DashboardPage[]>();
	const tops: DashboardPage[] = [];
	for (const page of unique) {
		const parentId = validParent(page.id);
		if (parentId === undefined) {
			delete page.parentId;
			tops.push(page);
			continue;
		}
		page.parentId = parentId;
		const list = children.get(parentId);
		if (list) list.push(page);
		else children.set(parentId, [page]);
	}
	const result: DashboardPage[] = [];
	for (const page of tops) {
		result.push(page, ...(children.get(page.id) ?? []));
	}
	return result;
}

export function groupsOf(pages: readonly DashboardPage[]): PageGroup[] {
	const groups: PageGroup[] = [];
	const byId = new Map<string, PageGroup>();
	for (const page of pages) {
		if (page.parentId) continue;
		const group: PageGroup = { page, children: [] };
		groups.push(group);
		byId.set(page.id, group);
	}
	for (const page of pages) {
		const parentId = page.parentId;
		if (!parentId) continue;
		byId.get(parentId)?.children.push(page);
	}
	return groups;
}

export function groupOf(
	pages: readonly DashboardPage[],
	pageId: string,
): PageGroup | null {
	for (const group of groupsOf(pages)) {
		if (group.page.id === pageId) return group;
		for (const child of group.children) {
			if (child.id === pageId) return group;
		}
	}
	return null;
}

/** Pages under `pageId` in I3 order (excludes the page itself). */
export function descendantsOf(
	pages: readonly DashboardPage[],
	pageId: string,
): DashboardPage[] {
	const out: DashboardPage[] = [];
	const collect = (id: string): void => {
		for (const page of pages) {
			if (page.parentId !== id) continue;
			out.push(page);
			collect(page.id);
		}
	};
	collect(pageId);
	return out;
}

/** Top page → [self]; subpage → [parent, self]. */
export function pagePath(
	pages: readonly DashboardPage[],
	pageId: string,
): DashboardPage[] {
	const page = pages.find((item) => item.id === pageId);
	if (!page) return [];
	if (!page.parentId) return [page];
	const parent = pages.find((item) => item.id === page.parentId);
	return parent ? [parent, page] : [page];
}

/** Flat index (any page) ↔ group index (top-level pages only). */
export function groupIndexAt(
	pages: readonly DashboardPage[],
	flatIndex: number,
): number {
	const page = pages[flatIndex];
	if (!page) return -1;
	if (!page.parentId) {
		let index = 0;
		for (let cursor = 0; cursor < flatIndex; cursor += 1) {
			if (!pages[cursor]?.parentId) index += 1;
		}
		return index;
	}
	const parentIndex = pages.findIndex((item) => item.id === page.parentId);
	return parentIndex < 0 ? -1 : groupIndexAt(pages, parentIndex);
}

export function flatIndexForGroup(
	pages: readonly DashboardPage[],
	groupIndex: number,
): number {
	let index = 0;
	for (let cursor = 0; cursor < pages.length; cursor += 1) {
		if (pages[cursor]?.parentId) continue;
		if (index === groupIndex) return cursor;
		index += 1;
	}
	return -1;
}
