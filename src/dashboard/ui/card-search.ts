import { setIcon } from "obsidian";
import type { DashboardComponentConfig } from "../types";

export interface CardSearchLabels {
	/** aria-label / title of the search icon button. */
	toggle: string;
	placeholder: string;
	/** aria-label / title of the exit button. */
	close: string;
}

export interface CardSearchHandle {
	readonly text: string;
	readonly open: boolean;
	/** Re-applies the stored keyword and expansion to a freshly built header. */
	restore(): void;
}

interface CardSearchState {
	queryId: string;
	text: string;
	open: boolean;
}

const states = new WeakMap<DashboardComponentConfig, CardSearchState>();

/** Switching queries drops the previous keyword so cards never filter stale text. */
function stateOf(config: DashboardComponentConfig): CardSearchState {
	let state = states.get(config);
	if (!state || state.queryId !== config.queryId) {
		state = { queryId: config.queryId, text: "", open: false };
		states.set(config, state);
	}
	return state;
}

/** Keyword kept across card re-renders; read during the render pass. */
export function cardSearchText(config: DashboardComponentConfig): string {
	return stateOf(config).text;
}

export function mountCardSearch(
	header: HTMLElement,
	options: {
		config: DashboardComponentConfig;
		labels: CardSearchLabels;
		onChange(text: string): void;
	},
): CardSearchHandle {
	const state = stateOf(options.config);
	const { labels } = options;

	const toggle = header.createEl("button", {
		cls: "clickable-icon ioto-card-search-toggle",
		attr: {
			type: "button",
			"aria-label": labels.toggle,
			title: labels.toggle,
			"aria-expanded": String(state.open),
		},
	});
	setIcon(toggle, "search");

	const search = header.createDiv({
		cls: "ioto-card-search",
		attr: { role: "search" },
	});
	const searchIcon = search.createDiv({ cls: "ioto-card-search-icon" });
	searchIcon.setAttr("aria-hidden", "true");
	setIcon(searchIcon, "search");
	const input = search.createEl("input", {
		cls: "ioto-card-search-input",
		type: "search",
		attr: {
			"aria-label": labels.placeholder,
			placeholder: labels.placeholder,
		},
	});
	const exit = search.createEl("button", {
		cls: "clickable-icon ioto-card-search-exit",
		attr: {
			type: "button",
			"aria-label": labels.close,
			title: labels.close,
		},
	});
	setIcon(exit, "x");

	const setOpen = (open: boolean): void => {
		state.open = open;
		header.toggleClass("is-searching", open);
		search.toggleClass("is-open", open);
		toggle.setAttr("aria-expanded", String(open));
	};
	const closeSearch = (): void => {
		input.value = "";
		state.text = "";
		options.onChange("");
		setOpen(false);
		// 必须在收起之后聚焦，否则按钮仍为 display:none。
		toggle.focus();
	};

	const handle: CardSearchHandle = {
		get text() {
			return state.text;
		},
		get open() {
			return state.open;
		},
		restore() {
			input.value = state.text;
			setOpen(state.open);
			if (state.text.length > 0) options.onChange(state.text);
		},
	};

	toggle.addEventListener("click", () => {
		setOpen(true);
		input.focus();
		input.select();
	});

	input.addEventListener("input", (event) => {
		state.text = input.value;
		if ((event as InputEvent).isComposing) return;
		options.onChange(state.text);
	});
	input.addEventListener("compositionend", () => {
		state.text = input.value;
		options.onChange(state.text);
	});
	input.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		event.stopPropagation();
		closeSearch();
	});

	exit.addEventListener("click", closeSearch);

	// 恢复上次状态，但不抢焦点（数据刷新可能重建卡片）。
	handle.restore();
	return handle;
}
