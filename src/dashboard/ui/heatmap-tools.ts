import { Menu, setIcon, setTooltip } from "obsidian";
import { t } from "../../lang/helpers";
import type { HeatmapFilter } from "../dataset/heatmap-filter";
import type { HeatmapCell, HeatmapModel } from "../dataset/heatmap-model";
import {
	formatHeatmapDay,
	presetOf,
	summarizeExtremes,
	type HeatmapExtremeSummary,
	type HeatmapPresetId,
} from "./heatmap-tools-model";

export interface HeatmapToolsCallbacks {
	locate(key: string): void;
	applyFilter(filter: HeatmapFilter): void;
	/** Clears the range; the optional flag keeps the panel's hide switch. */
	clearFilter(hideMiss?: boolean): void;
	setOpen(open: boolean): void;
}

export interface HeatmapToolsToggleHandle {
	setOpen(open: boolean): void;
	setFilterActive(active: boolean): void;
	setControls(panelId: string): void;
}

export interface HeatmapPanelHandle {
	readonly panelId: string;
	setOpen(open: boolean): void;
	refresh(filter: HeatmapFilter): void;
}

export interface HeatmapPanelOptions {
	model: HeatmapModel;
	state: HeatmapFilter;
	open: boolean;
	/** Distance from the card top to the panel top, in px. */
	topOffset?: number;
	callbacks: HeatmapToolsCallbacks;
}

const INPUT_DEBOUNCE = 150;
let panelSeq = 0;

