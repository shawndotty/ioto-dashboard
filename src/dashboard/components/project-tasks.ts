import type { TaskMarker } from "../../data/types";
import type {
	ProjectPendingCounts,
	ProjectPendingTask,
} from "../../metrics/types";

export interface PendingNoteGroup {
	path: string;
	basename: string;
	noteMtime: number;
	items: ProjectPendingTask[];
}

export type MarkerBadgeKey =
	| "PROJECT_TASKS_BADGE_IN_PROGRESS"
	| "PROJECT_TASKS_BADGE_FORWARDED"
	| "PROJECT_TASKS_BADGE_OTHER";

export type PendingChipKey =
	| "PROJECT_TASKS_OPEN"
	| "PROJECT_TASKS_IN_PROGRESS"
	| "PROJECT_TASKS_FORWARDED"
	| "PROJECT_TASKS_OTHER";

export interface PendingChip {
	key: PendingChipKey;
	count: number;
}

export function markerChar(marker: TaskMarker): string {
	switch (marker) {
		case "in-progress":
			return "/";
		case "forwarded":
			return ">";
		case "other":
		case "done":
		case "cancelled":
			return "?";
		default:
			return " ";
	}
}

export function markerBadgeKey(marker: TaskMarker): MarkerBadgeKey | null {
	switch (marker) {
		case "in-progress":
			return "PROJECT_TASKS_BADGE_IN_PROGRESS";
		case "forwarded":
			return "PROJECT_TASKS_BADGE_FORWARDED";
		case "open":
			return null;
		default:
			return "PROJECT_TASKS_BADGE_OTHER";
	}
}

/** Cancelled tasks never reach the chips; they are reported in the footer instead. */
export function visibleChips(counts: ProjectPendingCounts): PendingChip[] {
	const entries: PendingChip[] = [
		{ key: "PROJECT_TASKS_OPEN", count: counts.open },
		{ key: "PROJECT_TASKS_IN_PROGRESS", count: counts.inProgress },
		{ key: "PROJECT_TASKS_FORWARDED", count: counts.forwarded },
		{ key: "PROJECT_TASKS_OTHER", count: counts.other },
	];
	return entries.filter((entry) => entry.count > 0);
}

/** Input is already sorted by note recency, so grouping keeps that order. */
export function groupPendingByNote(
	items: ProjectPendingTask[],
): PendingNoteGroup[] {
	const order: string[] = [];
	const map = new Map<string, PendingNoteGroup>();
	for (const item of items) {
		let group = map.get(item.path);
		if (!group) {
			group = {
				path: item.path,
				basename: item.noteBasename,
				noteMtime: item.noteMtime,
				items: [],
			};
			map.set(item.path, group);
			order.push(item.path);
		}
		group.items.push(item);
	}
	return order
		.map((path) => map.get(path))
		.filter((group): group is PendingNoteGroup => group !== undefined);
}
