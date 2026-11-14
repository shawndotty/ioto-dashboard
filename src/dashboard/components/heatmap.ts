import { moment, setIcon, setTooltip } from "obsidian";
import { t } from "../../lang/helpers";
import type { QueryDefinition } from "../../query/types";
import type { DashboardComponentConfig } from "../types";
import {
	EMPTY_HEATMAP_FILTER,
	clampHeatmapFilter,
	heatmapFilterActive,
	matchesHeatmapCount,
	type HeatmapFilter,
} from "../dataset/heatmap-filter";
import {
	chooseHeatmapLayout,
	fitHeatmap,
	type HeatmapLayout,
} from "../dataset/heatmap-fit";
import { objectForQuery } from "../dataset/object";
import {
	buildHeatmapModel,
	type HeatmapBand,
	type HeatmapCell,
	type HeatmapModel,
} from "../dataset/heatmap-model";
import type {
	TimelineDateField,
	TimelineRange,
} from "../dataset/types";
import type {
	ComponentDefinition,
	SettingOption,
} from "../registry";
import { CARD_HEADER_HEIGHT } from "../container-layout";
import {
	mountHeatmapPanel,
	mountHeatmapToolsToggle,
	type HeatmapPanelHandle,
	type HeatmapToolsToggleHandle,
} from "../ui/heatmap-tools";

export function heatmapRangeOf(value: unknown): TimelineRange {
	const parsed = Number(value);
	return parsed === 7 ||
		parsed === 14 ||
		parsed === 90 ||
		parsed === 180 ||
		parsed === 365
		? parsed
		: 30;
}

export function heatmapObjectForQuery(
	query: QueryDefinition | undefined,
): "task" | "note" | "file" {
	const object = objectForQuery(query, "task");
	return object === "note" || object === "file" ? object : "task";
}

export function heatmapLayoutMode(
	value: unknown,
): "auto" | "calendar" | "strip" {
	return value === "calendar" || value === "strip" ? value : "auto";
}

function dateFieldOf(value: unknown): TimelineDateField {
	return value === "auto" ||
		value === "filename" ||
		value === "created" ||
		value === "modified"
		? value
		: "modified";
}

export function heatmapDateFieldOptions(
	query: QueryDefinition | undefined,
): SettingOption[] {
	if (query?.target === "file") {
		return [
			{ value: "created", labelKey: "TIMELINE_DATE_CREATED" },
			{ value: "modified", labelKey: "TIMELINE_DATE_MODIFIED" },
		];
	}
	return [
		{ value: "auto", labelKey: "TIMELINE_DATE_AUTO" },
		{ value: "filename", labelKey: "TIMELINE_DATE_FILENAME" },
		{ value: "created", labelKey: "TIMELINE_DATE_CREATED" },
		{ value: "modified", labelKey: "TIMELINE_DATE_MODIFIED" },
	];
}

const OBJECT_LABEL_KEYS: Record<
	"task" | "note" | "file",
	"DATASET_COL_TASKS" | "DATASET_COL_NOTES" | "DATASET_COL_FILES"
> = {
	task: "DATASET_COL_TASKS",
	note: "DATASET_COL_NOTES",
	file: "DATASET_COL_FILES",
};

const CELL_GAP = 3;
const MIN_CELL = 10;
const MAX_CELL = 40;
const COMPACT_CELL = 16;
const WEEKDAY_LABEL_WIDTH = 28;
const HOST_GAP = 6;
const GRID_ROW_GAP = 2;
const STRETCH_RATIO = 2;

interface HeatmapRuntime {
	model: HeatmapModel;
	locate(key: string): void;
	applyFilter(filter: HeatmapFilter): void;
	clearFilter(): void;
	setPanelOpen(open: boolean): void;
}

interface HeatmapCardState {
	queryId: string;
	range: number;
	filter: HeatmapFilter;
	panelOpen: boolean;
	runtime: HeatmapRuntime | null;
	toggle: HeatmapToolsToggleHandle | null;
	panelHandle: HeatmapPanelHandle | null;
}

const states = new WeakMap<DashboardComponentConfig, HeatmapCardState>();

