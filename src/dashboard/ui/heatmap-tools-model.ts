import { moment } from "obsidian";
import type { HeatmapFilter } from "../dataset/heatmap-filter";
import type { HeatmapModel } from "../dataset/heatmap-model";

export interface HeatmapExtremeSummary {
	firstKey: string | null;
	count: number;
	keys: string[];
}

export function summarizeExtremes(
	keys: string[],
	count: number,
): HeatmapExtremeSummary {
	return { firstKey: keys[0] ?? null, count, keys };
}

export function formatHeatmapDay(key: string): string {
	return moment(key).format("MMM D");
}

export type HeatmapPresetId = "active" | "average" | "peak";

/** Peak wins over average, average over "any activity"; unmatched filters return null. */
export function presetOf(
	filter: HeatmapFilter,
	model: Pick<HeatmapModel, "averageActive" | "peak">,
): HeatmapPresetId | null {
	if (
		model.peak > 0 &&
		filter.min === model.peak &&
		filter.max === model.peak
	) {
		return "peak";
	}
	if (
		model.averageActive > 0 &&
		filter.max === null &&
		filter.min === Math.ceil(model.averageActive)
	) {
		return "average";
	}
	if (filter.min === 1 && filter.max === null) return "active";
	return null;
}