function readInput(input: HTMLInputElement): number | null {
	const raw = input.value.trim();
	if (raw.length === 0) return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

export function mountHeatmapToolsToggle(
	header: HTMLElement,
	options: {
		open: boolean;
		filterActive?: boolean;
		onToggle(open: boolean): void;
	},
): HeatmapToolsToggleHandle {
	let open = options.open;
	const button = header.createEl("button", {
		cls: "clickable-icon ioto-heatmap-tools-toggle",
		attr: { type: "button" },
	});
	setIcon(button, "sliders-horizontal");

	const setFilterActive = (active: boolean): void => {
		const text = active
			? `${t("HEATMAP_TOOLS_TITLE")} · ${t("HEATMAP_TOOLS_FILTER_ACTIVE")}`
			: t("HEATMAP_TOOLS_TITLE");
		button.toggleClass("has-filter", active);
		button.setAttribute("aria-label", text);
		setTooltip(button, text);
	};

	const setOpen = (next: boolean): void => {
		open = next;
		button.setAttribute("aria-expanded", String(next));
	};

	setOpen(open);
	setFilterActive(options.filterActive === true);
	button.addEventListener("click", () => options.onToggle(!open));

	return {
		setOpen,
		setFilterActive,
		setControls: (panelId) => button.setAttribute("aria-controls", panelId),
	};
}

export function mountHeatmapPanel(
	host: HTMLElement,
	options: HeatmapPanelOptions,
): HeatmapPanelHandle {
	const { model, callbacks } = options;
	panelSeq += 1;
	const panelId = `ioto-heatmap-tools-panel-${panelSeq}`;
	const titleId = `${panelId}-title`;

	const panel = host.createDiv({ cls: "ioto-heatmap-tools-panel" });
	panel.id = panelId;
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-labelledby", titleId);
	if (options.topOffset !== undefined) {
		panel.style.setProperty(
			"--ioto-heatmap-panel-top",
			`${options.topOffset}px`,
		);
	}

	let lastLocated: string | null = null;
	const locate = (key: string): void => {
		lastLocated = key;
		callbacks.locate(key);
	};

	const titlebar = panel.createDiv({ cls: "ioto-heatmap-tools-titlebar" });
	const title = titlebar.createDiv({
		cls: "ioto-heatmap-tools-title",
		text: t("HEATMAP_TOOLS_TITLE"),
	});
	title.id = titleId;
	const closeButton = titlebar.createEl("button", {
		cls: "clickable-icon ioto-heatmap-tools-close",
		attr: { type: "button", "aria-label": t("HEATMAP_TOOLS_CLOSE") },
	});
	setIcon(closeButton, "x");
	setTooltip(closeButton, t("HEATMAP_TOOLS_CLOSE"));
	closeButton.addEventListener("click", () => callbacks.setOpen(false));

	const renderExtremeRow = (
		parent: HTMLElement,
		label: string,
		summary: HeatmapExtremeSummary,
	): void => {
		const firstKey = summary.firstKey;
		if (firstKey === null) return;
		const row = parent.createDiv({ cls: "ioto-heatmap-tools-extreme-row" });
		row.createSpan({
			cls: "ioto-heatmap-tools-extreme-label",
			text: label,
		});
		const link = row.createEl("button", {
			cls: "ioto-heatmap-tools-link",
			attr: { type: "button" },
		});
		const text = `${formatHeatmapDay(firstKey)} · ${summary.count}`;
		link.createSpan({
			cls: "ioto-heatmap-tools-link-text",
			text:
				summary.keys.length > 1
					? `${text} · ${t("HEATMAP_TOOLS_TIES", [String(summary.keys.length)])}`
					: text,
		});
		const chevron = link.createSpan({ cls: "ioto-heatmap-tools-chevron" });
		setIcon(chevron, "chevron-right");
		const tied = summary.keys.length > 1;
		if (tied) link.setAttribute("aria-haspopup", "menu");
		const locateLabel = tied
			? `${t("HEATMAP_TOOLS_LOCATE", [firstKey])} · ${summary.count} · ${t("HEATMAP_TOOLS_TIES", [String(summary.keys.length)])}`
			: `${t("HEATMAP_TOOLS_LOCATE", [firstKey])} · ${summary.count}`;
		link.setAttribute("aria-label", locateLabel);
		setTooltip(link, locateLabel);
		link.addEventListener("click", (event) => {
			if (summary.keys.length === 1) {
				locate(firstKey);
				return;
			}
			const menu = new Menu();
			for (const key of summary.keys) {
				menu.addItem((item) =>
					item
						.setTitle(`${formatHeatmapDay(key)} · ${summary.count}`)
						.setChecked(key === lastLocated)
						.onClick(() => locate(key)),
				);
			}
			menu.showAtMouseEvent(event);
		});
	};

	const peakKeys = model.peakKeys;
	const minActiveKeys = model.minActiveKeys;
	if (peakKeys.length > 0 || minActiveKeys.length > 0) {
		const extremes = panel.createDiv({ cls: "ioto-heatmap-tools-section" });
		renderExtremeRow(
			extremes,
			t("HEATMAP_TOOLS_PEAK"),
			summarizeExtremes(peakKeys, model.peak),
		);
		renderExtremeRow(
			extremes,
			t("HEATMAP_TOOLS_MIN_ACTIVE"),
			summarizeExtremes(minActiveKeys, model.minActive),
		);
	}

	const renderRankMenu = (
		parent: HTMLElement,
		label: string,
		rows: HeatmapCell[],
	): void => {
		const button = parent.createEl("button", {
			cls: "ioto-heatmap-tools-menu",
			attr: { type: "button", "aria-haspopup": "menu" },
		});
		button.createSpan({
			cls: "ioto-heatmap-tools-menu-label",
			text: label,
		});
		const chevron = button.createSpan({ cls: "ioto-heatmap-tools-chevron" });
		setIcon(chevron, "chevron-down");
		button.setAttribute("aria-label", label);
		button.addEventListener("click", (event) => {
			const menu = new Menu();
			for (const cell of rows) {
				menu.addItem((item) =>
					item
						.setTitle(`${formatHeatmapDay(cell.key)} · ${cell.count}`)
						.setChecked(cell.key === lastLocated)
						.onClick(() => locate(cell.key)),
				);
			}
			menu.showAtMouseEvent(event);
		});
	};

	const ranked = model.cells.filter((cell) => cell.inRange && cell.count > 0);
	if (ranked.length > 0) {
		const top = [...ranked]
			.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
			.slice(0, 5);
		const bottom = [...ranked]
			.sort((a, b) => a.count - b.count || a.key.localeCompare(b.key))
			.slice(0, 5);
		const rank = panel.createDiv({ cls: "ioto-heatmap-tools-section" });
		rank.createDiv({
			cls: "ioto-heatmap-tools-section-title",
			text: t("HEATMAP_TOOLS_RANK_SECTION"),
		});
		renderRankMenu(rank, t("HEATMAP_TOOLS_TOP"), top);
		renderRankMenu(rank, t("HEATMAP_TOOLS_BOTTOM"), bottom);
	}

	const filterSection = panel.createDiv({
		cls: "ioto-heatmap-tools-section",
	});
	filterSection.createDiv({
		cls: "ioto-heatmap-tools-section-title",
		text: t("HEATMAP_TOOLS_FILTER_SECTION"),
	});

	const fields = filterSection.createDiv({ cls: "ioto-heatmap-tools-fields" });
	const minField = fields.createEl("label", { cls: "ioto-heatmap-tools-field" });
	minField.createSpan({
		cls: "ioto-heatmap-tools-field-label",
		text: t("HEATMAP_TOOLS_MIN"),
	});
	const minInput = minField.createEl("input", {
		cls: "ioto-heatmap-tools-input",
		type: "number",
		attr: { min: "0", step: "1", inputmode: "numeric", placeholder: "0" },
	});
	const maxField = fields.createEl("label", { cls: "ioto-heatmap-tools-field" });
	maxField.createSpan({
		cls: "ioto-heatmap-tools-field-label",
		text: t("HEATMAP_TOOLS_MAX"),
	});
	const maxInput = maxField.createEl("input", {
		cls: "ioto-heatmap-tools-input",
		type: "number",
		attr: { min: "0", step: "1", inputmode: "numeric", placeholder: "0" },
	});

	let timer = 0;
	const clearTimer = (): void => {
		if (!timer) return;
		window.clearTimeout(timer);
		timer = 0;
	};
	const applyFromInputs = (): void => {
		callbacks.applyFilter({
			min: readInput(minInput),
			max: readInput(maxInput),
			hideMiss: hideMiss.checked,
		});
	};
	const scheduleApply = (): void => {
		clearTimer();
		timer = window.setTimeout(() => {
			timer = 0;
			if (!panel.isConnected) return;
			applyFromInputs();
		}, INPUT_DEBOUNCE);
	};

	for (const input of [minInput, maxInput]) {
		input.addEventListener("input", scheduleApply);
		input.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			clearTimer();
			applyFromInputs();
		});
	}

	const presetList: Array<{
		id: HeatmapPresetId;
		label: string;
		value: { min: number | null; max: number | null };
	}> = [
		{
			id: "active",
			label: t("HEATMAP_TOOLS_PRESET_ACTIVE"),
			value: { min: 1, max: null },
		},
		{
			id: "average",
			label: t("HEATMAP_TOOLS_PRESET_AVERAGE"),
			value: { min: Math.ceil(model.averageActive), max: null },
		},
		{
			id: "peak",
			label: t("HEATMAP_TOOLS_PRESET_PEAK"),
			value: { min: model.peak, max: model.peak },
		},
	];
	const segmented = filterSection.createDiv({
		cls: "ioto-heatmap-tools-segmented",
	});
	const segmentButtons = new Map<HeatmapPresetId, HTMLElement>();
	for (const preset of presetList) {
		const button = segmented.createEl("button", {
			cls: "ioto-heatmap-tools-segment",
			text: preset.label,
			attr: { type: "button", "aria-pressed": "false" },
		});
		button.addEventListener("click", () => {
			clearTimer();
			minInput.value = preset.value.min === null ? "" : String(preset.value.min);
			maxInput.value = preset.value.max === null ? "" : String(preset.value.max);
			applyFromInputs();
		});
		segmentButtons.set(preset.id, button);
	}

	const check = filterSection.createEl("label", {
		cls: "ioto-heatmap-tools-check",
	});
	const hideMiss = check.createEl("input", { type: "checkbox" });
	check.createSpan({ text: t("HEATMAP_TOOLS_HIDE_MISS") });
	hideMiss.addEventListener("change", () => {
		clearTimer();
		applyFromInputs();
	});

	const clearButton = filterSection.createEl("button", {
		cls: "ioto-heatmap-tools-clear",
		text: t("HEATMAP_TOOLS_CLEAR"),
		attr: { type: "button" },
	});
	clearButton.addEventListener("click", () => {
		clearTimer();
		callbacks.clearFilter(hideMiss.checked);
	});

	const updatePresetState = (filter: HeatmapFilter): void => {
		const active = presetOf(filter, model);
		for (const [id, button] of segmentButtons) {
			button.setAttribute("aria-pressed", String(id === active));
		}
		clearButton.toggle(filter.min !== null || filter.max !== null);
	};

	const refresh = (filter: HeatmapFilter): void => {
		if (document.activeElement !== minInput) {
			minInput.value = filter.min === null ? "" : String(filter.min);
		}
		if (document.activeElement !== maxInput) {
			maxInput.value = filter.max === null ? "" : String(filter.max);
		}
		hideMiss.checked = filter.hideMiss;
		updatePresetState(filter);
	};
	refresh(options.state);

	const focusables = (): HTMLElement[] =>
		Array.from(
			panel.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		).filter((element) => element.offsetParent !== null);

	panel.addEventListener("keydown", (event) => {
		if (event.key !== "Tab") return;
		const items = focusables();
		const first = items[0];
		const last = items[items.length - 1];
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
			return;
		}
		if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	});

	const onDocumentKeydown = (event: KeyboardEvent): void => {
		if (!panel.isConnected) {
			document.removeEventListener("keydown", onDocumentKeydown);
			return;
		}
		if (event.key !== "Escape") return;
		event.stopPropagation();
		callbacks.setOpen(false);
	};

	let outside: ((event: PointerEvent) => void) | null = null;
	const detachOutside = (): void => {
		if (!outside) return;
		document.removeEventListener("pointerdown", outside);
		outside = null;
	};
	const attachOutside = (): void => {
		if (outside) return;
		outside = (event: PointerEvent) => {
			if (!host.isConnected) {
				detachOutside();
				return;
			}
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (panel.contains(target)) return;
			if (
				target instanceof HTMLElement &&
				target.closest(".ioto-heatmap-tools-toggle")
			) {
				return;
			}
			callbacks.setOpen(false);
		};
		document.addEventListener("pointerdown", outside);
	};

	let open = options.open;
	const syncPanel = (next: boolean): void => {
		panel.toggleClass("is-open", next);
		panel.setAttribute("aria-hidden", String(!next));
		if (next) attachOutside();
		else detachOutside();
	};
	syncPanel(open);

	const focusToggle = (): void => {
		panel
			.closest(".ioto-dashboard-card")
			?.querySelector<HTMLElement>(".ioto-heatmap-tools-toggle")
			?.focus();
	};

	const setOpen = (next: boolean): void => {
		if (next === open) return;
		open = next;
		if (!next) clearTimer();
		syncPanel(next);
		if (next) {
			document.addEventListener("keydown", onDocumentKeydown);
			closeButton.focus();
			return;
		}
		document.removeEventListener("keydown", onDocumentKeydown);
		focusToggle();
	};

	if (options.open) {
		document.addEventListener("keydown", onDocumentKeydown);
	}

	return {
		panelId,
		setOpen,
		refresh,
	};
}
