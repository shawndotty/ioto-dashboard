import {
	ItemView,
	MarkdownRenderer,
	Menu,
	Notice,
	Platform,
	TFile,
	TFolder,
	ViewStateResult,
	WorkspaceLeaf,
	setIcon,
	setTooltip,
} from "obsidian";
import { CUSTOM_DASHBOARD_VIEW_TYPE } from "../models/constants";
import type IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { createComponentRegistry } from "../dashboard/components";
import { DataHub } from "../dashboard/data-hub";
import { datasetKey, type DatasetRequest } from "../dashboard/dataset/types";
import type {
	ComponentInspectorController,
	ComponentInspectorTarget,
	InspectorFocus,
	InspectorSelection,
	PageInspectorController,
	PageInspectorTarget,
} from "../dashboard/inspector-service";
import { resolveInspectorHost } from "../dashboard/inspector-service";
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
	queryTargetsFor,
	type ComponentDefinition,
	type ComponentRenderContext,
	type ComponentStatus,
	type SizeBounds,
} from "../dashboard/registry";
import { cardStyleVars } from "../dashboard/style-settings";
import {
	activeDashboard as activeDashboardOf,
	activePageOf,
	findDashboardForPage,
	type DashboardComponentConfig,
	type DashboardPage,
	type DashboardStoreData,
	type DashboardWorkspace,
} from "../dashboard/types";
import { metricKey, type MetricRequest, type MetricResult, type ProjectProgressGroup } from "../metrics/types";
import { QueryRepository } from "../query/repository";
import type { QueryDefinition, QueryTarget } from "../query/types";
import { ComponentPickerModal } from "../ui/component-picker";
import { ConfirmModal } from "../ui/ConfirmModal";
import {
	DashboardManagerModal,
	uniqueDashboardName,
} from "../ui/dashboard-manager";
import { PageLayoutModal } from "../ui/page-layout-modal";
import { PageNameModal } from "../ui/page-name-modal";
import { PagePickerModal, type PageTarget } from "../ui/page-picker";
import {
	QueryEditModal,
	QueryManagerModal,
	type QueryMutationResult,
} from "../ui/query-editor";
import {
	InspectorPanel,
	type InspectorPanelState,
} from "./components/InspectorPanel";

