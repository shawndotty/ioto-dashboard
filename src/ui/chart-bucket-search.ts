import type { TimelineSourceRef } from "../dashboard/dataset/timeline";

export interface HighlightSegment {
	text: string;
	hit: boolean;
}

export function basename(path: string): string {
	const index = path.lastIndexOf("/");
	return index >= 0 ? path.slice(index + 1) : path;
}

/** Obsidian task char: open=" " / done="x" / cancelled="-" / in-progress="/" / forwarded=">" / other="?" */
export function bucketTaskChar(marker: string | undefined): string {
	switch (marker) {
		case "done":
			return "x";
		case "cancelled":
			return "-";
		case "in-progress":
			return "/";
		case "forwarded":
			return ">";
		case "other":
			return "?";
		default:
			return " ";
	}
}

export function isDoneTask(marker: string | undefined): boolean {
	return marker === "done";
}

export function isCancelledTask(marker: string | undefined): boolean {
	return marker === "cancelled";
}

/** Open = neither done nor cancelled (includes in-progress / forwarded / other / undefined). */
export function isOpenTask(marker: string | undefined): boolean {
	return !isDoneTask(marker) && !isCancelledTask(marker);
}

export function normalizeQuery(raw: string): string {
	return raw.trim().toLowerCase();
}

export function matchBucketRef(ref: TimelineSourceRef, query: string): boolean {
	const needle = normalizeQuery(query);
	if (!needle) return true;
	if (ref.label.toLowerCase().includes(needle)) return true;
	if (!ref.path) return false;
	if (basename(ref.path).toLowerCase().includes(needle)) return true;
	return ref.path.toLowerCase().includes(needle);
}

export function splitHighlight(
	text: string,
	query: string,
): HighlightSegment[] {
	const needle = normalizeQuery(query);
	if (!needle) return text ? [{ text, hit: false }] : [];
	const haystack = text.toLowerCase();
	const segments: HighlightSegment[] = [];
	let from = 0;
	while (from < text.length) {
		const index = haystack.indexOf(needle, from);
		if (index < 0) {
			segments.push({ text: text.slice(from), hit: false });
			break;
		}
		if (index > from) {
			segments.push({ text: text.slice(from, index), hit: false });
		}
		segments.push({
			text: text.slice(index, index + needle.length),
			hit: true,
		});
		from = index + needle.length;
	}
	return segments;
}
