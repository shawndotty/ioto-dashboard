import type { ComponentDefinition, ComponentSetting } from "./registry";

/**
 * Style option keys. `createConfig` only ever writes `surface` (and only for
 * markdown / button); the rest stay untouched so old data remains valid.
 */
export const STYLE_SETTING_KEYS = [
	"surface",
	"textAlign",
	"textColor",
	"backgroundColor",
] as const;

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ALIGNMENTS = ["left", "center", "right"] as const;
type TextAlign = (typeof ALIGNMENTS)[number];

export const SURFACES = ["card", "flat", "plain"] as const;
export type CardSurface = (typeof SURFACES)[number];

function isSurface(value: unknown): value is CardSurface {
	return (
		typeof value === "string" &&
		(SURFACES as readonly string[]).includes(value)
	);
}

/** `surface` 缺省按 `card` 解释，保证旧看板外观不变。 */
export function cardSurfaceOf(
	options: Record<string, string | number | boolean> | undefined,
): CardSurface {
	const value = options?.surface;
	return isSurface(value) ? value : "card";
}

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
		key: "surface",
		kind: "select",
		group: "style",
		labelKey: "SETTING_CARD_SURFACE",
		hintKey: "SETTING_CARD_SURFACE_HINT",
		fallback: "card",
		target: "options",
		options: [
			{ value: "card", labelKey: "SURFACE_CARD" },
			{ value: "flat", labelKey: "SURFACE_FLAT" },
			{ value: "plain", labelKey: "SURFACE_PLAIN" },
		],
		when: (config) => config.type === "markdown" || config.type === "button",
	},
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
			config.type !== "pie-chart" &&
			config.type !== "donut-chart" &&
			config.type !== "scatter-chart" &&
			config.type !== "task-list" &&
			config.type !== "note-list" &&
			config.type !== "table",
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
		when: (config) =>
			!(config.type === "markdown" && cardSurfaceOf(config.options) === "plain"),
	},
];

/**
 * Display settings shared by every component. As with styles, they are merged
 * into the definition's own settings and never written by `createConfig`.
 */
export const DISPLAY_SETTINGS: ComponentSetting[] = [
	{
		key: "hideTitle",
		kind: "toggle",
		group: "display",
		labelKey: "SETTING_HIDE_TITLE",
		fallback: false,
		target: "options",
	},
];

/** A component's own settings, then shared display and style settings. */
export function settingsOf(definition: ComponentDefinition): ComponentSetting[] {
	return [
		...(definition.settings ?? []),
		...DISPLAY_SETTINGS,
		...STYLE_SETTINGS,
	];
}

export interface CardStyleVars {
	fg?: string;
	bg?: string;
	align?: TextAlign;
	/** 恒有值；缺省或非法值回落 `card`。 */
	surface: CardSurface;
}

/**
 * Reads the card-level style options with the same validation as
 * `coerceSettingValue`; invalid or missing values fall back to the theme.
 */
export function cardStyleVars(
	options: Record<string, string | number | boolean> | undefined,
): CardStyleVars {
	const vars: CardStyleVars = { surface: cardSurfaceOf(options) };
	const fg = options?.textColor;
	if (isColor(fg)) vars.fg = fg;
	const bg = options?.backgroundColor;
	if (isColor(bg)) vars.bg = bg;
	const align = options?.textAlign;
	if (isAlignment(align)) vars.align = align;
	return vars;
}
