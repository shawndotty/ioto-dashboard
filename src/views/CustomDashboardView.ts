import {
	ItemView,
	Notice,
	TFile,
	ViewStateResult,
	WorkspaceLeaf,
} from "obsidian";
import { CUSTOM_DASHBOARD_VIEW_TYPE } from "../models/constants";
import type IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { createComponentRegistry } from "../dashboard/components";
import { DataHub } from "../dashboard/data-hub";
import {
	dropIndex,
	gridMetrics,
	snapSize,
	stepSize,
	type CardRect,
	type GridMetrics,
} from "../dashboard/layout";
import {
	boundsForType,
	clampSize,
	type ComponentDefinition,
	type ComponentStatus,
	type SizeBounds,
} from "../dashboard/registry";
import {
	type DashboardComponentConfig,
	type DashboardPage,
	type DashboardStoreData,
} from "../dashboard/types";
import { metricKey, type MetricRequest, type MetricResult, type ProjectProgressGroup } from "../metrics/types";
import { QueryRepository } from "../query/repository";
import type { QueryDefinition } from "../query/types";
import { ComponentPickerModal } from "../ui/component-picker";
import { ConfirmModal } from "../ui/ConfirmModal";
import { PageNameModal } from "../ui/page-name-modal";
import { QueryEditModal, QueryManagerModal } from "../ui/query-editor";

export class CustomDashboardView extends ItemView {
	private store: DashboardStoreData | null = null;
	private leafPageId: string | null = null;
	private hub: DataHub | null = null;
	private registry = createComponentRegistry();
	private editMode = false;
	private damaged = false;
	private unsubscribers: Array<() => void> = [];
	private interacting = false;
	private renderDeferred = false;
	private isNarrow = false;
	private resizeObserver: ResizeObserver | null = null;
	private pendingFocus: { componentId: string; action: string } | null = null;
	private dataVersion = 0;
	private queriesVersion = 0;
	private toolbarEl: HTMLElement | null = null;
	private bannerEl: HTMLElement | null = null;
	private pagesEl: HTMLElement | null = null;
	private emptyEl: HTMLElement | null = null;
	private gridEl: HTMLElement | null = null;
	private toolbarSignature = "";
	private pagesSignature = "";
	private dragGhost: HTMLElement | null = null;
	private resizeOverlays: {
		ghost: HTMLElement;
		snap: HTMLElement;
	} | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: IotoDashboardPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return CUSTOM_DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("CUSTOM_DASHBOARD_TITLE");
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("ioto-custom-dashboard-view");
		this.resetShell();
		await this.loadStore();

		const fallback =
			this.store?.activePageId ?? this.store?.pages[0]?.id ?? null;
		if (
			!this.leafPageId ||
			!this.store?.pages.some((page) => page.id === this.leafPageId)
		) {
			this.leafPageId = fallback;
		}

