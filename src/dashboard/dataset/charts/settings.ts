import type { SettingOption } from "../../registry";

/** Sizes only ever format as KB/MB, never as raw counts. */
export function yFormatOptionsForField(field: unknown): SettingOption[] {
	if (field === "size") {
		return [{ value: "auto", labelKey: "AXIS_FORMAT_AUTO" }];
	}
	return [
		{ value: "auto", labelKey: "AXIS_FORMAT_AUTO" },
		{ value: "number", labelKey: "AXIS_FORMAT_NUMBER" },
		{ value: "compact", labelKey: "AXIS_FORMAT_COMPACT" },
	];
}