export class CustomDashboardView extends ItemView {
	private store: DashboardStoreData | null = null;
	private leafDashboardId: string | null = null;
	private leafPageId: string | null = null;
	private storeSignature = "";
	private hub: DataHub | null = null;
	private registry = createComponentRegistry();
	private editMode = false;
	private damaged = false;
	private unsubscribers: Array<() => void> = [];
	private interacting = false;
	private renderDeferred = false;
	private isNarrow = false;
	private resizeObserver: ResizeObserver | null = null;
	private dataVersion = 0;
	private queriesVersion = 0;
	private readonly leafId = `canvas:${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
	private selectedComponentId: string | null = null;
	private controller: ComponentInspectorController | null = null;
	private inspectorEl: HTMLElement | null = null;
	private inspector: InspectorPanel | null = null;
	private inspectorUnsubscribe: (() => void) | null = null;
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
		return (
			this.activeDashboard?.name ?? t("CUSTOM_DASHBOARD_TITLE")
		);
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("ioto-custom-dashboard-view");
		this.resetShell();
		await this.loadStore();
		this.resolveLeafTargets();
		this.storeSignature = signatureOf(this.store);

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
		this.unsubscribers.push(
			this.plugin.dashboardRepository.onChange((store) =>
				this.handleStoreChange(store),
			),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.updateVisibility()),
		);
		this.registerDomEvent(document, "visibilitychange", () =>
			this.updateVisibility(),
		);
		this.observeContainerWidth();
		this.controller = this.createInspectorController();
		this.registerDomEvent(this.contentEl, "keydown", (event) => {
			if (event.key !== "Escape" || this.interacting) return;
			if (this.selectedComponentId || this.localSelection()?.kind === "page") {
				this.clearSelection();
			}
		});
		this.render();
		this.updateVisibility();
	}

	async onClose(): Promise<void> {
		this.destroyInlineInspector();
		this.plugin.inspectorService.clear(this.leafId);
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
			dashboardId:
				this.leafDashboardId ?? this.store?.activeDashboardId,
			pageId: this.leafPageId ?? undefined,
		};
	}

	async setState(state: unknown, result: ViewStateResult) {
		const s = (state ?? {}) as {
			activePageId?: unknown;
			dashboardId?: unknown;
			pageId?: unknown;
		};
		if (typeof s.dashboardId === "string") {
			this.leafDashboardId = s.dashboardId;
		}
		if (typeof s.pageId === "string") {
			this.leafPageId = s.pageId;
		} else if (typeof s.activePageId === "string") {
			// Legacy layout state without a dashboard id.
			this.leafPageId = s.activePageId;
		}
		await super.setState(state, result);
		if (this.store) {
			this.resolveLeafTargets();
			this.render();
		}
	}

	private get activeDashboard(): DashboardWorkspace | undefined {
		if (!this.store) return undefined;
		return this.store.dashboards.find(
			(dashboard) => dashboard.id === this.leafDashboardId,
		);
	}

	private get activePage(): DashboardPage | undefined {
		const dashboard = this.activeDashboard;
		if (!dashboard) return undefined;
		const leafPage = this.leafPageId
			? dashboard.pages.find((page) => page.id === this.leafPageId)
			: undefined;
		return leafPage ?? activePageOf(dashboard);
	}

	/**
	 * Picks the dashboard/page this leaf shows. Resolution order: the leaf's own
	 * dashboard (or the dashboard owning its legacy page) → global active
	 * dashboard; page: leaf page → dashboard `lastPageId` → first page.
	 */
	private resolveLeafTargets(): void {
		const store = this.store;
		if (!store) {
			this.leafDashboardId = null;
			this.leafPageId = null;
			return;
		}
		let dashboard = this.leafDashboardId
			? store.dashboards.find(
					(item) => item.id === this.leafDashboardId,
				)
			: undefined;
		if (!dashboard && this.leafPageId) {
			dashboard = findDashboardForPage(store, this.leafPageId);
		}
		if (!dashboard) dashboard = activeDashboardOf(store);
		this.leafDashboardId = dashboard?.id ?? null;
		this.leafPageId = this.pickPage(dashboard)?.id ?? null;
	}

	private pickPage(
		dashboard: DashboardWorkspace | undefined,
	): DashboardPage | undefined {
		if (!dashboard) return undefined;
		const current = this.leafPageId
			? dashboard.pages.find((page) => page.id === this.leafPageId)
			: undefined;
		if (current) return current;
		const last = dashboard.lastPageId
			? dashboard.pages.find((page) => page.id === dashboard.lastPageId)
			: undefined;
		return last ?? dashboard.pages[0];
	}

	private handleStoreChange(store: DashboardStoreData): void {
		if (signatureOf(store) === this.storeSignature) return;
		this.store = store;
		this.storeSignature = signatureOf(store);
		this.resolveLeafTargets();
		this.render();
		this.refreshHeader();
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
			this.applyPageLayout(grid);
			this.syncCards(grid, page.components);
			this.publishRequests();
		}

		this.contentEl.scrollTop = scrollTop;
		this.syncInspector();
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
		const dashboard = this.activeDashboard;
		const signature = [
			this.editMode ? "edit" : "view",
			dashboard?.id ?? "",
			dashboard?.name ?? "",
		].join("|");
		if (signature === this.toolbarSignature) return;
		this.toolbarSignature = signature;
		const toolbar = this.toolbarEl;
		if (!toolbar) return;
		toolbar.empty();

		const title = toolbar.createDiv({ cls: "ioto-dashboard-toolbar-title" });
		title.createEl("h2", {
			text: dashboard?.name ?? t("CUSTOM_DASHBOARD_TITLE"),
		});

		const manage = toolbar.createDiv({ cls: "ioto-dashboard-manage" });
		this.addIconToolbarButton(
			manage,
			"list-filter",
			t("DASHBOARD_MANAGE_QUERIES"),
			() => this.openQueryManager(),
		);
		this.addIconToolbarButton(
			manage,
			"layout-dashboard",
			t("DASHBOARD_MANAGER_TOOLTIP"),
			() => this.openDashboardManager(),
		);

		const actions = toolbar.createDiv({ cls: "ioto-dashboard-actions" });
		if (this.editMode) {
			this.addToolbarButton(
				actions,
				"plus",
				t("DASHBOARD_ADD_COMPONENT"),
				() => this.openComponentPicker(),
				"mod-cta",
			);
		}
		this.addIconToolbarButton(
			actions,
			"more-horizontal",
			t("DASHBOARD_MANAGE_GROUP"),
			(event, button) => this.openManageMenu(event, button),
			"ioto-dashboard-manage-more",
		);
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

	private openDashboardManager(): void {
		new DashboardManagerModal(this.app, {
			getStore: () => this.store,
			isOpen: (id) => this.plugin.isDashboardOpen(id),
			openCount: (id) => this.plugin.openDashboardCount(id),
			onOpen: (id) => {
				void this.plugin.activateCustomDashboard(id);
			},
			onCreate: async (name) => {
				const workspace = this.createDashboardWorkspace(name);
				this.store = await this.plugin.dashboardRepository.addDashboard(
					workspace,
				);
				await this.plugin.activateCustomDashboard(workspace.id);
				this.refreshHeader();
				return workspace.id;
			},
			onRename: async (id, name) => {
				this.store = await this.plugin.dashboardRepository.renameDashboard(
					id,
					name,
				);
				this.render();
				this.refreshHeader();
			},
			onDuplicate: async (id, name) => {
				const store =
					await this.plugin.dashboardRepository.duplicateDashboard(
						id,
						name,
					);
				this.store = store;
				const copy = store.dashboards[store.dashboards.length - 1];
				if (copy) {
					await this.plugin.activateCustomDashboard(copy.id);
				}
				this.refreshHeader();
				return copy?.id ?? null;
			},
			onDelete: async (id) => {
				const staleLeaves = this.plugin.getDashboardLeaves(id, {
					except: this.leaf,
				});
				const store =
					await this.plugin.dashboardRepository.removeDashboard(id);
				this.store = store;
				if (!store.dashboards.some((item) => item.id === id)) {
					this.plugin.detachLeaves(staleLeaves);
				}
				this.resolveLeafTargets();
				this.render();
				this.app.workspace.requestSaveLayout();
				this.refreshHeader();
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

	private createDashboardWorkspace(name: string): DashboardWorkspace {
		const taken = new Set(
			this.store?.dashboards.map((dashboard) => dashboard.id) ?? [],
		);
		const base = `dashboard:${Date.now()}`;
		let id = base;
		let index = 2;
		while (taken.has(id)) id = `${base}-${index++}`;
		const pageId = this.uniquePageId();
		return {
			id,
			name,
			pages: [
				{
					id: pageId,
					name: t("PAGE_DEFAULT_NAME", ["1"]),
					components: [],
				},
			],
			lastPageId: pageId,
		};
	}

	private uniquePageId(): string {
		const taken = new Set(
			this.store?.dashboards.flatMap((dashboard) =>
				dashboard.pages.map((page) => page.id),
			) ?? [],
		);
		const base = `page:${Date.now()}`;
		let id = base;
		let index = 2;
		while (taken.has(id)) id = `${base}-${index++}`;
		return id;
	}

	/** The dashboard this leaf is bound to; used for open-or-focus matching. */
	getDashboardId(): string | null {
		return this.leafDashboardId;
	}

	private refreshHeader(): void {
		const leaf = this.leaf as WorkspaceLeaf & { updateHeader?: () => void };
		if (typeof leaf.updateHeader === "function") leaf.updateHeader();
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
			this.applyPageLayout(this.gridEl);
			this.gridEl.addEventListener("click", (event) => {
				if (event.target === this.gridEl) this.clearSelection();
			});
		}
		return this.gridEl;
	}

	private applyPageLayout(grid: HTMLElement): void {
		const page = this.activePage;
		grid.style.setProperty(
			"--ioto-dashboard-columns",
			String(page?.columns === 24 ? 24 : 12),
		);
		grid.style.setProperty(
			"--ioto-dashboard-row-height",
			`${page?.rowHeight ?? 72}px`,
		);
	}

	private syncPagesBar(): void {
		const pages = this.activeDashboard?.pages ?? [];
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
			tab.onClickEvent(() => {
				if (this.editMode && !Platform.isMobile) {
					this.openPageSettings(page);
					return;
				}
				this.switchPage(page.id);
			});
			if (Platform.isMobile) {
				tab.addEventListener("dblclick", () => {
					if (!this.editMode) return;
					this.openPageSettings(page, "name");
				});
			}
			if (this.editMode) {
				if (!Platform.isMobile) {
					tab.setAttr("title", t("PAGE_SETTINGS_TITLE"));
				}
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
		if (Platform.isMobile) {
			const layout = tab.createEl("button", {
				cls: "ioto-dashboard-page-close",
				attr: {
					"aria-label": t("PAGE_LAYOUT_TITLE"),
					title: t("PAGE_LAYOUT_TITLE"),
				},
				text: "▦",
			});
			layout.onClickEvent((event) => {
				event.stopPropagation();
				this.openPageLayout(page);
			});
			const rename = tab.createEl("button", {
				cls: "ioto-dashboard-page-close",
				attr: { "aria-label": t("PAGE_RENAME"), title: t("PAGE_RENAME") },
				text: "✎",
			});
			rename.onClickEvent((event) => {
				event.stopPropagation();
				this.openRenamePage(page);
			});
			const duplicate = tab.createEl("button", {
				cls: "ioto-dashboard-page-close",
				attr: {
					"aria-label": t("PAGE_DUPLICATE"),
					title: t("PAGE_DUPLICATE"),
				},
				text: "⧉",
			});
			duplicate.onClickEvent((event) => {
				event.stopPropagation();
				void this.duplicatePage(page);
			});
		}
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
		const dashboard = this.activeDashboard;
		if (!dashboard || pageId === this.activePage?.id) return;
		const wasPageSettings = this.localSelection()?.kind === "page";
		this.clearSelection();
		this.leafPageId = pageId;
		if (wasPageSettings && this.editMode && !Platform.isMobile) {
			this.plugin.inspectorService.select(
				{ kind: "page", leafId: this.leafId, pageId },
				this.createPageInspectorController(pageId),
			);
		}
		this.render();
		if (wasPageSettings && this.editMode && !Platform.isMobile) {
			this.ensureInspectorHost();
		}
		this.app.workspace.requestSaveLayout();
		void this.plugin.dashboardRepository
			.setLastPage(dashboard.id, pageId)
			.then((store) => {
				// Do not advance storeSignature here: the broadcast may carry
				// changes this leaf has not rendered yet.
				this.store = store;
			});
	}

	private async createPage(): Promise<void> {
		const dashboard = this.activeDashboard;
		if (!dashboard) return;
		this.clearSelection();
		const taken = new Set(
			this.store?.dashboards.flatMap((item) =>
				item.pages.map((page) => page.id),
			) ?? [],
		);
		const base = `page:${Date.now()}`;
		let id = base;
		let index = 2;
		while (taken.has(id)) id = `${base}-${index++}`;
		const page: DashboardPage = {
			id,
			name: t("PAGE_DEFAULT_NAME", [
				String(dashboard.pages.length + 1),
			]),
			components: [],
		};
		this.store = await this.plugin.dashboardRepository.addPage(
			dashboard.id,
			page,
		);
		this.leafPageId = id;
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	private async duplicatePage(page: DashboardPage): Promise<void> {
		const dashboard = this.activeDashboard;
		if (!dashboard) return;
		const suffix = t("DASHBOARD_COMPONENT_COPY_SUFFIX");
		const base = page.name.endsWith(suffix.trim())
			? page.name
			: `${page.name}${suffix}`;
		const name = uniqueDashboardName(
			base,
			dashboard.pages.map((item) => item.name),
		);
		const result = await this.plugin.dashboardRepository.duplicatePage(
			page.id,
			name,
		);
		if (!result) return;
		this.store = result.store;
		this.switchPage(result.pageId);
		new Notice(t("PAGE_DUPLICATED", [name]));
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

	private openPageLayout(page: DashboardPage): void {
		new PageLayoutModal(
			this.app,
			{ columns: page.columns, rowHeight: page.rowHeight },
			(columns, rowHeight) => {
				void (async () => {
					this.store =
						await this.plugin.dashboardRepository.updatePageLayout(
							page.id,
							columns,
							rowHeight,
						);
					this.render();
				})();
			},
		).open();
	}

	private confirmRemovePage(page: DashboardPage): void {
		const dashboard = this.activeDashboard;
		if (!dashboard || dashboard.pages.length <= 1) {
			new Notice(t("PAGE_LAST_CANNOT_DELETE"));
			return;
		}
		new ConfirmModal(
			this.app,
			t("PAGE_DELETE_TITLE"),
			t("PAGE_DELETE_MSG", [page.name, String(page.components.length)]),
			() => {
				void (async () => {
					this.store =
						await this.plugin.dashboardRepository.removePage(page.id);
					const selection = this.localSelection();
					if (
						selection?.kind === "page" &&
						selection.pageId === page.id
					) {
						this.plugin.inspectorService.clear(this.leafId);
					}
					if (this.leafPageId === page.id) {
						this.leafPageId =
							activePageOf(this.activeDashboard)?.id ?? null;
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
		extraClass?: string,
	): void {
		const button = container.createEl("button", {
			cls: extraClass ? `clickable-icon ${extraClass}` : "clickable-icon",
			attr: { "aria-label": label, title: label },
		});
		button.createSpan({ cls: "ioto-button-label", text: label });
		button.setAttr("data-icon", icon);
		button.onClickEvent(onClick);
	}

	private addIconToolbarButton(
		container: HTMLElement,
		icon: string,
		label: string,
		onClick: (event: MouseEvent, button: HTMLButtonElement) => void,
		extraClass?: string,
	): void {
		const button = container.createEl("button", {
			cls: extraClass
				? `clickable-icon ioto-icon-button ${extraClass}`
				: "clickable-icon ioto-icon-button",
			attr: { type: "button", "aria-label": label },
		});
		setIcon(button, icon);
		setTooltip(button, label);
		button.onClickEvent((event) => onClick(event, button));
	}

	private openManageMenu(
		event: MouseEvent,
		button: HTMLButtonElement,
	): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("DASHBOARD_MANAGE_QUERIES"))
				.setIcon("list-filter")
				.onClick(() => this.openQueryManager()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("DASHBOARD_MANAGER_TOOLTIP"))
				.setIcon("layout-dashboard")
				.onClick(() => this.openDashboardManager()),
		);
		if (event.detail > 0) {
			menu.showAtMouseEvent(event);
			return;
		}
		const rect = button.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom });
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
		this.syncSelectionClasses();
	}

	/** Rebuild triggers: config, edit state, data refresh and query edits. */
	private cardSignature(config: DashboardComponentConfig): string {
		const size = clampSize(config.w, config.h, this.boundsFor(config));
		return [
			config.type,
			config.queryId,
			config.basis ?? "",
			config.view ?? "",
			config.measure ?? "",
			JSON.stringify(config.options ?? {}),
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
		const style = cardStyleVars(config.options);
		if (style.fg) card.style.setProperty("--ioto-card-fg", style.fg);
		if (style.bg) card.style.setProperty("--ioto-card-bg", style.bg);
		if (style.align) card.style.setProperty("--ioto-card-align", style.align);
		card.toggleClass("has-custom-fg", Boolean(style.fg));
		card.toggleClass("has-custom-bg", Boolean(style.bg));
		const size = clampSize(config.w, config.h, this.boundsFor(config));
		card.style.gridColumn = `span ${size.w}`;
		card.style.gridRow = `span ${size.h}`;
		if (this.editMode) {
			card.addEventListener("click", (event) => {
				const target = event.target as HTMLElement | null;
				if (
					target?.closest(
						"button, .ioto-card-drag-handle, .ioto-card-resize-handle",
					)
				) {
					return;
				}
				this.selectComponent(config.id);
			});
		}

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

		const body = card.createDiv({ cls: "ioto-dashboard-card-body" });
		if (this.editMode) {
			this.renderResizeHandle(card, grid, config);
		}
		if (!definition) {
			this.registry.placeholder(body, config.type);
			return card;
		}

		const datasetRequest = definition.toDatasetRequest?.(config, query);
		const dataset = datasetRequest
			? this.hub?.getDataset(datasetKey(datasetRequest))
			: undefined;
		const { status, messageKey } = this.statusOf(
			definition,
			query,
			result,
			dataset,
			config,
		);
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
		const ctx: ComponentRenderContext = {
			config,
			query,
			result,
			dataset,
			status,
			messageKey,
			editMode: this.editMode,
			openNote: (path, line) => void this.openNote(path, line),
			openProject: (group) => void this.openProject(group),
			openFile: (path, line) => void this.openNote(path, line),
			openFolder: (path) => void this.openFolder(path),
			revealInExplorer: (path) => void this.revealInExplorer(path),
			renderMarkdown: (el, path) => this.renderMarkdown(el, path),
			renderInlineMarkdown: (el, markdown, sourcePath) =>
				MarkdownRenderer.render(this.app, markdown, el, sourcePath, this),
		};
		definition.render(body, ctx);
		// `render` 先执行，头部钩子才能拿到已创建的列表句柄恢复过滤态。
		if (!this.editMode && (status === "ready" || status === "empty")) {
			definition.renderHeaderActions?.(header, ctx);
		}
		return card;
	}

	private statusOf(
		definition: ComponentDefinition,
		query: QueryDefinition | undefined,
		result: MetricResult | undefined,
		dataset: import("../dashboard/dataset/types").Dataset | undefined,
		config: DashboardComponentConfig,
	): { status: ComponentStatus; messageKey?: string } {
		if (!query) return { status: "error", messageKey: "DASHBOARD_ERROR_CONFIG" };
		if (definition.toDatasetRequest) {
			if (!dataset) return { status: "loading" };
			const empty = definition.isEmptyDataset
				? definition.isEmptyDataset(dataset)
				: dataset.total === 0;
			if (empty) return { status: "empty" };
			return { status: "ready" };
		}
		if (this.hub?.isLoading() && !result) return { status: "loading" };
		if (!result) return { status: "loading" };
		if (definition.isEmpty(result, config)) return { status: "empty" };
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
		handle.addEventListener("pointerdown", (event) => {
			this.selectComponent(config.id);
			this.armDragSort(grid, card, config.id, event);
		});
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
		rename.onClickEvent((event) => {
			event.stopPropagation();
			this.selectComponent(config.id, "title");
		});
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
		remove.onClickEvent((event) => {
			event.stopPropagation();
			this.confirmRemove(config.id);
		});
	}

	private boundsFor(
		config: DashboardComponentConfig,
		page: DashboardPage | undefined = this.activePage,
	): SizeBounds {
		const bounds = boundsForType(this.registry, config.type);
		const columns = page?.columns ?? 12;
		return { ...bounds, maxW: Math.max(bounds.minW, columns) };
	}

	private defaultSizeFor(
		config: DashboardComponentConfig,
		bounds: SizeBounds,
	): { w: number; h: number } {
		const definition = this.registry.get(config.type);
		const defaults = definition?.createConfig(definition.defaultQueryId);
		return clampSize(defaults?.w, defaults?.h, bounds);
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
		this.store = await this.plugin.dashboardRepository.moveComponent(
			page.id,
			componentId,
			to,
		);
		this.render();
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

	private selectComponent(id: string, focus?: InspectorFocus): void {
		const pageId = this.activePage?.id;
		if (!pageId) return;
		this.selectedComponentId = id;
		this.syncSelectionClasses();
		if (!this.controller) return;
		this.plugin.inspectorService.select(
			{ kind: "component", leafId: this.leafId, pageId, componentId: id },
			this.controller,
			{ focus },
		);
		this.ensureInspectorHost();
	}

	private localSelection(): InspectorSelection | null {
		const selection = this.plugin.inspectorService.current()?.selection;
		return selection?.leafId === this.leafId ? selection : null;
	}

	private clearSelection(): void {
		const pageSelection = this.localSelection();
		if (!this.selectedComponentId && pageSelection?.kind !== "page") return;
		this.selectedComponentId = null;
		this.syncSelectionClasses();
		this.inspectorEl?.toggleClass("is-hidden", true);
		this.plugin.inspectorService.clear(this.leafId);
	}

	private syncSelectionState(): void {
		const id = this.selectedComponentId;
		if (id) {
			if (this.activePage?.components.some((item) => item.id === id)) return;
			this.selectedComponentId = null;
			this.plugin.inspectorService.clear(this.leafId);
			return;
		}
		const selection = this.localSelection();
		if (selection?.kind !== "page") return;
		const pages = this.activeDashboard?.pages ?? [];
		if (pages.some((page) => page.id === selection.pageId)) return;
		this.plugin.inspectorService.clear(this.leafId);
	}

	private syncSelectionClasses(): void {
		if (!this.gridEl) return;
		for (const child of Array.from(this.gridEl.children)) {
			const element = child as HTMLElement;
			const id = element.dataset.componentId;
			if (!id) continue;
			element.toggleClass("is-selected", id === this.selectedComponentId);
		}
	}

	private inspectorHost(): "sidebar" | "inline" {
		return resolveInspectorHost(
			this.plugin.settings.inspectorHost ?? "auto",
			Platform.isMobile,
		);
	}

	private ensureInspectorHost(): void {
		if (this.inspectorHost() === "sidebar") {
			this.destroyInlineInspector();
			void this.plugin.revealInspector();
			return;
		}
		this.ensureInlineInspector();
	}

	private syncInspector(): void {
		if (!this.editMode) this.clearSelection();
		this.contentEl.toggleClass("is-editing", this.editMode);
		this.syncSelectionState();
		this.syncSelectionClasses();
		if (this.inspectorHost() === "sidebar") {
			this.destroyInlineInspector();
			this.plugin.inspectorService.refresh();
			return;
		}
		if (this.hasLocalSelection()) this.ensureInlineInspector();
		else this.inspectorEl?.toggleClass("is-hidden", true);
		this.plugin.inspectorService.refresh();
	}

	private hasLocalSelection(): boolean {
		return (
			this.selectedComponentId !== null ||
			this.localSelection()?.kind === "page"
		);
	}

	private ensureInlineInspector(): void {
		if (!this.inspectorEl) {
			this.inspectorEl = this.contentEl.createDiv({
				cls: "ioto-inspector-inline",
			});
			const service = this.plugin.inspectorService;
			this.inspector = new InspectorPanel(this.inspectorEl, {
				component: {
					patch: (patch) => this.controller?.patch(patch),
					stepSize: (axis, direction) =>
						this.controller?.stepSize(axis, direction),
					resetSize: () => this.controller?.resetSize(),
					move: (offset) => this.controller?.move(offset),
					duplicate: () => this.controller?.duplicate(),
					moveTo: () => this.controller?.moveTo(),
					remove: () => this.controller?.remove(),
					openPageSettings: () => {
						const page = this.activePage;
						if (page) this.openPageSettings(page);
					},
				},
				page: {
					rename: (name) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "page") {
							controller.renamePage(name);
						}
					},
					duplicate: () => {
						const controller = service.current()?.controller;
						if (controller?.kind === "page") {
							controller.duplicatePage();
						}
					},
					setLayout: (columns, rowHeight) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "page") {
							controller.setPageLayout(columns, rowHeight);
						}
					},
					remove: () => {
						const controller = service.current()?.controller;
						if (controller?.kind === "page") {
							controller.removePage();
						}
					},
				},
			});
			this.inspectorUnsubscribe =
				this.plugin.inspectorService.subscribe(() =>
					this.renderInlineInspector(),
				);
		}
		this.inspectorEl.toggleClass("is-hidden", false);
		this.contentEl.appendChild(this.inspectorEl);
		this.renderInlineInspector();
	}

	private renderInlineInspector(): void {
		if (!this.inspector) return;
		const service = this.plugin.inspectorService;
		const current = service.current();
		const mine =
			current?.selection.leafId === this.leafId &&
			(current.selection.kind === "component"
				? this.selectedComponentId === current.selection.componentId
				: this.activePage?.id === current.selection.pageId);
		const snapshot = mine ? service.snapshot() : null;
		const focus = mine ? service.consumeFocus() : null;
		const state = (snapshot
			? { ...snapshot, focus }
			: null) as InspectorPanelState;
		this.inspector.render(state);
		this.inspectorEl?.toggleClass("is-hidden", !mine);
	}

	private destroyInlineInspector(): void {
		this.inspectorUnsubscribe?.();
		this.inspectorUnsubscribe = null;
		this.inspector?.destroy();
		this.inspector = null;
		this.inspectorEl?.remove();
		this.inspectorEl = null;
	}

	private createInspectorController(): ComponentInspectorController {
		return {
			kind: "component",
			leafId: this.leafId,
			isEditable: () => this.editMode,
			getTarget: () => this.inspectorTarget(),
			listQueries: () => this.queryRepository().list(),
			queriesVersion: () => this.queriesVersion,
			patch: (patch) => {
				const id = this.selectedComponentId;
				if (id) void this.updateComponent(id, patch);
			},
			stepSize: (axis, direction) => {
				const id = this.selectedComponentId;
				if (id) void this.stepComponentSize(id, axis, direction);
			},
			resetSize: () => {
				const id = this.selectedComponentId;
				if (id) void this.resetComponentSize(id);
			},
			move: (offset) => {
				const id = this.selectedComponentId;
				if (id) void this.nudgeComponent(id, offset);
			},
			duplicate: () => void this.duplicateSelectedComponent(),
			moveTo: () => void this.moveSelectedComponent(),
			remove: () => this.confirmRemoveSelected(),
			openPageSettings: () => {
				const page = this.activePage;
				if (page) this.openPageSettings(page);
			},
		};
	}

	private createPageInspectorController(
		pageId: string,
	): PageInspectorController {
		return {
			kind: "page",
			leafId: this.leafId,
			isEditable: () => this.editMode,
			getTarget: () => this.pageInspectorTarget(pageId),
			duplicatePage: () => {
				const page = this.activeDashboard?.pages.find(
					(item) => item.id === pageId,
				);
				if (page) void this.duplicatePage(page);
			},
			renamePage: (name) => {
				void (async () => {
					this.store = await this.plugin.dashboardRepository.renamePage(
						pageId,
						name,
					);
					this.render();
				})();
			},
			setPageLayout: (columns, rowHeight) => {
				void (async () => {
					this.store =
						await this.plugin.dashboardRepository.updatePageLayout(
							pageId,
							columns,
							rowHeight,
						);
					this.render();
				})();
			},
			removePage: () => {
				const page = this.activeDashboard?.pages.find(
					(item) => item.id === pageId,
				);
				if (page) this.confirmRemovePage(page);
			},
		};
	}

	private openPageSettings(page: DashboardPage, focus?: InspectorFocus): void {
		if (!this.editMode) return;
		if (Platform.isMobile) {
			if (focus === "name") this.openRenamePage(page);
			else this.openPageLayout(page);
			return;
		}
		const dashboard = this.activeDashboard;
		if (!dashboard?.pages.some((item) => item.id === page.id)) return;
		if (this.activePage?.id !== page.id) this.switchPage(page.id);
		this.selectedComponentId = null;
		this.syncSelectionClasses();
		this.plugin.inspectorService.select(
			{ kind: "page", leafId: this.leafId, pageId: page.id },
			this.createPageInspectorController(page.id),
			{ focus },
		);
		this.ensureInspectorHost();
	}

	private inspectorTarget(): ComponentInspectorTarget | null {
		const page = this.activePage;
		const id = this.selectedComponentId;
		if (!page || !id) return null;
		const index = page.components.findIndex((item) => item.id === id);
		const config = index >= 0 ? page.components[index] : undefined;
		if (!config) return null;
		const bounds = this.boundsFor(config);
		return {
			kind: "component",
			pageName: page.name,
			index,
			total: page.components.length,
			config,
			definition: this.registry.get(config.type),
			bounds,
			defaults: this.defaultSizeFor(config, bounds),
		};
	}

	private pageInspectorTarget(pageId: string): PageInspectorTarget | null {
		const dashboard = this.activeDashboard;
		const page = this.activePage;
		if (!dashboard || page?.id !== pageId) return null;
		const index = dashboard.pages.findIndex((item) => item.id === pageId);
		if (index < 0) return null;
		return {
			kind: "page",
			pageId,
			pageName: page.name,
			dashboardName: dashboard.name,
			index,
			total: dashboard.pages.length,
			componentCount: page.components.length,
			columns: page.columns === 24 ? 24 : 12,
			rowHeight: page.rowHeight ?? 72,
			canDelete: dashboard.pages.length > 1,
		};
	}

	canDuplicateSelected(): boolean {
		const id = this.selectedComponentId;
		return Boolean(
			this.editMode &&
				id &&
				this.activePage?.components.some((item) => item.id === id),
		);
	}

	async duplicateSelectedComponent(): Promise<void> {
		if (!this.canDuplicateSelected()) return;
		const pageId = this.activePage?.id;
		const id = this.selectedComponentId;
		if (!pageId || !id) return;
		const source = this.activePage?.components.find(
			(item) => item.id === id,
		);
		if (!source) return;
		const suffix = t("DASHBOARD_COMPONENT_COPY_SUFFIX");
		const base = this.componentDisplayName(source);
		const title = base.endsWith(suffix.trim()) ? base : `${base}${suffix}`;
		const result = await this.plugin.dashboardRepository.duplicateComponent(
			pageId,
			id,
			title,
		);
		if (!result) return;
		this.store = result.store;
		this.render();
		this.selectComponent(result.componentId);
		new Notice(t("DASHBOARD_COMPONENT_DUPLICATED", [title]));
	}

	private componentDisplayName(config: DashboardComponentConfig): string {
		const definition = this.registry.get(config.type);
		const name = (
			config.title ??
			(definition
				? t(definition.labelKey as Parameters<typeof t>[0])
				: config.type)
		).trim();
		return name || config.type;
	}

	private async moveSelectedComponent(): Promise<void> {
		const page = this.activePage;
		const config = page?.components.find(
			(item) => item.id === this.selectedComponentId,
		);
		if (!page || !config || !this.store) return;
		const dashboardId = this.activeDashboard?.id;
		const targets: PageTarget[] = [];
		const others: PageTarget[] = [];
		for (const dashboard of this.store.dashboards) {
			for (const target of dashboard.pages) {
				if (target.id === page.id) continue;
				const entry = { dashboard, page: target };
				if (dashboard.id === dashboardId) targets.push(entry);
				else others.push(entry);
			}
		}
		targets.push(...others);
		if (targets.length === 0) {
			new Notice(t("DASHBOARD_MOVE_COMPONENT_FAILED"));
			return;
		}
		new PagePickerModal(this.app, targets, (target) => {
			void this.transferSelectedComponent(config, page.id, target);
		}).open();
	}

	private async transferSelectedComponent(
		config: DashboardComponentConfig,
		fromPageId: string,
		target: PageTarget,
	): Promise<void> {
		const repository = this.plugin.dashboardRepository;
		const result = await repository.transferComponent(
			fromPageId,
			config.id,
			target.page.id,
		);
		if (!result) {
			new Notice(t("DASHBOARD_MOVE_COMPONENT_FAILED"));
			return;
		}
		this.store = result.store;
		this.selectedComponentId = null;
		this.plugin.inspectorService.clear(this.leafId);

		const targetPage = this.store.dashboards
			.flatMap((dashboard) => dashboard.pages)
			.find((page) => page.id === target.page.id);
		const moved = targetPage?.components.find(
			(item) => item.id === result.componentId,
		);
		if (moved && targetPage) {
			const bounds = this.boundsFor(moved, targetPage);
			const next = clampSize(moved.w, moved.h, bounds);
			if (next.w !== moved.w || next.h !== moved.h) {
				this.store = await repository.updateComponent(
					targetPage.id,
					result.componentId,
					next,
				);
			}
		}

		this.render();
		new Notice(
			t("DASHBOARD_MOVE_COMPONENT_DONE", [
				this.componentDisplayName(moved ?? config),
				target.dashboard.name,
				target.page.name,
			]),
		);
	}

	private confirmRemoveSelected(): void {
		const id = this.selectedComponentId;
		if (!id) return;
		this.confirmRemove(id);
	}

	private confirmRemove(componentId: string): void {
		new ConfirmModal(
			this.app,
			t("INSPECTOR_TITLE"),
			t("INSPECTOR_REMOVE_CONFIRM"),
			() => void this.removeComponent(componentId),
		).open();
	}

	private async removeComponent(componentId: string): Promise<void> {
		const pageId = this.activePage?.id;
		if (!pageId) return;
		this.store = await this.plugin.dashboardRepository.removeComponent(
			pageId,
			componentId,
		);
		if (this.selectedComponentId === componentId) {
			this.selectedComponentId = null;
			this.plugin.inspectorService.clear(this.leafId);
		}
		this.render();
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
		return gridMetrics(
			grid.clientWidth,
			this.activePage?.columns === 24 ? 24 : 12,
			gap,
			rowHeight,
		);
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
		const queries = this.queryRepository();
		const requests: MetricRequest[] = [];
		const seen = new Set<string>();
		for (const dashboard of this.store.dashboards) {
			for (const page of dashboard.pages) {
				for (const config of page.components) {
					const definition = this.registry.get(config.type);
					if (!definition?.toMetricRequest) continue;
					const request = definition.toMetricRequest(
						config,
						queries.get(config.queryId),
					);
					const key = metricKey(request);
					// metricKey has no pageId, so duplicates can be shared safely.
					if (seen.has(key)) continue;
					seen.add(key);
					requests.push(request);
				}
			}
		}
		this.hub.setRequests(requests);
		this.publishDatasetRequests(queries);
	}

	private publishDatasetRequests(queries: QueryRepository): void {
		if (!this.store || !this.hub) return;
		const requests: DatasetRequest[] = [];
		const seen = new Set<string>();
		for (const dashboard of this.store.dashboards) {
			for (const page of dashboard.pages) {
				for (const config of page.components) {
					const definition = this.registry.get(config.type);
					if (!definition?.toDatasetRequest) continue;
					const request = definition.toDatasetRequest(
						config,
						queries.get(config.queryId),
					);
					const key = datasetKey(request);
					if (seen.has(key)) continue;
					seen.add(key);
					requests.push(request);
				}
			}
		}
		this.hub.setDatasetRequests(requests);
	}

	private metricKeyOf(config: DashboardComponentConfig): string {
		const definition = this.registry.get(config.type);
		if (!definition?.toMetricRequest) return "";
		return metricKey(
			definition.toMetricRequest(
				config,
				this.queryRepository().get(config.queryId),
			),
		);
	}

	private openComponentPicker(): void {
		new ComponentPickerModal(
			this.app,
			this.registry.list(),
			(definition) => {
				void (async () => {
					const queries = this.queryRepository();
					const preferred = queries.get(definition.defaultQueryId);
					const targets = queryTargetsFor(definition);
					const target = targets[0] ?? "task";
					const objectQuery = queries.defaultFor(target);
					const queryId =
						preferred?.id ??
						objectQuery?.id ??
						queries.defaultFor("task")?.id ??
						"builtin:tasks-all";
					if (
						!preferred &&
						!objectQuery &&
						(target === "file" || target === "folder")
					) {
						new Notice(t("DASHBOARD_NEED_QUERY"));
						return;
					}
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
					this.selectedComponentId = config.id;
					this.render();
					this.selectComponent(config.id, "first");
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
				onNew: (target, onAdopted) =>
					this.openQueryEditor(null, target, onAdopted),
				onEdit: (query, onAdopted) =>
					this.openQueryEditor(query, undefined, onAdopted),
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
					this.hub?.scheduleRefresh(0);
					this.render();
					const created = this.store?.queries.find(
						(item) => item.id === copy.id,
					);
					return created
						? { queries: this.queryRepository().list(), created }
						: null;
				},
				onDelete: (query, onDeleted) => {
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
								this.hub?.scheduleRefresh(0);
								this.render();
								onDeleted(this.queryRepository().list());
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

	private openQueryEditor(
		initial: QueryDefinition | null,
		initialTarget?: QueryTarget,
		onAdopted?: (result: QueryMutationResult) => void,
	): void {
		new QueryEditModal(
			this.app,
			initial,
			(query) => {
				void (async () => {
					const exists = this.store?.queries.some(
						(item) => item.id === query.id,
					);
					try {
						this.store = exists
							? await this.plugin.dashboardRepository.updateQuery(query)
							: await this.plugin.dashboardRepository.addQuery(query);
					} catch (error) {
						console.warn(
							"IOTO Dashboard: query save failed",
							error,
						);
						new Notice(t("QUERY_SAVE_FAILED"));
						return;
					}
					this.queriesVersion += 1;
					this.hub?.scheduleRefresh(0);
					this.render();
					const created = this.store?.queries.find(
						(item) => item.id === query.id,
					);
					if (created && onAdopted) {
						onAdopted({
							queries: this.queryRepository().list(),
							created,
						});
					}
				})();
			},
			initialTarget,
		).open();
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

	private async openFolder(path: string): Promise<void> {
		const node = this.app.vault.getAbstractFileByPath(path);
		if (node instanceof TFile || node instanceof TFolder) {
			await this.revealNode(node);
		}
	}

	private async revealInExplorer(path: string): Promise<void> {
		const node = this.app.vault.getAbstractFileByPath(path);
		if (node instanceof TFile || node instanceof TFolder) {
			await this.revealNode(node);
		}
	}

	private async revealNode(node: TFile | TFolder): Promise<void> {
		if (!this.app.workspace.getLeavesOfType("file-explorer").length) {
			await this.app.workspace.getLeaf(false).setViewState({
				type: "file-explorer",
			});
		}
		const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
		const view = leaf?.view as
			| { revealInFolder?: (target: TFile | TFolder) => void }
			| undefined;
		view?.revealInFolder?.(node);
	}

	private async renderMarkdown(el: HTMLElement, path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.cachedRead(file);
		await MarkdownRenderer.render(this.app, content, el, file.path, this);
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

/**
 * Dashboard/page identity, names and the component ids on each page. Component
 * ids catch add/remove/duplicate/cross-page moves; content edits are ignored
 * because the editing leaf re-renders itself.
 */
function signatureOf(store: DashboardStoreData | null): string {
	if (!store) return "";
	return store.dashboards
		.map(
			(dashboard) =>
				`${dashboard.id}:${dashboard.name}[${dashboard.pages
					.map(
						(page) =>
							`${page.id}:${page.name}(${page.components
								.map((component) => component.id)
								.join(",")})`,
					)
					.join(",")}]`,
		)
		.join("|");
}
