import type { DatasetColumn } from "./types";

export type FieldAxis = "category" | "number";

/** y defaults to number; x defaults to category unless the setting overrides it. */
export function fieldAxisFor(setting: {
	role: "x" | "y";
	axisType?: FieldAxis;
}): FieldAxis {
	if (setting.axisType) return setting.axisType;
	return setting.role === "y" ? "number" : "category";
}

/** category → text/date/path; number → number/percent/size. */
export function columnMatchesAxis(
	column: DatasetColumn,
	axis: FieldAxis,
): boolean {
	if (axis === "number") {
		return (
			column.type === "number" ||
			column.type === "percent" ||
			column.type === "size"
		);
	}
	return (
		column.type === "text" ||
		column.type === "date" ||
		column.type === "path"
	);
}
