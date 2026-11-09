import type { DatasetCell } from "../types";

export function cell(
	text: string,
	extra: Omit<DatasetCell, "text"> = {},
): DatasetCell {
	return { text, ...extra };
}
