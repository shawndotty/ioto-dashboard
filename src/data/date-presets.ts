/** Single source of truth for date presets shared by the sidebar and the query editor. */
export const DATE_PRESETS = [
	"all",
	"last1day",
	"last3days",
	"last7days",
	"last14days",
	"last30days",
	"custom",
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABEL_KEYS = {
	all: "FILTER_DATE_PRESET_ALL",
	last1day: "FILTER_DATE_PRESET_LAST_1_DAY",
	last3days: "FILTER_DATE_PRESET_LAST_3_DAYS",
	last7days: "FILTER_DATE_PRESET_LAST_7_DAYS",
	last14days: "FILTER_DATE_PRESET_LAST_14_DAYS",
	last30days: "FILTER_DATE_PRESET_LAST_30_DAYS",
	custom: "FILTER_DATE_PRESET_CUSTOM",
} as const satisfies Record<DatePreset, string>;

/** Unknown persisted values (older/newer builds) fall back to "all". */
export function normalizeDatePreset(value: string | undefined): DatePreset {
	return (DATE_PRESETS as readonly string[]).includes(value ?? "")
		? (value as DatePreset)
		: "all";
}

/** Local-time YYYY-MM-DD; `toISOString()` would shift the day across time zones. */
export function formatDateInput(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** An empty side means "unbounded"; only two filled sides can be inverted. */
export function isDateRangeValid(start: string, end: string): boolean {
	if (!start || !end) return true;
	return start <= end;
}

/** Prefill for a fresh custom range: the last 7 days including today. */
export function defaultCustomRange(now: Date = new Date()): {
	dateStart: string;
	dateEnd: string;
} {
	const start = new Date(now);
	start.setDate(start.getDate() - 6);
	return { dateStart: formatDateInput(start), dateEnd: formatDateInput(now) };
}
