import { Modal, Platform, setIcon } from "obsidian";
import { t } from "../lang/helpers";
import type { CollectionLayout } from "./collection-view";
import {
	hideMacWindowButtons,
	restoreMacWindowButtons,
} from "./macos-window-buttons";

export type ModalKind = "query-manager" | "query-editor" | "component-picker";

export interface ModalShellOptions {
	kind: ModalKind;
	/** Reuse the last known fullscreen state of this session. */
	restore?: boolean;
	/** Sets the title before the toolbar is created. */
	title?: string;
}

const sessionState = new Map<ModalKind, boolean>();
let lastFullscreen = false;

const SHELL_FLAG = "iotoShellKind";
const TOOLS_CLASS = "ioto-dashboard-modal__tools";
const CLOSE_SELECTOR =
	":scope > .modal-header-button, :scope > .modal-close-button";
const CLOSE_IN_ROW_CLASS = "is-close-in-row";
const FRAME_HIDDEN_CLASS = "is-frame-buttons-hidden";

function isFullscreen(modal: Modal): boolean {
	return modal.modalEl.classList.contains("is-fullscreen");
}

function restoreFrameButtons(modal: Modal): void {
	if (!modal.modalEl.classList.contains(FRAME_HIDDEN_CLASS)) {
		return;
	}
	restoreMacWindowButtons();
	modal.modalEl.removeClass(FRAME_HIDDEN_CLASS);
}

function setFullscreen(modal: Modal, on: boolean): void {
	modal.modalEl.toggleClass("is-fullscreen", on);
	if (!on) {
		restoreFrameButtons(modal);
		return;
	}
	// 系统原生全屏（body.is-fullscreen）本就没有窗口按钮，不用我们藏。
	// 类只在 hide 成功时挂：它是 CSS 让位缩进的豁免开关，宁缩进不遮挡。
	const hiddenByUs =
		!modal.modalEl.ownerDocument.body.classList.contains("is-fullscreen") &&
		hideMacWindowButtons();
	modal.modalEl.toggleClass(FRAME_HIDDEN_CLASS, hiddenByUs);
}

function updateFullscreenButton(button: HTMLElement, on: boolean): void {
	const label = on
		? t("MODAL_FULLSCREEN_EXIT")
		: t("MODAL_FULLSCREEN_ENTER");
	setIcon(button, on ? "exit-fullscreen" : "fullscreen");
	button.setAttribute("aria-label", label);
	button.setAttribute("title", label);
	button.setAttribute("aria-pressed", on ? "true" : "false");
}

export function applyModalShell(
	modal: Modal,
	options: ModalShellOptions,
): void {
	modal.modalEl.addClass("ioto-dashboard-modal");
	modal.modalEl.addClass(`ioto-dashboard-modal--${options.kind}`);

	if (modal.modalEl.dataset[SHELL_FLAG] === options.kind) return;

	// setTitle replaces the whole title element, so it must run before the toolbar.
	if (options.title) modal.setTitle(options.title);

	if (options.restore) {
		const remembered = sessionState.get(options.kind) ?? lastFullscreen;
		setFullscreen(modal, remembered);
	}

	modal.modalEl.dataset[SHELL_FLAG] = options.kind;

	const tools = modal.titleEl.createDiv({ cls: TOOLS_CLASS });

	if (!Platform.isMobile) {
		const button = tools.createEl("button", {
			cls: "clickable-icon ioto-dashboard-modal__fullscreen",
			attr: { type: "button" },
		});
		updateFullscreenButton(button, isFullscreen(modal));
		button.addEventListener("click", () => {
			const next = !isFullscreen(modal);
			setFullscreen(modal, next);
			updateFullscreenButton(button, next);
			sessionState.set(options.kind, next);
			lastFullscreen = next;
		});
	}

	// 核心把关闭按钮 absolute 钉在 .modal 角上，搬进 __tools 才能与工具图标同排。
	// 找不到（核心改名）不挂类，CSS 兜底为右侧留白，功能不坏。
	const closeEl = modal.modalEl.querySelector<HTMLElement>(CLOSE_SELECTOR);
	if (closeEl) {
		tools.appendChild(closeEl);
		modal.modalEl.addClass(CLOSE_IN_ROW_CLASS);
	}

	const previousOnClose = modal.onClose.bind(modal);
	modal.onClose = () => {
		const state = isFullscreen(modal);
		sessionState.set(options.kind, state);
		lastFullscreen = state;
		restoreFrameButtons(modal);
		previousOnClose();
	};
}

/**
 * Renders the list/card toggle into the modal title bar. Business state stays
 * with the caller; this only renders and reports the user's choice.
 */
export function createLayoutToggle(
	modal: Modal,
	current: CollectionLayout,
	onChange: (layout: CollectionLayout) => void,
): HTMLElement {
	const group = modal.titleEl.ownerDocument.createElement("div");
	group.addClass("ioto-dashboard-modal__layout");
	group.setAttribute("role", "group");
	group.setAttribute("aria-label", t("MODAL_LAYOUT_SWITCH"));

	const listButton = group.createEl("button", {
		cls: "clickable-icon",
		attr: { type: "button" },
	});
	const cardButton = group.createEl("button", {
		cls: "clickable-icon",
		attr: { type: "button" },
	});

	const entries: Array<{
		layout: CollectionLayout;
		button: HTMLButtonElement;
		icon: string;
		label: string;
	}> = [
		{
			layout: "list",
			button: listButton,
			icon: "list",
			label: t("MODAL_LAYOUT_LIST"),
		},
		{
			layout: "card",
			button: cardButton,
			icon: "layout-grid",
			label: t("MODAL_LAYOUT_CARD"),
		},
	];

	const render = (active: CollectionLayout): void => {
		for (const entry of entries) {
			const on = entry.layout === active;
			setIcon(entry.button, entry.icon);
			entry.button.toggleClass("is-active", on);
			entry.button.setAttribute("aria-pressed", on ? "true" : "false");
			entry.button.setAttribute("aria-label", entry.label);
			entry.button.setAttribute("title", entry.label);
		}
	};

	render(current);

	for (const entry of entries) {
		entry.button.addEventListener("click", () => {
			render(entry.layout);
			onChange(entry.layout);
		});
	}

	const tools = modal.titleEl.querySelector(`.${TOOLS_CLASS}`);
	if (tools) {
		tools.prepend(group);
	} else {
		modal.titleEl.appendChild(group);
	}

	return group;
}
