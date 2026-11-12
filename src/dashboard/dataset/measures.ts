import type { t } from "../../lang/helpers";
import type { DataObject, MeasureId } from "./types";

type LabelKey = Parameters<typeof t>[0];

/**
 * Scalar measures each object can produce. `series` / `timeline` are omitted
 * on purpose: they are chart-shaped, not single numbers.
 */
export const MEASURES_BY_OBJECT: Record<DataObject, MeasureId[]> = {
	task: ["count", "completed", "open", "ratio"],
	note: ["count"],
	file: ["count", "size", "mtime"],
	folder: ["count", "mtime"],
	project: ["count", "ratio"],
};

const MEASURE_LABEL_KEYS: Partial<Record<MeasureId, LabelKey>> = {
	count: "DATASET_MEASURE_COUNT",
	completed: "DATASET_MEASURE_COMPLETED",
	open: "DATASET_MEASURE_OPEN",
	ratio: "DATASET_MEASURE_RATIO",
	size: "DATASET_MEASURE_SIZE",
	mtime: "DATASET_MEASURE_LATEST_MTIME",
};

export function measuresForObject(object: DataObject): MeasureId[] {
	return [...MEASURES_BY_OBJECT[object]];
}

/** Stored config may predate the object switch; render time normalises it. */
export function resolveMeasure(
	measure: MeasureId | undefined,
	object: DataObject,
): MeasureId {
	return measure && MEASURES_BY_OBJECT[object].includes(measure)
		? measure
		: "count";
}

export function measureLabelKey(measure: MeasureId): LabelKey {
	return MEASURE_LABEL_KEYS[measure] ?? "DATASET_MEASURE_COUNT";
}
