import type {
	DatasetCell,
	DatasetSummaryItem,
	MeasureId,
} from "../types";

export function cell(
	text: string,
	extra: Omit<DatasetCell, "text"> = {},
): DatasetCell {
	return { text, ...extra };
}

export function summaryItem(
	labelKey: string,
	value: string,
	measure?: MeasureId,
): DatasetSummaryItem {
	return { labelKey, value, measure };
}
