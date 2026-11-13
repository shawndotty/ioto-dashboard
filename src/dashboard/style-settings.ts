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

/**
 * `hideTitle` 查看态始终生效；带嵌套网格的容器在编辑态也必须生效，
 * 否则父级标题栏会挤压嵌套网格，使编辑排版与最终呈现不一致。
 */
export function titleHiddenInMode(
	options: Record<string, string | number | boolean> | undefined,
	editMode: boolean,
	hasNestedGrid: boolean,
): boolean {
	if (options?.hideTitle !== true) return false;
	return !editMode || hasNestedGrid;
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
			config.type !== "container" &&
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

/** Container layout defaults; `createConfig` writes the same values. */
export const CONTAINER_DEFAULTS = {
	columns: 12,
	rowHeight: 56,
	gap: 8,
	padding: 8,
	borderWidth: 1,
	radius: 10,
} as const;

export interface ContainerVars {
	columns: number;
	rowHeight: number;
	gap: number;
	padding: number;
	borderWidth: number;
	radius: number;
	borderColor?: string;
}

const CONTAINER_LIMITS = {
	columns: [4, 24],
	rowHeight: [40, 120],
	gap: [0, 24],
	padding: [0, 24],
	borderWidth: [0, 4],
	radius: [0, 24],
} as const;

function containerNumber(
	options: Record<string, string | number | boolean> | undefined,
	key: keyof typeof CONTAINER_LIMITS,
): number {
	const raw = options?.[key];
	const parsed =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && raw.trim() !== ""
				? Number(raw)
				: Number.NaN;
	const [min, max] = CONTAINER_LIMITS[key];
	if (!Number.isFinite(parsed)) return CONTAINER_DEFAULTS[key];
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Container column count (4–24); sub-card `maxW` follows it. */
export function containerColumnsOf(
	options: Record<string, string | number | boolean> | undefined,
): number {
	return containerNumber(options, "columns");
}

/** Reads every container option with the usual invalid-value fallback. */
export function containerVarsOf(
	options: Record<string, string | number | boolean> | undefined,
): ContainerVars {
	const vars: ContainerVars = {
		columns: containerNumber(options, "columns"),
		rowHeight: containerNumber(options, "rowHeight"),
		gap: containerNumber(options, "gap"),
		padding: containerNumber(options, "padding"),
		borderWidth: containerNumber(options, "borderWidth"),
		radius: containerNumber(options, "radius"),
	};
	const borderColor = options?.borderColor;
	if (isColor(borderColor)) vars.borderColor = borderColor;
	return vars;
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
