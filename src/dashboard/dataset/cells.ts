import type { DatasetRow } from "./types";

/** First clickable path on a row; used by chart and list click-through. */
export function firstCellPath(row: DatasetRow | undefined): string | undefined {
	if (!row) return undefined;
	for (const cell of Object.values(row.cells)) {
		if (cell.path) return cell.path;
	}
	return undefined;
}
