import { App, Component, Modal } from "obsidian";
import { t } from "../lang/helpers";
import type { DashboardComponentConfig } from "../dashboard/types";
import { applyModalShell } from "./modal-shell";

export interface ComponentZoomItem {
	config: DashboardComponentConfig;
	title: string;
}

export interface ComponentZoomOptions {
	/** 本次演示可放大的组件，顺序即切换顺序（当前页当前网格的 DOM 顺序）。 */
	items: ComponentZoomItem[];
	startIndex: number;
	/** 渲染管线仍归视图所有：把一张卡片渲染进放大舞台。 */
	renderItem(host: HTMLElement, config: DashboardComponentConfig): void;
}

const NAV_STEP: Record<string, -1 | 1> = {
	ArrowLeft: -1,
	ArrowUp: -1,
	ArrowRight: 1,
	ArrowDown: 1,
};

const TOOLS_SELECTOR = ".ioto-dashboard-modal__tools";
const FIELD_SELECTOR = "input, textarea, select, [contenteditable='true']";

/**
 * 预览态的组件全屏演示层：一次一张卡片，方向键在本组组件间环绕切换。
 * 卡片本身由视图的 createCard 渲染，放大层只负责外壳、序号与切换。
 */
export class ComponentZoomModal extends Modal {
	private readonly lifecycle = new Component();
	private stageEl: HTMLElement | null = null;
	private labelEl: HTMLElement | null = null;
	private positionEl: HTMLElement | null = null;
	private index = 0;

	constructor(
		app: App,
		private readonly options: ComponentZoomOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { items } = this.options;
		if (items.length === 0) {
			this.close();
			return;
		}
		this.index = Math.min(Math.max(this.options.startIndex, 0), items.length - 1);

		applyModalShell(this, { kind: "component-zoom", startFullscreen: true });
		this.lifecycle.load();

		// 序号要和标题同排，但 applyModalShell 已把工具塞进 titleEl，先摘下再重排。
		const tools = this.titleEl.querySelector<HTMLElement>(TOOLS_SELECTOR);
		this.titleEl.empty();
		this.labelEl = this.titleEl.createSpan({
			cls: "ioto-dashboard-zoom__label",
		});
		this.positionEl = this.titleEl.createSpan({
			cls: "ioto-dashboard-zoom__position",
		});
		this.titleEl.createSpan({
			cls: "ioto-dashboard-zoom__hint",
			text: t("ZOOM_KEYBOARD_HINT"),
		});
		if (tools) this.titleEl.appendChild(tools);

		this.contentEl.addClass("ioto-dashboard-zoom");
		// 复用视图作用域的卡片样式：带上视图类，385 条 .ioto-custom-dashboard-view 规则照常命中。
		this.stageEl = this.contentEl.createDiv({
			cls: "ioto-custom-dashboard-view ioto-dashboard-zoom__stage",
		});
		this.stageEl.setAttr("tabindex", "-1");

		this.lifecycle.registerDomEvent(this.modalEl, "keydown", (event) =>
			this.handleKey(event),
		);
		this.stageEl.focus({ preventScroll: true });
		this.show(this.index);
	}

	onClose(): void {
		this.lifecycle.unload();
		this.stageEl = null;
		this.labelEl = null;
		this.positionEl = null;
		this.contentEl.empty();
	}

	private handleKey(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const step = NAV_STEP[event.key];
		if (step === undefined) return;
		// 输入控件里的方向键归用户，不抢。
		const target = event.target as HTMLElement | null;
		if (target?.closest(FIELD_SELECTOR)) return;
		event.preventDefault();
		const count = this.options.items.length;
		this.show((this.index + step + count) % count);
	}

	private show(index: number): void {
		const stage = this.stageEl;
		const item = this.options.items[index];
		if (!stage || !item) return;
		this.index = index;
		this.labelEl?.setText(item.title);
		this.positionEl?.setText(
			t("ZOOM_POSITION", [
				String(index + 1),
				String(this.options.items.length),
			]),
		);
		// 卡片自带的观察器会在脱离 DOM 时自行断开，换页只需清空舞台。
		stage.empty();
		try {
			this.options.renderItem(stage, item.config);
		} catch (error) {
			console.error("IOTO Dashboard: zoom render failed", item.config.id, error);
			stage.createDiv({
				cls: "ioto-error-state",
				text: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
