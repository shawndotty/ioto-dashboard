import type { ComponentDefinition, ComponentSetting } from "./registry";

/** Style option keys; never written by `createConfig`, so old data stays valid. */
export const STYLE_SETTING_KEYS = [
	"textAlign",
	"textColor",
	"backgroundColor",
] as const;

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ALIGNMENTS = ["left", "center", "right"] as const;
type TextAlign = (typeof ALIGNMENTS)[number];

function isAlignment(value: unknown): value is TextAlign {
	return (
		typeof value === "string" &&
		(ALIGNMENTS as readonly string[]).includes(value)
	);
}

function isColor(value: unknown): value is string {
	return typeof value === "string" && COLOR_PATTERN.test(value);
}

/**
 * Inspector-side style settings shared by every component. They are merged into
 * the definition's own settings, so `createConfig()` and the schema stay intact.
 */
export const STYLE_SETTINGS: ComponentSetting[] = [
	{
		key: "textAlign",
		kind: "select",
		group: "style",
		labelKey: "SETTING_TEXT_ALIGN",
		options: [
			{ value: "left", labelKey: "SETTING_ALIGN_LEFT" },
			{ value: "center", labelKey: "SETTING_ALIGN_CENTER" },
			{ value: "right", labelKey: "SETTING_ALIGN_RIGHT" },
		],
		fallback: "left",
		target: "options",
		when: (config) =>
			config.type !== "line-chart" &&
			config.type !== "bar-chart" &&
			config.type !== "task-list",
	},
	{
		key: "textColor",
		kind: "color",
		group: "style",
		labelKey: "SETTING_TEXT_COLOR",
		hintKey: "SETTING_STYLE_COLOR_HINT",
		target: "options",
	},
	{
		key: "backgroundColor",
		kind: "color",
		group: "style",
		labelKey: "SETTING_BACKGROUND_COLOR",
		hintKey: "SETTING_STYLE_COLOR_HINT",
		target: "options",
	},
];

/** A component's own settings followed by the shared style settings. */
export function settingsOf(definition: ComponentDefinition): ComponentSetting[] {
	return [...(definition.settings ?? []), ...STYLE_SETTINGS];
}

export interface CardStyleVars {
	fg?: string;
	bg?: string;
	align?: TextAlign;
}

/**
 * Reads the card-level style options with the same validation as
 * `coerceSettingValue`; invalid or missing values fall back to the theme.
 */
export function cardStyleVars(
	options: Record<string, string | number | boolean> | undefined,
): CardStyleVars {
	const vars: CardStyleVars = {};
	const fg = options?.textColor;
	if (isColor(fg)) vars.fg = fg;
	const bg = options?.backgroundColor;
	if (isColor(bg)) vars.bg = bg;
	const align = options?.textAlign;
	if (isAlignment(align)) vars.align = align;
	return vars;
}