/** Switching query or range drops filters and the open panel, like card search. */
function stateOf(
	config: DashboardComponentConfig,
	queryId: string,
	range: number,
): HeatmapCardState {
	let state = states.get(config);
	if (!state || state.queryId !== queryId || state.range !== range) {
		state = {
			queryId,
			range,
			filter: { ...EMPTY_HEATMAP_FILTER },
			panelOpen: false,
			runtime: null,
			toggle: null,
			panelHandle: null,
		};
		states.set(config, state);
	}
	return state;
}

function bandLabel(band: HeatmapBand): string {
	return band.min === band.max ? String(band.min) : `${band.min}–${band.max}`;
}

function filterRangeLabel(filter: HeatmapFilter): string {
	if (filter.min !== null && filter.max !== null) {
		return filter.min === filter.max
			? String(filter.min)
			: t("HEATMAP_FILTER_RANGE", [String(filter.min), String(filter.max)]);
	}
	if (filter.min !== null) return t("HEATMAP_FILTER_MIN", [String(filter.min)]);
	if (filter.max !== null) return t("HEATMAP_FILTER_MAX", [String(filter.max)]);
	return "";
}

function px(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function renderEmpty(el: HTMLElement): void {
	el.createDiv({ cls: "ioto-empty-state", text: t("HEATMAP_EMPTY") });
}

export const heatmapComponent: ComponentDefinition = {
	type: "heatmap",
	labelKey: "COMPONENT_HEATMAP_NAME",
	descriptionKey: "COMPONENT_HEATMAP_DESC",
	icon: "calendar-days",
	category: "analysis",
	objects: ["task", "note", "file"],
	queryTargets: ["task", "note", "file"],
	measureDefault: "timeline",
	defaultQueryId: "builtin:tasks-all",
	size: { minW: 4, minH: 3 },
	createConfig: (queryId) => ({
		queryId,
		measure: "timeline",
		options: {
			range: "30",
			dateField: "modified",
			layout: "auto",
			fill: "center",
			showMonthLabels: true,
			showWeekdayLabels: true,
			showLegend: true,
			showSummary: true,
		},
		w: 6,
		h: 3,
	}),
	settings: [
		{ key: "queryId", kind: "query", group: "data" },
		{
			key: "range",
			kind: "select",
			group: "data",
			labelKey: "SETTING_RANGE",
			options: [
				{ value: "7", labelKey: "SETTING_RANGE_7" },
				{ value: "14", labelKey: "SETTING_RANGE_14" },
				{ value: "30", labelKey: "SETTING_RANGE_30" },
				{ value: "90", labelKey: "SETTING_RANGE_90" },
				{ value: "180", labelKey: "SETTING_RANGE_180" },
				{ value: "365", labelKey: "SETTING_RANGE_365" },
			],
			fallback: "30",
			target: "options",
		},
		{
			key: "dateField",
			kind: "select",
			group: "data",
			labelKey: "SETTING_TIMELINE_DATE_FIELD",
			options: ({ query }) => heatmapDateFieldOptions(query),
			refreshOn: [],
			fallback: "modified",
			target: "options",
			hintKey: "SETTING_TIMELINE_DATE_HINT",
		},
		{
			key: "layout",
			kind: "select",
			group: "display",
			labelKey: "SETTING_HEATMAP_LAYOUT",
			hintKey: "SETTING_HEATMAP_LAYOUT_HINT",
			options: [
				{ value: "auto", labelKey: "HEATMAP_LAYOUT_AUTO" },
				{ value: "calendar", labelKey: "HEATMAP_LAYOUT_CALENDAR" },
				{ value: "strip", labelKey: "HEATMAP_LAYOUT_STRIP" },
			],
			fallback: "auto",
			target: "options",
		},
		{
			key: "fill",
			kind: "select",
			group: "display",
			labelKey: "SETTING_HEATMAP_FILL",
			options: [
				{ value: "center", labelKey: "HEATMAP_FILL_CENTER" },
				{ value: "stretch", labelKey: "HEATMAP_FILL_STRETCH" },
			],
			fallback: "center",
			target: "options",
		},
		{
			key: "showMonthLabels",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_HEATMAP_MONTH_LABELS",
			fallback: true,
			target: "options",
		},
		{
			key: "showWeekdayLabels",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_HEATMAP_WEEKDAY_LABELS",
			fallback: true,
			target: "options",
		},
		{
			key: "showLegend",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_SHOW_LEGEND",
			fallback: true,
			target: "options",
		},
		{
			key: "showSummary",
			kind: "toggle",
			group: "display",
			labelKey: "SETTING_HEATMAP_SUMMARY",
			fallback: true,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	toDatasetRequest: (config, query) => {
		const object = heatmapObjectForQuery(query);
		const dateField = dateFieldOf(config.options?.dateField);
		return {
			object,
			measure: "timeline",
			queryId: config.queryId,
			range: heatmapRangeOf(config.options?.range),
			timeline: {
				bucket: "day",
				// Files have no meaningful "auto": follow mtime like the line chart.
				dateField:
					object === "file" && dateField === "auto" ? "modified" : dateField,
			},
		};
	},
	isEmptyDataset: (dataset) => (dataset.sourceTotal ?? dataset.total) === 0,
	isEmpty: () => false,
	renderHeaderActions: (header, ctx) => {
		if (ctx.status !== "ready") return;
		const range = heatmapRangeOf(ctx.config.options?.range);
		const state = stateOf(ctx.config, ctx.config.queryId, range);
		const runtime = state.runtime;
		if (!runtime || runtime.model.activeDays === 0) return;
		state.toggle = mountHeatmapToolsToggle(header, {
			open: state.panelOpen,
			filterActive: heatmapFilterActive(state.filter),
			onToggle: (open) => runtime.setPanelOpen(open),
		});
		if (state.panelHandle) {
			state.toggle.setControls(state.panelHandle.panelId);
		}
	},
	render: (el, ctx) => {
		if (ctx.status === "empty") {
			renderEmpty(el);
			return;
		}
		const dataset = ctx.dataset;
		if (!dataset) return;

		const options = ctx.config.options ?? {};
		const object = heatmapObjectForQuery(ctx.query);
		const objectLabelKey = OBJECT_LABEL_KEYS[object];
		const range = heatmapRangeOf(options.range);
		const mode = heatmapLayoutMode(options.layout);
		const fill = options.fill === "stretch" ? "stretch" : "center";
		const showMonths = options.showMonthLabels !== false;
		const showWeekdays = options.showWeekdayLabels !== false;
		const showLegend = options.showLegend !== false;
		const showSummary = options.showSummary !== false;
		const firstDayOfWeek = moment.localeData().firstDayOfWeek();

		const model = buildHeatmapModel(dataset.rows, {
			range,
			firstDayOfWeek,
		});
		const state = stateOf(ctx.config, ctx.config.queryId, range);
		state.toggle = null;
		state.panelHandle = null;
		// A refresh may lower the peak; keep the restored range inside [0, peak].
		state.filter = clampHeatmapFilter(state.filter, model.peak);

		const host = el.createDiv({ cls: "ioto-heatmap" });
		const scroll = host.createDiv({ cls: "ioto-heatmap-scroll" });

		let layout: HeatmapLayout = mode === "auto" ? "calendar" : mode;
		let grid: HTMLElement | null = null;
		let monthsEl: HTMLElement | null = null;
		let weekdaysEl: HTMLElement | null = null;
		let cellModel = new Map<string, HeatmapCell>();
		let buttonByKey = new Map<string, HTMLElement>();
		let monthsChrome = 0;
		let weekdayLabelWidth = WEEKDAY_LABEL_WIDTH;
		let lastScrollbar = 0;
		let flashTimer = 0;
		let schedule = (): void => {};

		const applyDecorations = (): void => {
			const active = heatmapFilterActive(state.filter);
			const peakSet = new Set(model.peakKeys);
			for (const [key, button] of buttonByKey) {
				const cell = cellModel.get(key);
				if (!cell) continue;
				button.toggleClass("is-peak", peakSet.has(key));
				button.toggleClass(
					"is-muted",
					active && !matchesHeatmapCount(cell.count, state.filter),
				);
			}
			grid?.toggleClass("is-hiding-miss", active && state.filter.hideMiss);
		};

		const locateCell = (key: string): void => {
			const button = buttonByKey.get(key);
			if (!button) return;
			const reduced = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;
			button.scrollIntoView({
				block: "nearest",
				inline: "center",
				behavior: reduced ? "auto" : "smooth",
			});
			// Restart the pulse when the same cell is located twice.
			button.removeClass("is-flash");
			void button.offsetWidth;
			button.addClass("is-flash");
			if (flashTimer) window.clearTimeout(flashTimer);
			flashTimer = window.setTimeout(() => {
				button.removeClass("is-flash");
				flashTimer = 0;
			}, 1200);
		};

		const buildGrid = (next: HeatmapLayout): void => {
			scroll.empty();
			layout = next;
			const nextGrid = scroll.createDiv({ cls: "ioto-heatmap-grid" });
			nextGrid.setAttribute("data-layout", next);
			grid = nextGrid;
			monthsEl = null;
			weekdaysEl = null;
			cellModel = new Map();
			buttonByKey = new Map();

			if (next === "calendar" && showMonths) {
				const months = nextGrid.createDiv({ cls: "ioto-heatmap-months" });
				const marks = new Map(
					model.months.map((mark) => [mark.column, mark.key]),
				);
				for (let column = 0; column < model.columns; column += 1) {
					const label = months.createDiv({ cls: "ioto-heatmap-month" });
					const mark = marks.get(column);
					if (mark) label.setText(moment(`${mark}-01`).format("MMM"));
				}
				monthsEl = months;
			}

			if (next === "calendar" && showWeekdays) {
				const weekdays = nextGrid.createDiv({ cls: "ioto-heatmap-weekdays" });
				const names = moment.localeData().weekdaysMin();
				for (let row = 0; row < 7; row += 1) {
					const label = weekdays.createDiv({ cls: "ioto-heatmap-weekday" });
					label.setAttribute("data-row", String(row));
					label.setText(names[(firstDayOfWeek + row) % 7] ?? "");
				}
				weekdaysEl = weekdays;
			}

			const cellsEl = nextGrid.createDiv({ cls: "ioto-heatmap-cells" });
			const cells =
				next === "strip"
					? model.cells.filter((cell) => cell.inRange)
					: model.cells;
			for (const cell of cells) {
				if (!cell.inRange) {
					cellsEl.createDiv({
						cls: "ioto-heatmap-cell is-outside",
						attr: { "aria-hidden": "true" },
					});
					continue;
				}
				const tooltip = t("HEATMAP_TOOLTIP", [
					cell.key,
					String(cell.count),
					t(objectLabelKey),
				]);
				const button = cellsEl.createEl("button", {
					cls: "ioto-heatmap-cell",
					attr: {
						type: "button",
						"data-date": cell.key,
						"data-level": String(cell.level),
						"aria-label": tooltip,
					},
				});
				if (cell.isToday) button.addClass("is-today");
				setTooltip(button, tooltip);
				cellModel.set(cell.key, cell);
				buttonByKey.set(cell.key, button);
			}
			applyDecorations();
		};

		buildGrid(layout);

		let footer: HTMLElement | null = null;
		let chip: HTMLElement | null = null;
		let chipText: HTMLElement | null = null;
		const legendButtons: Array<{ el: HTMLElement; min: number; max: number }> =
			[];

		const updateFooterFilterUI = (): void => {
			const filter = state.filter;
			const active = heatmapFilterActive(filter);
			for (const entry of legendButtons) {
				entry.el.toggleClass(
					"is-active",
					active && filter.min === entry.min && filter.max === entry.max,
				);
			}
			if (!chip || !chipText) return;
			if (!active) {
				chip.hide();
				return;
			}
			let hits = 0;
			let total = 0;
			for (const cell of model.cells) {
				if (!cell.inRange) continue;
				total += 1;
				if (matchesHeatmapCount(cell.count, filter)) hits += 1;
			}
			chip.show();
			chip.toggleClass("is-empty", hits === 0);
			const rangeText =
				hits === 0 ? t("HEATMAP_FILTER_EMPTY") : filterRangeLabel(filter);
			chipText.setText(
				`${rangeText} · ${t("HEATMAP_FILTER_HITS", [String(hits), String(total)])}`,
			);
		};

		const applyFilterState = (next: HeatmapFilter): void => {
			state.filter = clampHeatmapFilter(next, model.peak);
			applyDecorations();
			updateFooterFilterUI();
			state.panelHandle?.refresh(state.filter);
			state.toggle?.setFilterActive(heatmapFilterActive(state.filter));
			// Footer height (chip, wrapped legend) feeds the cell size budget.
			schedule();
		};

		const clearFilter = (hideMiss = state.filter.hideMiss): void => {
			applyFilterState({
				...EMPTY_HEATMAP_FILTER,
				hideMiss,
			});
		};

		if (showSummary || showLegend) {
			footer = host.createDiv({ cls: "ioto-heatmap-footer" });
			if (showSummary) {
				const info = footer.createDiv({ cls: "ioto-heatmap-footer-info" });
				const summary = t("HEATMAP_SUMMARY", [
					String(model.activeDays),
					String(model.peak),
				]);
				const firstPeak = model.peakKeys[0];
				info.createDiv({ cls: "ioto-heatmap-summary", text: summary });
				if (firstPeak !== undefined) {
					const link = info.createEl("button", {
						cls: "ioto-heatmap-summary-link",
						text: t("HEATMAP_SUMMARY_LOCATE"),
						attr: { type: "button" },
					});
					const locateLabel = t("HEATMAP_TOOLS_LOCATE", [firstPeak]);
					link.setAttribute("aria-label", locateLabel);
					setTooltip(link, locateLabel);
					link.addEventListener("click", () => {
						if (ctx.editMode) return;
						locateCell(firstPeak);
					});
				}

				chip = info.createDiv({
					cls: "ioto-heatmap-chip",
					attr: { "aria-live": "polite" },
				});
				chipText = chip.createSpan({ cls: "ioto-heatmap-chip-text" });
				const clear = chip.createEl("button", {
					cls: "clickable-icon ioto-heatmap-chip-clear",
					attr: {
						type: "button",
						"aria-label": t("HEATMAP_FILTER_CLEAR"),
					},
				});
				setIcon(clear, "x");
				setTooltip(clear, t("HEATMAP_FILTER_CLEAR"));
				clear.addEventListener("click", () => {
					if (ctx.editMode) return;
					clearFilter();
				});
				chip.hide();
			}
			if (showLegend) {
				const legend = footer.createDiv({ cls: "ioto-heatmap-legend" });
				for (const band of model.bands) {
					const label = bandLabel(band);
					const block = legend.createEl("button", {
						cls: "ioto-heatmap-legend-block",
						attr: {
							type: "button",
							"data-level": String(band.level),
							"aria-label": label,
						},
					});
					setTooltip(block, label);
					block.addEventListener("click", () => {
						if (ctx.editMode) return;
						const sameLevel =
							state.filter.min === band.min &&
							state.filter.max === band.max;
						if (sameLevel) {
							clearFilter();
							return;
						}
						applyFilterState({
							min: band.min,
							max: band.max,
							hideMiss: state.filter.hideMiss,
						});
					});
					legendButtons.push({
						el: block,
						min: band.min,
						max: band.max,
					});
					legend.createSpan({
						cls: "ioto-heatmap-legend-band",
						text: label,
					});
				}
			}
		}

		const runtime: HeatmapRuntime = {
			model,
			locate: locateCell,
			applyFilter: applyFilterState,
			clearFilter,
			setPanelOpen: (open) => {
				const next = ctx.editMode ? false : open;
				state.panelOpen = next;
				state.panelHandle?.setOpen(next);
				state.toggle?.setOpen(next);
			},
		};

		const card = el.closest<HTMLElement>(".ioto-dashboard-card") ?? host;
		const cardHeader = card.querySelector<HTMLElement>(
			":scope > .ioto-dashboard-card-header",
		);
		const headerHeight = cardHeader?.getBoundingClientRect().height ?? 0;
		state.panelHandle = mountHeatmapPanel(card, {
			model,
			state: state.filter,
			open: state.panelOpen && !ctx.editMode,
			topOffset:
				(headerHeight > 0 ? headerHeight : CARD_HEADER_HEIGHT) + 4,
			callbacks: {
				locate: locateCell,
				applyFilter: applyFilterState,
				clearFilter,
				setOpen: (open) => runtime.setPanelOpen(open),
			},
		});

		state.runtime = runtime;
		updateFooterFilterUI();

		scroll.addEventListener("click", (event) => {
			if (ctx.editMode) return;
			const target = event.target as HTMLElement | null;
			const button = target?.closest<HTMLElement>("button.ioto-heatmap-cell");
			const date = button?.dataset.date;
			if (!date) return;
			const cell = cellModel.get(date);
			if (!cell || cell.refs.length === 0) return;
			ctx.openChartBucket?.({
				bucketKey: cell.key,
				object,
				cumulative: false,
				series: [
					{ key: "total", label: t(objectLabelKey), value: cell.count },
				],
				refs: cell.refs,
				relatedTotal: cell.relatedTotal,
				bucket: "day",
				source: "timeline",
			});
		});

		const measureChrome = (): {
			calendar: number;
			strip: number;
			scrollbar: number;
		} => {
			const footerChrome = footer ? HOST_GAP + footer.offsetHeight : 0;
			const scrollbar = Math.max(0, scroll.offsetHeight - scroll.clientHeight);
			if (layout === "calendar") {
				if (monthsEl) monthsChrome = monthsEl.offsetHeight + GRID_ROW_GAP;
				if (weekdaysEl) weekdayLabelWidth = weekdaysEl.offsetWidth + 6;
			}
			return {
				calendar: footerChrome + monthsChrome + scrollbar,
				strip: footerChrome + scrollbar,
				scrollbar,
			};
		};

		let frame = 0;
		let wasConnected = false;

		schedule = (): void => {
			if (frame) return;
			frame = requestAnimationFrame(paint);
		};

		const paint = (): void => {
			frame = 0;
			if (!host.isConnected) return;
			wasConnected = true;

			const style = getComputedStyle(el);
			const width =
				el.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
			const height =
				el.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
			if (width <= 0 || height <= 0) return;

			let chrome = measureChrome();
			if (mode === "auto" && model.columns > 0) {
				const choice = chooseHeatmapLayout({
					range,
					width,
					height,
					calendarColumns: model.columns,
					gap: CELL_GAP,
					minCell: MIN_CELL,
					maxCell: MAX_CELL,
					weekdayLabelWidth,
					calendarChromeHeight: chrome.calendar,
					stripChromeHeight: chrome.strip,
					previous: layout,
				});
				if (choice.layout !== layout) {
					buildGrid(choice.layout);
					chrome = measureChrome();
					schedule();
				}
			}
			if (!grid) return;

			const columns = layout === "strip" ? range : model.columns;
			if (columns <= 0) return;
			const fit = fitHeatmap({
				width,
				height,
				columns,
				rows: layout === "strip" ? 1 : 7,
				gap: CELL_GAP,
				labelWidth:
					layout === "calendar" && weekdaysEl ? weekdayLabelWidth : 0,
				chromeHeight: layout === "calendar" ? chrome.calendar : chrome.strip,
				minCell: MIN_CELL,
				maxCell: MAX_CELL,
				stretch: fill === "stretch" ? STRETCH_RATIO : 1,
			});
			grid.style.setProperty("--ioto-heatmap-cell-w", `${fit.cellW}px`);
			grid.style.setProperty("--ioto-heatmap-cell-h", `${fit.cellH}px`);
			grid.style.setProperty("--ioto-heatmap-columns", String(columns));
			grid.classList.toggle("is-compact", fit.cellH < COMPACT_CELL);
			host.classList.toggle("is-compact", fit.cellH < COMPACT_CELL);

			// Only a growing scrollbar warrants a re-layout: shrinking back would
			// otherwise oscillate between "cells grow → scrollbar appears → cells shrink".
			if (chrome.scrollbar > lastScrollbar) {
				lastScrollbar = chrome.scrollbar;
				schedule();
			}
		};

		const observer = new ResizeObserver(() => {
			if (!host.isConnected) {
				if (wasConnected) {
					observer.disconnect();
					if (frame) cancelAnimationFrame(frame);
					frame = 0;
				}
				return;
			}
			schedule();
		});
		observer.observe(el);
		schedule();
	},
};