		this.hub = new DataHub({
			index: this.plugin.index,
			getQueries: () => this.queryRepository(),
			getIndexConfig: () => this.plugin.getIndexConfig(),
			getCustomFilters: () => this.plugin.settings.customFilters,
			snapshotStore: this.plugin.snapshotStore,
		});
		this.unsubscribers.push(
			this.hub.subscribe(() => {
				this.dataVersion += 1;
				this.requestRender();
			}),
		);
		this.unsubscribers.push(
			this.plugin.index.subscribe(() => this.hub?.scheduleRefresh()),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.updateVisibility()),
		);
		this.registerDomEvent(document, "visibilitychange", () =>
			this.updateVisibility(),
		);
		this.observeContainerWidth();
		this.render();
		this.updateVisibility();
	}

	async onClose(): Promise<void> {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.unsubscribers = [];
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.removeDragGhost();
		this.removeResizeOverlays();
		this.hub?.destroy();
		this.hub = null;
	}

	private updateVisibility(): void {
		const visible = this.containerEl.isShown();
		this.hub?.setVisible(visible);
	}

	private async loadStore(): Promise<void> {
		const result = await this.plugin.dashboardRepository.load();
		this.store = result.store;
		this.damaged = result.damaged;
		if (result.damaged) {
			new Notice(t("DASHBOARD_STORE_DAMAGED"), 8000);
		}
	}

	private queryRepository(): QueryRepository {
		return new QueryRepository(
			this.plugin.settings.savedQueries,
			this.store?.queries ?? [],
			{
				inputFolder: this.plugin.settings.inputFolder,
				outputFolder: this.plugin.settings.outputFolder,
				taskFolder: this.plugin.settings.taskFolder,
				outcomeFolder: this.plugin.settings.outcomeFolder,
			},
		);
	}

	getState() {
		return {
			activePageId: this.leafPageId ?? this.store?.activePageId,
		};
	}

	async setState(state: unknown, result: ViewStateResult) {
		const s = (state ?? {}) as { activePageId?: unknown };
		if (typeof s.activePageId === "string") {
			this.leafPageId = s.activePageId;
		}
		await super.setState(state, result);
		if (this.store) {
			// A restored layout may point at a page that has been deleted.
			if (!this.store.pages.some((page) => page.id === this.leafPageId)) {
				this.leafPageId = this.store.pages[0]?.id ?? null;
			}
			this.render();
		}
	}

	private get activePage(): DashboardPage | undefined {
		if (!this.store) return undefined;
		return (
			this.store.pages.find((page) => page.id === this.leafPageId) ??
			this.store.pages[0]
		);
	}

	private resetShell(): void {
		this.toolbarEl = null;
		this.bannerEl = null;
		this.pagesEl = null;
		this.emptyEl = null;
		this.gridEl = null;
		this.toolbarSignature = "";
		this.pagesSignature = "";
	}

	private render(): void {
		const scrollTop = this.contentEl.scrollTop;
		this.contentEl.addClass("ioto-custom-dashboard-view");
		this.ensureShell();
		this.syncToolbar();
		this.syncBanner();
		this.syncPagesBar();

		const page = this.activePage;
		if (!page || page.components.length === 0) {
			this.setEmptyVisible(true);
			this.publishRequests();
		} else {
			this.setEmptyVisible(false);
			const grid = this.ensureGrid();
			this.syncCards(grid, page.components);
			this.publishRequests();
		}

		this.contentEl.scrollTop = scrollTop;
		this.restoreFocus();
	}

	private ensureShell(): void {
		if (!this.toolbarEl) {
			this.toolbarEl = this.contentEl.createDiv({
				cls: "ioto-dashboard-toolbar",
			});
		}
		if (!this.pagesEl) {
			this.pagesEl = this.contentEl.createDiv({
				cls: "ioto-dashboard-pages",
			});
		}
	}

	private syncToolbar(): void {
		const signature = this.editMode ? "edit" : "view";
		if (signature === this.toolbarSignature) return;
		this.toolbarSignature = signature;
		const toolbar = this.toolbarEl;
		if (!toolbar) return;
		toolbar.empty();
		toolbar.createEl("h2", { text: t("CUSTOM_DASHBOARD_TITLE") });
		const actions = toolbar.createDiv({ cls: "ioto-dashboard-actions" });
		this.addToolbarButton(actions, "edit", t("DASHBOARD_MANAGE_QUERIES"), () =>
			this.openQueryManager(),
		);
		if (this.editMode) {
			this.addToolbarButton(
				actions,
				"plus",
				t("DASHBOARD_ADD_COMPONENT"),
				() => this.openComponentPicker(),
			);
		}
		this.addToolbarButton(
			actions,
			this.editMode ? "eye" : "pencil",
			this.editMode ? t("DASHBOARD_VIEW_MODE") : t("DASHBOARD_EDIT_MODE"),
			() => {
				this.editMode = !this.editMode;
				this.render();
			},
		);
	}

	private syncBanner(): void {
		if (!this.damaged) {
			this.bannerEl?.remove();
			this.bannerEl = null;
			return;
		}
		if (this.bannerEl) return;
		this.bannerEl = this.contentEl.createDiv({
			cls: "ioto-dashboard-banner",
			text: t("DASHBOARD_STORE_DAMAGED"),
		});
		this.toolbarEl?.insertAdjacentElement("afterend", this.bannerEl);
	}

	private setEmptyVisible(visible: boolean): void {
		if (!visible) {
			this.emptyEl?.remove();
			this.emptyEl = null;
			return;
		}
		this.gridEl?.remove();
		this.gridEl = null;
		if (this.emptyEl) return;
		const empty = this.contentEl.createDiv({ cls: "ioto-dashboard-empty" });
		this.emptyEl = empty;
		empty.createEl("h3", { text: t("DASHBOARD_EMPTY_TITLE") });
		empty.createEl("p", { text: t("DASHBOARD_EMPTY_DESC") });
		const button = empty.createEl("button", {
			text: t("DASHBOARD_ADD_COMPONENT"),
			cls: "mod-cta",
		});
		button.onClickEvent(() => this.openComponentPicker());
	}

	private ensureGrid(): HTMLElement {
		if (!this.gridEl) {
			this.gridEl = this.contentEl.createDiv({ cls: "ioto-dashboard-grid" });
		}
		return this.gridEl;
	}

	private syncPagesBar(): void {
		const pages = this.store?.pages ?? [];
		const signature = [
			this.editMode ? "edit" : "view",
			this.activePage?.id ?? "",
			pages.map((page) => `${page.id}:${page.name}`).join("|"),
		].join("#");
		if (signature === this.pagesSignature) return;
		this.pagesSignature = signature;
		const pagesBar = this.pagesEl;
		if (!pagesBar) return;
		pagesBar.empty();
		for (const page of pages) {
			const active = page.id === this.activePage?.id;
			const tab = pagesBar.createEl("button", {
				cls: `ioto-dashboard-page-tab${active ? " is-active" : ""}`,
				attr: { "aria-pressed": active ? "true" : "false" },
			});
			tab.createSpan({
				cls: "ioto-dashboard-page-tab-label",
				text: page.name,
			});
			tab.onClickEvent(() => this.switchPage(page.id));
			tab.addEventListener("dblclick", () => this.openRenamePage(page));
			if (this.editMode) {
				this.renderPageTabTools(tab, page);
			}
		}
		if (this.editMode) {
			const add = pagesBar.createEl("button", {
				cls: "ioto-dashboard-page-add clickable-icon",
				attr: { "aria-label": t("PAGE_TABS_ADD"), title: t("PAGE_TABS_ADD") },
				text: "+",
			});
			add.onClickEvent(() => void this.createPage());
		}
	}

	private renderPageTabTools(tab: HTMLElement, page: DashboardPage): void {
		const rename = tab.createEl("button", {
			cls: "ioto-dashboard-page-close",
			attr: { "aria-label": t("PAGE_RENAME"), title: t("PAGE_RENAME") },
			text: "✎",
		});
		rename.onClickEvent((event) => {
			event.stopPropagation();
			this.openRenamePage(page);
		});
		const remove = tab.createEl("button", {
			cls: "ioto-dashboard-page-close",
			attr: { "aria-label": t("PAGE_DELETE"), title: t("PAGE_DELETE") },
			text: "×",
		});
		remove.onClickEvent((event) => {
			event.stopPropagation();
			this.confirmRemovePage(page);
		});
	}

	private switchPage(pageId: string): void {
		if (pageId === this.activePage?.id) return;
		this.leafPageId = pageId;
		this.render();
		this.app.workspace.requestSaveLayout();
		void this.plugin.dashboardRepository.setActivePage(pageId);
	}

	private async createPage(): Promise<void> {
		const taken = new Set(this.store?.pages.map((page) => page.id) ?? []);
		let id = `page:${Date.now()}`;
		let n = 2;
		while (taken.has(id)) id = `page:${Date.now()}-${n++}`;
		const page: DashboardPage = {
			id,
			name: t("PAGE_DEFAULT_NAME", [String((this.store?.pages.length ?? 0) + 1)]),
			components: [],
		};
		this.store = await this.plugin.dashboardRepository.addPage(page);
		this.leafPageId = id;
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	private openRenamePage(page: DashboardPage): void {
		new PageNameModal(this.app, page.name, (name) => {
			void (async () => {
				this.store = await this.plugin.dashboardRepository.renamePage(
					page.id,
					name,
				);
				this.render();
			})();
		}).open();
	}

	private confirmRemovePage(page: DashboardPage): void {
		if ((this.store?.pages.length ?? 0) <= 1) {
			new Notice(t("PAGE_LAST_CANNOT_DELETE"));
			return;
		}
		new ConfirmModal(
			this.app,
			t("PAGE_DELETE_TITLE"),
			t("PAGE_DELETE_MSG", [page.name, String(page.components.length)]),
			() => {
				void (async () => {
					this.store = await this.plugin.dashboardRepository.removePage(
						page.id,
					);
					if (this.leafPageId === page.id) {
						this.leafPageId = this.store?.pages[0]?.id ?? null;
					}
					this.render();
					this.app.workspace.requestSaveLayout();
				})();
			},
		).open();
	}

	private addToolbarButton(
		container: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void {
		const button = container.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": label, title: label },
		});
		button.createSpan({ cls: "ioto-button-label", text: label });
		button.setAttr("data-icon", icon);
		button.onClickEvent(onClick);
	}

	/**
	 * Reconciles the grid with the store: unchanged cards keep their DOM node,
	 * only changed or missing ones are rebuilt; order changes are minimal moves.
	 */
	private syncCards(
		grid: HTMLElement,
		components: readonly DashboardComponentConfig[],
	): void {
		for (const overlay of Array.from(
			grid.querySelectorAll(".ioto-card-resize-ghost, .ioto-card-resize-snap"),
		)) {
			overlay.remove();
		}
		const queries = this.queryRepository();
		const existing = new Map<string, HTMLElement>();
		for (const child of Array.from(grid.children)) {
			const element = child as HTMLElement;
			const id = element.dataset.componentId;
			if (id) existing.set(id, element);
		}
		const wanted = new Set(components.map((config) => config.id));
		for (const [id, element] of existing) {
			if (wanted.has(id)) continue;
			element.remove();
			existing.delete(id);
		}
		const nodes: HTMLElement[] = [];
		for (const config of components) {
			const signature = this.cardSignature(config);
			let element = existing.get(config.id);
			if (!element || element.dataset.cardSignature !== signature) {
				const next = this.createCard(grid, config, queries);
				next.dataset.cardSignature = signature;
				if (element) element.replaceWith(next);
				else grid.appendChild(next);
				element = next;
				existing.set(config.id, element);
			}
			nodes.push(element);
		}
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index];
			const current = grid.children[index] as HTMLElement | undefined;
			if (node && current !== node) {
				grid.insertBefore(node, current ?? null);
			}
		}
	}

	/** Rebuild triggers: config, edit state, data refresh and query edits. */
	private cardSignature(config: DashboardComponentConfig): string {
		const size = clampSize(config.w, config.h, this.boundsFor(config));
		return [
			config.type,
			config.queryId,
			config.basis ?? "",
			String(config.limit ?? ""),
			config.title ?? "",
			String(size.w),
			String(size.h),
			this.editMode ? "edit" : "view",
			String(this.dataVersion),
			String(this.queriesVersion),
		].join("|");
	}

	private createCard(
		grid: HTMLElement,
		config: DashboardComponentConfig,
		queries: QueryRepository,
	): HTMLElement {
		const definition = this.registry.get(config.type);
		const query = queries.get(config.queryId);
		const result = this.hub?.getResults().get(this.metricKeyOf(config));
		const card = grid.ownerDocument.createElement("div");
		card.addClass("ioto-dashboard-card");
		card.setAttr("data-component-id", config.id);
		const size = clampSize(config.w, config.h, this.boundsFor(config));
		card.style.gridColumn = `span ${size.w}`;
		card.style.gridRow = `span ${size.h}`;

		const header = card.createDiv({ cls: "ioto-dashboard-card-header" });
		if (this.editMode) {
			this.renderDragHandle(header, grid, card, config);
		}
		header.createDiv({
			cls: "ioto-dashboard-card-title",
			text:
				config.title ??
				(definition
					? t(definition.labelKey as Parameters<typeof t>[0])
					: config.type),
		});
		if (this.editMode) {
			this.renderRenameButton(header, config);
			this.renderRemoveButton(header, config);
		}

		if (this.editMode) {
			const toolbar = card.createDiv({
				cls: "ioto-dashboard-card-toolbar",
			});
			this.renderCardToolbar(toolbar, config, queries);
		}

		const body = card.createDiv({ cls: "ioto-dashboard-card-body" });
		if (this.editMode) {
			this.renderResizeHandle(card, grid, config);
		}
		if (!definition) {
			this.registry.placeholder(body, config.type);
			return card;
		}

		const { status, messageKey } = this.statusOf(definition, query, result);
		if (status === "loading") {
			body.createDiv({ cls: "ioto-loading", text: t("DASHBOARD_LOADING") });
			return card;
		}
		if (status === "error") {
			body.createDiv({
				cls: "ioto-error-state",
				text: t(
					(messageKey ?? "DASHBOARD_ERROR_CONFIG") as Parameters<typeof t>[0],
				),
			});
			return card;
		}
		definition.render(body, {
			config,
			query,
			result,
			status,
			messageKey,
			editMode: this.editMode,
			openNote: (path, line) => void this.openNote(path, line),
			openProject: (group) => void this.openProject(group),
		});
		return card;
	}

	private statusOf(
		definition: ComponentDefinition,
		query: QueryDefinition | undefined,
		result: MetricResult | undefined,
	): { status: ComponentStatus; messageKey?: string } {
		if (!query) return { status: "error", messageKey: "DASHBOARD_ERROR_CONFIG" };
		if (this.hub?.isLoading() && !result) return { status: "loading" };
		if (!result) return { status: "loading" };
		if (definition.isEmpty(result)) return { status: "empty" };
		return { status: "ready" };
	}

	private renderDragHandle(
		header: HTMLElement,
		grid: HTMLElement,
		card: HTMLElement,
		config: DashboardComponentConfig,
	): void {
		const handle = header.createEl("button", {
			cls: "clickable-icon ioto-card-drag-handle",
			attr: {
				type: "button",
				"aria-label": t("DASHBOARD_DRAG_HANDLE"),
				title: t("DASHBOARD_DRAG_HANDLE"),
				"data-action": "drag",
			},
			text: "⋮⋮",
		});
		handle.addEventListener("pointerdown", (event) =>
			this.armDragSort(grid, card, config.id, event),
		);
	}

	private renderRenameButton(
		header: HTMLElement,
		config: DashboardComponentConfig,
	): void {
		const rename = header.createEl("button", {
			cls: "clickable-icon ioto-card-rename",
			attr: {
				type: "button",
				"aria-label": t("DASHBOARD_RENAME_COMPONENT"),
				title: t("DASHBOARD_RENAME_COMPONENT"),
				"data-action": "rename",
			},
			text: "✎",
		});
		rename.onClickEvent(() => this.openRenameComponent(config));
	}

	private renderRemoveButton(
		header: HTMLElement,
		config: DashboardComponentConfig,
	): void {
		const remove = header.createEl("button", {
			cls: "clickable-icon",
			attr: {
				type: "button",
				"aria-label": t("DASHBOARD_CONFIG_REMOVE"),
				title: t("DASHBOARD_CONFIG_REMOVE"),
				"data-action": "remove",
			},
			text: "×",
		});
		remove.onClickEvent(async () => {
			const pageId = this.activePage?.id;
			if (!pageId) return;
			this.store = await this.plugin.dashboardRepository.removeComponent(
				pageId,
				config.id,
			);
			this.render();
		});
	}

	private renderCardToolbar(
		toolbar: HTMLElement,
		config: DashboardComponentConfig,
		queries: QueryRepository,
	): void {
		const select = toolbar.createEl("select", {
			cls: "dropdown ioto-card-query",
		});
		for (const query of queries.list()) {
			const option = select.createEl("option", {
				text: query.nameKey
					? t(query.nameKey as Parameters<typeof t>[0])
					: query.name,
				value: query.id,
			});
			if (query.id === config.queryId) option.selected = true;
		}
		select.addEventListener("change", (event) => {
			const target = event.target as HTMLSelectElement;
			void this.updateComponent(config.id, { queryId: target.value });
		});

		const basis = toolbar.createEl("select", {
			cls: "dropdown ioto-card-basis",
		});
		for (const value of ["file", "section"]) {
			const option = basis.createEl("option", {
				text: t(value === "file" ? "KPI_BASIS_FILE" : "KPI_BASIS_SECTION"),
				value,
			});
			if ((config.basis ?? "file") === value) option.selected = true;
		}
		basis.addEventListener("change", (event) => {
			const target = event.target as HTMLSelectElement;
			void this.updateComponent(config.id, {
				basis: target.value === "section" ? "section" : "file",
			});
		});

		this.renderSizeControls(toolbar, config);
		this.renderOrderControls(toolbar, config);
	}

	private boundsFor(config: DashboardComponentConfig): SizeBounds {
		return boundsForType(this.registry, config.type);
	}

	private defaultSizeFor(
		config: DashboardComponentConfig,
		bounds: SizeBounds,
	): { w: number; h: number } {
		const definition = this.registry.get(config.type);
		const defaults = definition?.createConfig(definition.defaultQueryId);
		return clampSize(defaults?.w, defaults?.h, bounds);
	}

	private renderSizeControls(
		toolbar: HTMLElement,
		config: DashboardComponentConfig,
	): void {
		const bounds = this.boundsFor(config);
		const size = clampSize(config.w, config.h, bounds);
		const group = toolbar.createDiv({ cls: "ioto-card-size-controls" });

		if (size.h <= bounds.minH) {
			group.setAttr("title", t("DASHBOARD_SIZE_MIN_HINT", [String(bounds.minH)]));
		} else if (size.h >= bounds.maxH) {
			group.setAttr("title", t("DASHBOARD_SIZE_MAX_HINT", [String(bounds.maxH)]));
		}

		group.createSpan({
			cls: "ioto-card-control-label",
			text: t("DASHBOARD_WIDTH"),
		});
		this.renderStepButton(
			group,
			"width-dec",
			"−",
			`${t("DASHBOARD_DECREASE")} ${t("DASHBOARD_WIDTH")} ${size.w}`,
			size.w <= bounds.minW,
			config.id,
			() => void this.stepComponentSize(config.id, "w", -1),
		);
		group.createSpan({
			cls: "ioto-card-control-value",
			text: String(size.w),
		});
		this.renderStepButton(
			group,
			"width-inc",
			"+",
			`${t("DASHBOARD_INCREASE")} ${t("DASHBOARD_WIDTH")} ${size.w}`,
			size.w >= bounds.maxW,
			config.id,
			() => void this.stepComponentSize(config.id, "w", 1),
		);

		group.createSpan({
			cls: "ioto-card-control-label",
			text: t("DASHBOARD_HEIGHT"),
		});
		this.renderStepButton(
			group,
			"height-dec",
			"−",
			`${t("DASHBOARD_DECREASE")} ${t("DASHBOARD_HEIGHT")} ${size.h}`,
			size.h <= bounds.minH,
			config.id,
			() => void this.stepComponentSize(config.id, "h", -1),
			t("DASHBOARD_SIZE_MIN_HINT", [String(bounds.minH)]),
		);
		group.createSpan({
			cls: "ioto-card-control-value",
			text: `${size.h} / ${bounds.maxH}`,
		});
		this.renderStepButton(
			group,
			"height-inc",
			"+",
			`${t("DASHBOARD_INCREASE")} ${t("DASHBOARD_HEIGHT")} ${size.h}`,
			size.h >= bounds.maxH,
			config.id,
			() => void this.stepComponentSize(config.id, "h", 1),
			t("DASHBOARD_SIZE_MAX_HINT", [String(bounds.maxH)]),
		);

		const defaults = this.defaultSizeFor(config, bounds);
		this.renderStepButton(
			group,
			"size-reset",
			"↺",
			t("DASHBOARD_RESET_SIZE"),
			size.w === defaults.w && size.h === defaults.h,
			config.id,
			() => void this.resetComponentSize(config.id),
		);
	}

	private renderOrderControls(
		toolbar: HTMLElement,
		config: DashboardComponentConfig,
	): void {
		const page = this.activePage;
		const index =
			page?.components.findIndex((item) => item.id === config.id) ?? -1;
		const last = (page?.components.length ?? 0) - 1;
		const group = toolbar.createDiv({ cls: "ioto-card-order-controls" });
		this.renderStepButton(
			group,
			"move-up",
			"↑",
			t("DASHBOARD_MOVE_UP"),
			index <= 0,
			config.id,
			() => void this.nudgeComponent(config.id, -1),
		);
		this.renderStepButton(
			group,
			"move-down",
			"↓",
			t("DASHBOARD_MOVE_DOWN"),
			index < 0 || index >= last,
			config.id,
			() => void this.nudgeComponent(config.id, 1),
		);
	}

	private renderStepButton(
		container: HTMLElement,
		action: string,
		label: string,
		ariaLabel: string,
		disabled: boolean,
		componentId: string,
		onStep: () => void,
		hint?: string,
	): void {
		const labelText = disabled && hint ? hint : ariaLabel;
		const button = container.createEl("button", {
			cls: "clickable-icon ioto-card-step",
			attr: {
				type: "button",
				"aria-label": labelText,
				title: labelText,
				"data-action": action,
			},
			text: label,
		});
		button.disabled = disabled;
		button.onClickEvent(() => {
			this.pendingFocus = { componentId, action };
			onStep();
		});
	}

	private async stepComponentSize(
		componentId: string,
		axis: "w" | "h",
		direction: -1 | 1,
	): Promise<void> {
		const page = this.activePage;
		const config = page?.components.find((item) => item.id === componentId);
		if (!page || !config) return;
		const bounds = this.boundsFor(config);
		const current = clampSize(config.w, config.h, bounds);
		const next = stepSize(config.w, config.h, axis, direction, bounds);
		if (next.w === current.w && next.h === current.h) return;
		this.pendingFocus = {
			componentId,
			action: `${axis === "w" ? "width" : "height"}-${direction < 0 ? "dec" : "inc"}`,
		};
		this.store = await this.plugin.dashboardRepository.updateComponent(
			page.id,
			componentId,
			next,
		);
		this.render();
	}

	private async resetComponentSize(componentId: string): Promise<void> {
		const page = this.activePage;
		const config = page?.components.find((item) => item.id === componentId);
		if (!page || !config) return;
		const bounds = this.boundsFor(config);
		const current = clampSize(config.w, config.h, bounds);
		const defaults = this.defaultSizeFor(config, bounds);
		if (defaults.w === current.w && defaults.h === current.h) return;
		this.pendingFocus = { componentId, action: "size-reset" };
		this.store = await this.plugin.dashboardRepository.updateComponent(
			page.id,
			componentId,
			defaults,
		);
		this.render();
	}

	private async nudgeComponent(
		componentId: string,
		offset: -1 | 1,
	): Promise<void> {
		const page = this.activePage;
		if (!page) return;
		const from = page.components.findIndex((item) => item.id === componentId);
		const to = from + offset;
		if (from < 0 || to < 0 || to >= page.components.length) return;
		this.pendingFocus = {
			componentId,
			action: offset < 0 ? "move-up" : "move-down",
		};
		this.store = await this.plugin.dashboardRepository.moveComponent(
			page.id,
			componentId,
			to,
		);
		this.render();
	}

	private openRenameComponent(config: DashboardComponentConfig): void {
		new PageNameModal(
			this.app,
			config.title ?? "",
			(name) => {
				void (async () => {
					const pageId = this.activePage?.id;
					if (!pageId) return;
					this.pendingFocus = {
						componentId: config.id,
						action: "rename",
					};
					this.store =
						await this.plugin.dashboardRepository.updateComponent(
							pageId,
							config.id,
							{ title: name || undefined },
						);
					this.render();
				})();
			},
			{
				titleKey: "DASHBOARD_RENAME_COMPONENT",
				placeholderKey: "DASHBOARD_RENAME_PLACEHOLDER",
				allowEmpty: true,
			},
		).open();
	}

	private renderResizeHandle(
		card: HTMLElement,
		grid: HTMLElement,
		config: DashboardComponentConfig,
	): void {
		const handle = card.createDiv({ cls: "ioto-card-resize-handle" });
		handle.setAttr("role", "button");
		handle.setAttr("aria-label", t("DASHBOARD_RESIZE_HANDLE"));
		handle.setAttr("title", t("DASHBOARD_RESIZE_HANDLE"));
		handle.addEventListener("pointerdown", (event) => {
			if (this.isNarrow) return;
			this.startResize(grid, card, config, event);
		});
	}

	private async updateComponent(
		componentId: string,
		patch: Partial<DashboardComponentConfig>,
	): Promise<void> {
		const pageId = this.activePage?.id;
		if (!pageId) return;
		this.store = await this.plugin.dashboardRepository.updateComponent(
			pageId,
			componentId,
			patch,
		);
		this.render();
	}

	private requestRender(): void {
		if (this.interacting) {
			this.renderDeferred = true;
			return;
		}
		this.render();
	}

	private beginInteraction(): void {
		this.interacting = true;
	}

	/** Flushes a deferred render; returns `true` when one happened. */
	private endInteraction(): boolean {
		this.interacting = false;
		if (!this.renderDeferred) return false;
		this.renderDeferred = false;
		this.render();
		return true;
	}

	/** Drops the preview and redraws from the untouched store. */
	private abortInteraction(): void {
		this.interacting = false;
		this.renderDeferred = false;
		this.render();
	}

	private restoreFocus(): void {
		const target = this.pendingFocus;
		if (!target) return;
		this.pendingFocus = null;
		const card = this.contentEl.querySelector(
			`.ioto-dashboard-card[data-component-id="${target.componentId}"]`,
		);
		const button = card?.querySelector<HTMLElement>(
			`[data-action="${target.action}"]`,
		);
		if (button && !button.hasAttribute("disabled")) button.focus();
	}

	private observeContainerWidth(): void {
		if (typeof ResizeObserver === "undefined") return;
		this.resizeObserver = new ResizeObserver((entries) => {
			const width =
				entries[0]?.contentRect.width ?? this.contentEl.clientWidth;
			this.setNarrow(width < 700);
		});
		this.resizeObserver.observe(this.contentEl);
	}

	private setNarrow(narrow: boolean): void {
		if (this.isNarrow === narrow) return;
		this.isNarrow = narrow;
		this.contentEl.toggleClass("is-narrow", narrow);
	}

	private armDragSort(
		grid: HTMLElement,
		card: HTMLElement,
		componentId: string,
		event: PointerEvent,
	): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget as HTMLElement | null;
		if (!handle) return;
		const doc = card.ownerDocument;
		const win = doc.defaultView ?? window;
		const startX = event.clientX;
		const startY = event.clientY;
		const touch = event.pointerType === "touch";
		let armed = true;
		let timer: number | null = null;

		const cleanup = (): void => {
			armed = false;
			if (timer !== null) win.clearTimeout(timer);
			timer = null;
			doc.removeEventListener("pointermove", onMove);
			doc.removeEventListener("pointerup", onUp);
			doc.removeEventListener("pointercancel", onUp);
		};

		const activate = (): void => {
			if (!armed) return;
			cleanup();
			this.startDragSession(grid, card, componentId, handle, event, win);
		};

		const onMove = (moveEvent: PointerEvent): void => {
			if (moveEvent.pointerId !== event.pointerId) return;
			const distance = Math.hypot(
				moveEvent.clientX - startX,
				moveEvent.clientY - startY,
			);
			if (touch) {
				// Any scroll intent cancels the long-press before it activates.
				if (distance > 8) cleanup();
				return;
			}
			if (distance > 6) activate();
		};

		const onUp = (upEvent: PointerEvent): void => {
			if (upEvent.pointerId === event.pointerId) cleanup();
		};

		doc.addEventListener("pointermove", onMove);
		doc.addEventListener("pointerup", onUp);
		doc.addEventListener("pointercancel", onUp);

		if (touch) {
			timer = win.setTimeout(activate, 350);
		}
	}

	private startDragSession(
		grid: HTMLElement,
		card: HTMLElement,
		componentId: string,
		handle: HTMLElement,
		startEvent: PointerEvent,
		win: Window,
	): void {
		startEvent.preventDefault();
		this.beginInteraction();
		this.contentEl.addClass("is-dragging");
		try {
			handle.setPointerCapture(startEvent.pointerId);
		} catch {
			// Capture is best-effort; document listeners still receive moves.
		}

		const startX = startEvent.clientX;
		const startY = startEvent.clientY;
		const reduceMotion =
			typeof win.matchMedia === "function" &&
			win.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const ghost = this.createDragGhost(card);
		this.dragGhost = ghost;
		card.addClass("is-dragging");
		card.addClass("is-placeholder");

		const pointer = { x: startX, y: startY };
		let rects = this.measureCards(grid);
		let frame: number | null = null;
		let dirty = true;

		const tick = (): void => {
			frame = null;
			const scrolled = this.applyAutoScroll(pointer.y);
			if (scrolled !== 0) {
				// Cached rects stay valid: only the viewport moved.
				for (const rect of rects.values()) rect.top -= scrolled;
				dirty = true;
			}
			if (dirty) {
				dirty = false;
				const moved = this.reorderPreview(
					grid,
					card,
					componentId,
					pointer.x,
					pointer.y,
					rects,
					reduceMotion,
				);
				if (moved) rects = this.measureCards(grid);
			}
			// Keep the loop alive only while the pointer keeps the page scrolling.
			if (scrolled !== 0) frame = win.requestAnimationFrame(tick);
		};
		const schedule = (): void => {
			if (frame === null) frame = win.requestAnimationFrame(tick);
		};
		schedule();

		this.bindPointerSession(handle, startEvent.pointerId, {
			onMove: (moveEvent) => {
				pointer.x = moveEvent.clientX;
				pointer.y = moveEvent.clientY;
				ghost.style.transform = `translate3d(${pointer.x - startX}px, ${pointer.y - startY}px, 0)`;
				dirty = true;
				schedule();
			},
			onFinish: (cancelled) => {
				if (frame !== null) win.cancelAnimationFrame(frame);
				frame = null;
				this.removeDragGhost();
				this.contentEl.removeClass("is-dragging");
				card.removeClass("is-dragging");
				card.removeClass("is-placeholder");
				if (cancelled) {
					this.abortInteraction();
					return;
				}
				void this.commitDragOrder(grid, componentId);
			},
		});
	}

	/** Detached visual clone that follows the pointer; the card stays as a slot. */
	private createDragGhost(card: HTMLElement): HTMLElement {
		const rect = card.getBoundingClientRect();
		const ghost = card.cloneNode(true) as HTMLElement;
		ghost.removeAttribute("data-component-id");
		ghost.removeAttribute("data-card-signature");
		ghost.addClass("ioto-custom-dashboard-view");
		ghost.addClass("ioto-drag-ghost");
		ghost.style.left = `${rect.left}px`;
		ghost.style.top = `${rect.top}px`;
		ghost.style.width = `${rect.width}px`;
		ghost.style.height = `${rect.height}px`;
		card.ownerDocument.body.appendChild(ghost);
		return ghost;
	}

	private removeDragGhost(): void {
		this.dragGhost?.remove();
		this.dragGhost = null;
	}

	private bindPointerSession(
		handle: HTMLElement,
		pointerId: number,
		handlers: {
			onMove(event: PointerEvent): void;
			onFinish(cancelled: boolean): void;
		},
	): void {
		const doc = handle.ownerDocument;
		const cleanup = (): void => {
			doc.removeEventListener("pointermove", onMove);
			doc.removeEventListener("pointerup", onUp);
			doc.removeEventListener("pointercancel", onCancel);
			doc.removeEventListener("keydown", onKey);
			try {
				handle.releasePointerCapture(pointerId);
			} catch {
				// Already released by the browser.
			}
		};
		const onMove = (event: PointerEvent): void => {
			if (event.pointerId === pointerId) handlers.onMove(event);
		};
		const onUp = (event: PointerEvent): void => {
			if (event.pointerId !== pointerId) return;
			cleanup();
			handlers.onFinish(false);
		};
		const onCancel = (event: PointerEvent): void => {
			if (event.pointerId !== pointerId) return;
			cleanup();
			handlers.onFinish(true);
		};
		const onKey = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			cleanup();
			handlers.onFinish(true);
		};
		doc.addEventListener("pointermove", onMove);
		doc.addEventListener("pointerup", onUp);
		doc.addEventListener("pointercancel", onCancel);
		doc.addEventListener("keydown", onKey);
	}

	private reorderPreview(
		grid: HTMLElement,
		card: HTMLElement,
		componentId: string,
		x: number,
		y: number,
		rects: Map<string, CardRect>,
		reduceMotion: boolean,
	): boolean {
		const cards: HTMLElement[] = [];
		for (const child of Array.from(grid.children)) {
			if (child.classList.contains("ioto-dashboard-card")) {
				cards.push(child as HTMLElement);
			}
		}
		const others = cards.filter((element) => element !== card);
		const reference =
			others[dropIndex([...rects.values()], x, y, componentId)] ?? null;
		if (card.nextElementSibling === reference) return false;
		if (reduceMotion) {
			grid.insertBefore(card, reference);
			return true;
		}
		this.flip(others, () => grid.insertBefore(card, reference));
		return true;
	}

	/** Measures every card once; callers reuse the cache until a reorder. */
	private measureCards(grid: HTMLElement): Map<string, CardRect> {
		const rects = new Map<string, CardRect>();
		for (const child of Array.from(grid.children)) {
			const element = child as HTMLElement;
			const id = element.dataset.componentId;
			if (!id) continue;
			const rect = element.getBoundingClientRect();
			rects.set(id, {
				id,
				top: rect.top,
				left: rect.left,
				width: rect.width,
				height: rect.height,
			});
		}
		return rects;
	}

	/** FLIP: measure → mutate → animate the visual delta away. */
	private flip(elements: HTMLElement[], mutate: () => void): void {
		const first = new Map<HTMLElement, DOMRect>();
		for (const element of elements) {
			first.set(element, element.getBoundingClientRect());
		}
		mutate();
		for (const element of elements) {
			const before = first.get(element);
			if (!before) continue;
			const after = element.getBoundingClientRect();
			const dx = before.left - after.left;
			const dy = before.top - after.top;
			if (dx === 0 && dy === 0) continue;
			element.animate(
				[
					{ transform: `translate(${dx}px, ${dy}px)` },
					{ transform: "none" },
				],
				{ duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
			);
		}
	}

	/** Edge auto-scroll; returns the applied delta so callers can shift caches. */
	private applyAutoScroll(pointerY: number): number {
		const scroller = this.contentEl;
		if (scroller.scrollHeight <= scroller.clientHeight + 1) return 0;
		const rect = scroller.getBoundingClientRect();
		const edge = 40;
		let delta = 0;
		if (pointerY < rect.top + edge) {
			delta = -Math.ceil((rect.top + edge - pointerY) / 2);
		} else if (pointerY > rect.bottom - edge) {
			delta = Math.ceil((pointerY - (rect.bottom - edge)) / 2);
		}
		if (delta === 0) return 0;
		const before = scroller.scrollTop;
		scroller.scrollTop = before + delta;
		return scroller.scrollTop - before;
	}

	private async commitDragOrder(
		grid: HTMLElement,
		componentId: string,
	): Promise<void> {
		const page = this.activePage;
		const pageId = page?.id;
		if (!page || !pageId) {
			this.abortInteraction();
			return;
		}
		const order: string[] = [];
		for (const child of Array.from(grid.children)) {
			const id = (child as HTMLElement).dataset?.componentId;
			if (id) order.push(id);
		}
		const toIndex = order.indexOf(componentId);
		const fromIndex = page.components.findIndex(
			(item) => item.id === componentId,
		);
		const changed =
			toIndex >= 0 && fromIndex >= 0 && toIndex !== fromIndex;
		if (changed) {
			this.store = await this.plugin.dashboardRepository.moveComponent(
				pageId,
				componentId,
				toIndex,
			);
		}
		const rendered = this.endInteraction();
		if (changed && !rendered) this.render();
	}

	private readGridMetrics(grid: HTMLElement): GridMetrics {
		let gap = 12;
		let rowHeight = 72;
		const style = grid.ownerDocument.defaultView?.getComputedStyle(grid);
		if (style) {
			const parsedGap = Number.parseFloat(
				style.getPropertyValue("column-gap"),
			);
			if (Number.isFinite(parsedGap)) gap = parsedGap;
			const parsedRow = Number.parseFloat(
				style.getPropertyValue("grid-auto-rows"),
			);
			if (Number.isFinite(parsedRow) && parsedRow > 0) rowHeight = parsedRow;
		}
		return gridMetrics(grid.clientWidth, 12, gap, rowHeight);
	}

	private startResize(
		grid: HTMLElement,
		card: HTMLElement,
		config: DashboardComponentConfig,
		event: PointerEvent,
	): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget as HTMLElement | null;
		if (!handle) return;
		event.preventDefault();
		event.stopPropagation();
		this.beginInteraction();
		const win = card.ownerDocument.defaultView ?? window;
		const startX = event.clientX;
		const startY = event.clientY;
		const metrics = this.readGridMetrics(grid);
		const bounds = this.boundsFor(config);
		const startSize = clampSize(config.w, config.h, bounds);
		const startRect = card.getBoundingClientRect();
		const overlays = this.createResizeOverlays(grid);
		const pointer = { x: startX, y: startY };
		let snapped = { ...startSize };
		let frame: number | null = null;
		let dirty = true;

		const tick = (): void => {
			frame = null;
			if (!dirty) return;
			dirty = false;
			const gridRect = grid.getBoundingClientRect();
			const left = startRect.left - gridRect.left;
			const top = startRect.top - gridRect.top;
			const maxWidth = Math.max(60, gridRect.width - left);
			const width = Math.min(
				maxWidth,
				Math.max(60, startRect.width + (pointer.x - startX)),
			);
			const rawHeight = Math.max(40, startRect.height + (pointer.y - startY));
			snapped = snapSize(width, rawHeight, metrics, bounds);
			const rowHeight = Math.max(1, metrics.stepY - metrics.gap);
			const snapWidth = snapped.w * metrics.columnWidth + (snapped.w - 1) * metrics.gap;
			const snapHeight = snapped.h * rowHeight + (snapped.h - 1) * metrics.gap;
			const ghostWidth =
				snapped.w >= bounds.maxW ? Math.min(width, snapWidth) : width;
			const ghostHeight =
				snapped.h >= bounds.maxH ? Math.min(rawHeight, snapHeight) : rawHeight;
			overlays.ghost.style.left = `${left}px`;
			overlays.ghost.style.top = `${top}px`;
			overlays.ghost.style.width = `${ghostWidth}px`;
			overlays.ghost.style.height = `${ghostHeight}px`;
			overlays.ghost.dataset.size = `${Math.round(ghostWidth)}×${Math.round(ghostHeight)}`;

			overlays.snap.style.left = `${left}px`;
			overlays.snap.style.top = `${top}px`;
			overlays.snap.style.width = `${snapWidth}px`;
			overlays.snap.style.height = `${snapHeight}px`;
			if (snapped.h >= bounds.maxH) overlays.snap.dataset.limit = "max";
			else delete overlays.snap.dataset.limit;
		};
		const schedule = (): void => {
			if (frame === null) frame = win.requestAnimationFrame(tick);
		};
		schedule();

		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// Capture is best-effort; document listeners still receive moves.
		}
		this.bindPointerSession(handle, event.pointerId, {
			onMove: (moveEvent) => {
				pointer.x = moveEvent.clientX;
				pointer.y = moveEvent.clientY;
				dirty = true;
				schedule();
			},
			onFinish: (cancelled) => {
				if (frame !== null) win.cancelAnimationFrame(frame);
				frame = null;
				this.removeResizeOverlays();
				if (cancelled) {
					this.abortInteraction();
					return;
				}
				if (snapped.w === startSize.w && snapped.h === startSize.h) {
					this.endInteraction();
					return;
				}
				void this.commitResize(config.id, snapped, startSize);
			},
		});
	}

	private createResizeOverlays(grid: HTMLElement): {
		ghost: HTMLElement;
		snap: HTMLElement;
	} {
		const doc = grid.ownerDocument;
		const ghost = doc.createElement("div");
		ghost.addClass("ioto-card-resize-ghost");
		const snap = doc.createElement("div");
		snap.addClass("ioto-card-resize-snap");
		grid.appendChild(ghost);
		grid.appendChild(snap);
		const overlays = { ghost, snap };
		this.resizeOverlays = overlays;
		return overlays;
	}

	private removeResizeOverlays(): void {
		this.resizeOverlays?.ghost.remove();
		this.resizeOverlays?.snap.remove();
		this.resizeOverlays = null;
	}

	private async commitResize(
		componentId: string,
		size: { w: number; h: number },
		start: { w: number; h: number },
	): Promise<void> {
		const pageId = this.activePage?.id;
		if (!pageId) {
			this.abortInteraction();
			return;
		}
		const changed = size.w !== start.w || size.h !== start.h;
		if (changed) {
			this.store = await this.plugin.dashboardRepository.updateComponent(
				pageId,
				componentId,
				{ w: size.w, h: size.h },
			);
		}
		const rendered = this.endInteraction();
		if (changed && !rendered) this.render();
	}

	private publishRequests(): void {
		if (!this.store || !this.hub) return;
		const requests: MetricRequest[] = [];
		const seen = new Set<string>();
		for (const page of this.store.pages) {
			for (const config of page.components) {
				const definition = this.registry.get(config.type);
				if (!definition) continue;
				const request = definition.toMetricRequest(config);
				const key = metricKey(request);
				// metricKey has no pageId, so duplicates can be shared safely.
				if (seen.has(key)) continue;
				seen.add(key);
				requests.push(request);
			}
		}
		this.hub.setRequests(requests);
	}

	private metricKeyOf(config: DashboardComponentConfig): string {
		const definition = this.registry.get(config.type);
		if (!definition) return "";
		return metricKey(definition.toMetricRequest(config));
	}

	private openComponentPicker(): void {
		new ComponentPickerModal(
			this.app,
			this.registry.list(),
			(definition) => {
				void (async () => {
					const queries = this.queryRepository();
					const preferred = queries.get(definition.defaultQueryId);
					const queryId =
						preferred?.id ??
						queries.defaultFor("task")?.id ??
						"builtin:tasks-all";
					const config: DashboardComponentConfig = {
						...definition.createConfig(queryId),
						id: `component:${Date.now()}`,
						type: definition.type,
						queryId,
					};
					const pageId = this.activePage?.id;
					if (!pageId) return;
					this.store = await this.plugin.dashboardRepository.addComponent(
						pageId,
						config,
					);
					this.editMode = true;
					this.render();
				})();
			},
			{
				layout: this.plugin.settings.modalLayout ?? "card",
				onLayoutChange: (layout) => {
					this.plugin.settings.modalLayout = layout;
					void this.plugin.saveSettings();
				},
			},
		).open();
	}

	private openQueryManager(): void {
		const queries = this.queryRepository();
		new QueryManagerModal(
			this.app,
			queries.list(),
			(queryId) =>
				this.store
					? this.plugin.dashboardRepository.referenceCount(
							this.store,
							queryId,
						)
					: 0,
			{
				onNew: () => this.openQueryEditor(null),
				onEdit: (query) => this.openQueryEditor(query),
				onDuplicate: async (query) => {
					const all = this.queryRepository().list();
					const takenIds = new Set(all.map((item) => item.id));
					const takenNames = new Set(all.map((item) => item.name));
					const sourceName = query.nameKey
						? t(query.nameKey as Parameters<typeof t>[0])
						: query.name;
					const copy: QueryDefinition = {
						...structuredClone(query),
						id: uniqueQueryId(takenIds),
						name: uniqueCopyName(sourceName, takenNames),
					};
					delete copy.nameKey;
					this.store = await this.plugin.dashboardRepository.addQuery(copy);
					this.queriesVersion += 1;
					this.render();
					const created = this.store?.queries.find(
						(item) => item.id === copy.id,
					);
					return created
						? { queries: this.queryRepository().list(), created }
						: null;
				},
				onDelete: (query) => {
					const references = this.store
						? this.plugin.dashboardRepository.referenceCount(
								this.store,
								query.id,
							)
						: 0;
					new ConfirmModal(
						this.app,
						t("QUERY_DELETE_CONFIRM_TITLE"),
						t("QUERY_DELETE_CONFIRM_MSG", [String(references)]),
						() => {
							void (async () => {
								this.store =
									await this.plugin.dashboardRepository.deleteQuery(query.id);
								this.queriesVersion += 1;
								this.render();
							})();
						},
					).open();
				},
			},
			{
				layout: this.plugin.settings.modalLayout ?? "list",
				onLayoutChange: (layout) => {
					this.plugin.settings.modalLayout = layout;
					void this.plugin.saveSettings();
				},
			},
		).open();
	}

	private openQueryEditor(initial: QueryDefinition | null): void {
		new QueryEditModal(this.app, initial, (query) => {
			void (async () => {
				const exists = this.store?.queries.some(
					(item) => item.id === query.id,
				);
				this.store = exists
					? await this.plugin.dashboardRepository.updateQuery(query)
					: await this.plugin.dashboardRepository.addQuery(query);
				this.queriesVersion += 1;
				this.render();
			})();
		}).open();
	}

	private async openNote(path: string, line?: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line: line ?? 0 } });
	}

	private async openProject(group: ProjectProgressGroup): Promise<void> {
		if (!group.key) return;
		const execute = this.app.commands.executeCommandById.bind(
			this.app.commands,
		) as unknown as (id: string) => boolean;
		let executed = false;
		try {
			executed = execute("open-project-center-view");
		} catch (error) {
			console.warn("IOTO Dashboard: project drill-down failed", error);
		}
		if (executed) return;
		await this.openNote(`${group.folder}/_project.md`);
	}
}

function uniqueQueryId(taken: Set<string>): string {
	const base = `user:${Date.now()}`;
	let id = base;
	let n = 2;
	while (taken.has(id)) id = `${base}-${n++}`;
	return id;
}

function uniqueCopyName(name: string, taken: Set<string>): string {
	const base = `${name} copy`;
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}
