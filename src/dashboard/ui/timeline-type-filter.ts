import type { IoType } from "../../data/types";
import type { TimelineSourceRef } from "../dataset/timeline";
import type { DashboardComponentConfig } from "../types";
import {
	mountCardToolsPanel,
	mountCardToolsToggle,
	type CardToolsClasses,
	type CardToolsPanelHandle,
	type CardToolsToggleHandle,
} from "./card-tools";

/** The four filterable types. Unknown is deliberately not a toggle (see Q2). */
export const ALL_TYPES = ["Input", "Output", "Outcome", "Task"] as const;

export const TIMELINE_FILTER_TOOL_CLASSES: CardToolsClasses = {
	panel: "ioto-timeline-type-filter-panel",
	titlebar: "ioto-timeline-type-filter-titlebar",
	title: "ioto-timeline-type-filter-title",
	close: "ioto-timeline-type-filter-close",
	toggle: "ioto-timeline-type-filter-toggle",
};

export interface TimelineTypeFilterLabels {
	toggle: string;
	title: string;
	close: string;
	all: string;
	input: string;
	output: string;
	task: string;
	outcome: string;
}

interface TimelineTypeFilterState {
	queryId: string;
	open: boolean;
	enabled: Set<IoType>;
}

const states = new WeakMap<DashboardComponentConfig, TimelineTypeFilterState>();

/**
 * Returns the per-card state, resetting to "all types on / closed" when the
 * query changes. Exported so the reset contract is directly unit-testable.
 */
export function stateOf(
	config: DashboardComponentConfig,
): TimelineTypeFilterState {
	let state = states.get(config);
	if (!state || state.queryId !== config.queryId) {
		state = {
			queryId: config.queryId,
			open: false,
			enabled: new Set<IoType>(ALL_TYPES),
		};
		states.set(config, state);
	}
	return state;
}

/**
 * Q2: Unknown has no toggle. It is visible only while all four types are on;
 * once any type is disabled (including "all off"), Unknown is hidden too.
 */
export function matchesTimelineTypes(
	ref: TimelineSourceRef,
	enabled: ReadonlySet<IoType>,
): boolean {
	const type = ref.ioType ?? "Unknown";
	return type === "Unknown"
		? enabled.size === ALL_TYPES.length
		: enabled.has(type);
}

/** True when at least one of the four types is disabled. */
export function timelineTypeFilterActive(
	config: DashboardComponentConfig,
): boolean {
	return stateOf(config).enabled.size !== ALL_TYPES.length;
}

export function timelineTypeFilterEnabled(
	config: DashboardComponentConfig,
): ReadonlySet<IoType> {
	return stateOf(config).enabled;
}

/** Native tri-state of the "All" checkbox derived from the enabled set. */
export function allState(
	enabled: ReadonlySet<IoType>,
): "on" | "off" | "partial" {
	if (enabled.size === ALL_TYPES.length) return "on";
	if (enabled.size === 0) return "off";
	return "partial";
}

export interface TimelineTypeFilterOptions {
	config: DashboardComponentConfig;
	labels: TimelineTypeFilterLabels;
	onChange(): void;
}

/**
 * Mounts the header toggle plus the shared-shell filter panel. State lives in
 * the WeakMap keyed by config, so a full card rebuild restores the same checks
 * and open state without stealing focus.
 */
export function mountTimelineTypeFilter(
	header: HTMLElement,
	options: TimelineTypeFilterOptions,
): void {
	const state = stateOf(options.config);
	const { labels } = options;
	const activeNow = (): boolean => state.enabled.size !== ALL_TYPES.length;

	let panel: CardToolsPanelHandle;
	const setOpen = (open: boolean): void => {
		state.open = open;
		toggle.setOpen(open);
		panel.setOpen(open);
	};

	const toggle: CardToolsToggleHandle = mountCardToolsToggle(header, {
		icon: "filter",
		title: labels.toggle,
		activeTitle: labels.toggle,
		open: state.open,
		active: activeNow(),
		classes: TIMELINE_FILTER_TOOL_CLASSES,
		onToggle: setOpen,
	});

	const host = header.closest<HTMLElement>("[data-component-id]") ?? header;
	const headerHeight = header.getBoundingClientRect().height;

	const sync = (): void => {
		for (const { type, box } of checkboxes) {
			box.checked = state.enabled.has(type);
		}
		const tri = allState(state.enabled);
		allBox.checked = tri === "on";
		allBox.indeterminate = tri === "partial";
		toggle.setActive(activeNow());
		options.onChange();
	};

	const checkboxes: Array<{ type: IoType; box: HTMLInputElement }> = [];
	let allBox!: HTMLInputElement;

	panel = mountCardToolsPanel({
		host,
		classes: TIMELINE_FILTER_TOOL_CLASSES,
		title: labels.title,
		closeLabel: labels.close,
		open: state.open,
		topOffset: headerHeight > 0 ? headerHeight + 4 : 4,
		topVar: "--ioto-timeline-type-filter-top",
		setOpen,
		buildContent: (panelEl) => {
			const section = panelEl.createDiv({
				cls: "ioto-timeline-type-filter-section",
			});

			// Row 1: "All" with a native tri-state checkbox, then a divider.
			const allRow = section.createEl("label", {
				cls: "ioto-timeline-type-filter-row is-all",
			});
			allBox = allRow.createEl("input", { type: "checkbox" });
			allRow.createSpan({ text: labels.all });
			allBox.addEventListener("change", () => {
				// Native semantics: indeterminate/ unchecked → checked = all on,
				// checked → unchecked = all off.
				state.enabled = new Set<IoType>(
					allBox.checked ? ALL_TYPES : [],
				);
				sync();
			});

			const divider = section.createDiv({
				cls: "ioto-timeline-type-filter-divider",
			});
			divider.setAttribute("aria-hidden", "true");

			const typeRows: Array<[IoType, string]> = [
				["Input", labels.input],
				["Output", labels.output],
				["Task", labels.task],
				["Outcome", labels.outcome],
			];
			for (const [type, label] of typeRows) {
				const row = section.createEl("label", {
					cls: "ioto-timeline-type-filter-row",
				});
				const box = row.createEl("input", { type: "checkbox" });
				const swatch = row.createSpan({
					cls: "ioto-timeline-type-filter-swatch",
				});
				swatch.setAttr("data-io-type", type);
				row.createSpan({ text: label });
				box.addEventListener("change", () => {
					if (box.checked) state.enabled.add(type);
					else state.enabled.delete(type);
					sync();
				});
				checkboxes.push({ type, box });
			}
		},
	});
	toggle.setControls(panel.panelId);

	// Restore visual state without firing onChange — the body was just rendered
	// with the current filter already applied.
	for (const { type, box } of checkboxes) {
		box.checked = state.enabled.has(type);
	}
	const tri = allState(state.enabled);
	allBox.checked = tri === "on";
	allBox.indeterminate = tri === "partial";
}
