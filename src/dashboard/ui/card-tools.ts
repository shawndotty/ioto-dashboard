import { setIcon, setTooltip } from "obsidian";

/**
 * Shared shell for a card header toggle plus an absolutely positioned panel.
 * Heatmap and arrange panels keep their own content and class names.
 */
export interface CardToolsClasses {
	panel: string;
	titlebar: string;
	title: string;
	close: string;
	toggle: string;
}

export const HEATMAP_TOOL_CLASSES: CardToolsClasses = {
	panel: "ioto-heatmap-tools-panel",
	titlebar: "ioto-heatmap-tools-titlebar",
	title: "ioto-heatmap-tools-title",
	close: "ioto-heatmap-tools-close",
	toggle: "ioto-heatmap-tools-toggle",
};

export const ARRANGE_TOOL_CLASSES: CardToolsClasses = {
	panel: "ioto-arrange-panel",
	titlebar: "ioto-arrange-titlebar",
	title: "ioto-arrange-title",
	close: "ioto-arrange-close",
	toggle: "ioto-arrange-toggle",
};

let panelSeq = 0;

export interface CardToolsToggleOptions {
	icon: string;
	title: string;
	open: boolean;
	active?: boolean;
	/** Tooltip while active; defaults to `title`. */
	activeTitle?: string;
	classes?: CardToolsClasses;
	onToggle(open: boolean): void;
}

export interface CardToolsToggleHandle {
	setOpen(open: boolean): void;
	setActive(active: boolean, activeTitle?: string): void;
	setControls(panelId: string): void;
}

export function mountCardToolsToggle(
	header: HTMLElement,
	options: CardToolsToggleOptions,
): CardToolsToggleHandle {
	const classes = options.classes ?? ARRANGE_TOOL_CLASSES;
	let open = options.open;
	let active = options.active === true;
	let activeTitle = options.activeTitle;

	const button = header.createEl("button", {
		cls: `clickable-icon ${classes.toggle}`,
		attr: { type: "button" },
	});
	setIcon(button, options.icon);

	const applyLabel = (): void => {
		const text = active ? (activeTitle ?? options.title) : options.title;
		button.setAttribute("aria-label", text);
		setTooltip(button, text);
	};

	const setActive = (next: boolean, nextActiveTitle?: string): void => {
		active = next;
		if (nextActiveTitle !== undefined) activeTitle = nextActiveTitle;
		button.toggleClass("has-filter", active);
		applyLabel();
	};

	const setOpen = (next: boolean): void => {
		open = next;
		button.setAttribute("aria-expanded", String(next));
	};

	setOpen(open);
	setActive(active);
	button.addEventListener("click", () => options.onToggle(!open));

	return {
		setOpen,
		setActive,
		setControls: (panelId) => button.setAttribute("aria-controls", panelId),
	};
}

export interface CardToolsPanelOptions {
	/** The card element; the panel is absolutely positioned inside it. */
	host: HTMLElement;
	classes?: CardToolsClasses;
	title: string;
	closeLabel: string;
	open: boolean;
	/** Distance from the card top to the panel top, in px. */
	topOffset?: number;
	/** CSS custom property carrying `topOffset`. */
	topVar?: string;
	/** Called when the user asks to close (close button, Escape, outside click). */
	setOpen(open: boolean): void;
	/** Renders panel content into the shell's flex column. */
	buildContent(panel: HTMLElement): void;
}

export interface CardToolsPanelHandle {
	readonly panelId: string;
	readonly open: boolean;
	/** The panel element itself; content built later must go after the titlebar. */
	readonly panelEl: HTMLElement;
	/** Applies visual state without notifying `setOpen`. */
	setOpen(open: boolean): void;
}

export function mountCardToolsPanel(
	options: CardToolsPanelOptions,
): CardToolsPanelHandle {
	const classes = options.classes ?? ARRANGE_TOOL_CLASSES;
	const host = options.host;
	const topVar = options.topVar ?? "--ioto-arrange-panel-top";

	panelSeq += 1;
	const panelId = `ioto-card-tools-panel-${panelSeq}`;
	const titleId = `${panelId}-title`;

	const panel = host.createDiv({ cls: classes.panel });
	panel.id = panelId;
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-labelledby", titleId);
	if (options.topOffset !== undefined) {
		panel.style.setProperty(topVar, `${options.topOffset}px`);
	}

	const titlebar = panel.createDiv({ cls: classes.titlebar });
	const title = titlebar.createDiv({ cls: classes.title, text: options.title });
	title.id = titleId;
	const closeButton = titlebar.createEl("button", {
		cls: `clickable-icon ${classes.close}`,
		attr: { type: "button", "aria-label": options.closeLabel },
	});
	setIcon(closeButton, "x");
	setTooltip(closeButton, options.closeLabel);
	closeButton.addEventListener("click", () => options.setOpen(false));

	options.buildContent(panel);

	const focusables = (): HTMLElement[] =>
		Array.from(
			panel.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
		options.setOpen(false);
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
				target.closest(`.${classes.toggle}`)
			) {
				return;
			}
			options.setOpen(false);
		};
		document.addEventListener("pointerdown", outside);
	};

	let open = options.open;
	const focusToggle = (): void => {
		host.querySelector<HTMLElement>(`.${classes.toggle}`)?.focus();
	};

	const setOpen = (next: boolean): void => {
		if (next === open) return;
		open = next;
		panel.toggleClass("is-open", next);
		panel.setAttribute("aria-hidden", String(!next));
		if (next) {
			attachOutside();
			document.addEventListener("keydown", onDocumentKeydown);
			closeButton.focus();
			return;
		}
		detachOutside();
		document.removeEventListener("keydown", onDocumentKeydown);
		focusToggle();
	};

	panel.toggleClass("is-open", open);
	panel.setAttribute("aria-hidden", String(!open));
	if (open) document.addEventListener("keydown", onDocumentKeydown);

	return {
		panelId,
		get open() {
			return open;
		},
		panelEl: panel,
		setOpen,
	};
}