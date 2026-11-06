import type { NoteRecord, SortOption, SortOrder, TaskRecord } from "./types";

function compareValues(option: SortOption, a: number | string, b: number | string): number {
	if (option === "name") return String(a).localeCompare(String(b));
	return Number(a) - Number(b);
}

export function sortNotes(
	notes: NoteRecord[],
	option: SortOption,
	order: SortOrder,
): NoteRecord[] {
	const sorted = [...notes];
	sorted.sort((a, b) => {
		let left: number | string;
		let right: number | string;
		switch (option) {
			case "created":
				left = a.ctime;
				right = b.ctime;
				break;
			case "name":
				left = a.basename;
				right = b.basename;
				break;
			case "size":
				left = a.size;
				right = b.size;
				break;
			case "modified":
			default:
				left = a.mtime;
				right = b.mtime;
				break;
		}
		const result = compareValues(option, left, right);
		return order === "asc" ? result : -result;
	});
	return sorted;
}

export function sortTasks(
	tasks: TaskRecord[],
	option: SortOption,
	order: SortOrder,
): TaskRecord[] {
	const sorted = [...tasks];
	sorted.sort((a, b) => {
		let left: number | string;
		let right: number | string;
		switch (option) {
			case "created":
				left = a.noteCtime;
				right = b.noteCtime;
				break;
			case "name":
				left = a.noteBasename;
				right = b.noteBasename;
				break;
			case "size":
				left = a.noteSize;
				right = b.noteSize;
				break;
			case "modified":
			default:
				left = a.noteMtime;
				right = b.noteMtime;
				break;
		}
		const result = compareValues(option, left, right);
		return order === "asc" ? result : -result;
	});
	return sorted;
}
