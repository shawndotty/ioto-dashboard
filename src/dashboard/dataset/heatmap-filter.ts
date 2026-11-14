export interface HeatmapFilter {
	/** Inclusive lower bound; `null` means unbounded. */
	min: number | null;
	/** Inclusive upper bound; `null` means unbounded. */
	max: number | null;
	hideMiss: boolean;
}

export const EMPTY_HEATMAP_FILTER: HeatmapFilter = {
	min: null,
	max: null,
	hideMiss: false,
};

/** Inclusive on both ends; an open end imposes no limit. */
export function matchesHeatmapCount(
	count: number,
	filter: HeatmapFilter,
): boolean {
	if (filter.min !== null && count < filter.min) return false;
	if (filter.max !== null && count > filter.max) return false;
	return true;
}

export function heatmapFilterActive(filter: HeatmapFilter): boolean {
	return filter.min !== null || filter.max !== null;
}

/**
 * Truncates to integers, clamps into `[0, peak]` and orders the bounds.
 * A zero peak clears the range but keeps `hideMiss`.
 */
export function clampHeatmapFilter(
	filter: HeatmapFilter,
	peak: number,
): HeatmapFilter {
	const finite = (value: number | null): number | null => {
		if (value === null || !Number.isFinite(value)) return null;
		return Math.trunc(value);
	};
	let min = finite(filter.min);
	let max = finite(filter.max);

	if (peak <= 0) {
		min = null;
		max = null;
	} else {
		const clamp = (value: number): number => Math.max(0, Math.min(peak, value));
		if (min !== null) min = clamp(min);
		if (max !== null) max = clamp(max);
		if (min !== null && max !== null && min > max) {
			const swapped = min;
			min = max;
			max = swapped;
		}
	}

	return { min, max, hideMiss: filter.hideMiss };
}
