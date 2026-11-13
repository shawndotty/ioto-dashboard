import {
	ItemView,
	MarkdownRenderer,
	Menu,
	Notice,
	Platform,
	TAbstractFile,
	TFile,
	TFolder,
	ViewStateResult,
	WorkspaceLeaf,
	parseLinktext,
	setIcon,
	setTooltip,
} from "obsidian";
import { CUSTOM_DASHBOARD_VIEW_TYPE } from "../models/constants";
import type IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { createComponentRegistry } from "../dashboard/components";
import { DataHub } from "../dashboard/data-hub";
import {
	MAX_CONTAINER_DEPTH,
	containsComponent,
	findComponentLocation,
	walkComponents,
} from "../dashboard/hierarchy";
import { datasetKey, type DatasetRequest } from "../dashboard/dataset/types";
import type {
	ComponentInspectorController,
	ComponentInspectorTarget,
	DashboardPagesInspectorTarget,
	InspectorFocus,
	InspectorSelection,
	PageInspectorController,
	PageInspectorTarget,
	PagesInspectorController,
} from "../dashboard/inspector-service";
import { resolveInspectorHost } from "../dashboard/inspector-service";
import {
	descendantsOf,
	groupOf,
	groupsOf,
	pagePath,
} from "../dashboard/page-tree";
import {
	dropIndex,
	dropIndexX,
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
	type ChartBucketPayload,
	type ComponentDefinition,
	type ComponentRenderContext,
	type ComponentStatus,
	type SizeBounds,
	type TargetPickerKind,
} from "../dashboard/registry";
import {
	cardStyleVars,
	cardSurfaceOf,
	containerColumnsOf,
	containerVarsOf,
	titleHiddenInMode,
} from "../dashboard/style-settings";
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
import { ChartBucketModal } from "../ui/chart-bucket-modal";
import { ComponentPickerModal } from "../ui/component-picker";
import { ConfirmModal } from "../ui/ConfirmModal";
import { ContainerPickerModal, type ContainerTarget } from "../ui/container-picker";
import {
	DashboardManagerModal,
	uniqueDashboardName,
} from "../ui/dashboard-manager";
import { FolderContentsModal } from "../ui/folder-contents-modal";
import { PageLayoutModal } from "../ui/page-layout-modal";
import { PageNameModal } from "../ui/page-name-modal";
import { PagePickerModal, type PageTarget } from "../ui/page-picker";
import { armPointerDrag, bindPointerSession } from "../ui/pointer-session";
import { CommandPickerModal } from "../ui/pickers/command-picker";
import { NotePickerModal } from "../ui/pickers/note-picker";
import { ProjectTasksModal } from "../ui/project-tasks-modal";
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
	private isZenMode = false;
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
	private pagesScrollEl: HTMLElement | null = null;
	private pagesLiveEl: HTMLElement | null = null;
	private subpagesEl: HTMLElement | null = null;
	private subpagesScrollEl: HTMLElement | null = null;
	private subpagesToggleEl: HTMLElement | null = null;
	private subpagesSignature = "";
	private suppressPageTabClick = false;
	private pageTabDragGhost: HTMLElement | null = null;
	private emptyEl: HTMLElement | null = null;
	private gridEl: HTMLElement | null = null;
	private toolbarSignature = "";
	private pagesSignature = "";
	private dragGhost: HTMLElement | null = null;
	private autoRepairKeys = new Set<string>();
	private renderFailures = new Set<string>();
	private visibilityTimer: number | null = null;
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
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () =>
				this.updateVisibility(),
			),
		);
		this.registerDomEvent(document, "visibilitychange", () =>
			this.updateVisibility(),
		);
		this.registerDomEvent(window, "focus", () => this.updateVisibility());
		this.observeContainerWidth();
		this.controller = this.createInspectorController();
		this.registerDomEvent(this.contentEl, "keydown", (event) => {
			if (event.key !== "Escape" || this.interacting) return;
			if (this.selectedComponentId || this.localSelection()) {
				this.clearSelection();
				return;
			}
			if (this.isZenMode) this.toggleZenMode();
		});
		this.render();
		this.updateVisibility();
	}

	async onClose(): Promise<void> {
		this.destroyInlineInspector();
		this.plugin.inspectorService.clear(this.leafId);
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.unsubscribers = [];
		if (this.visibilityTimer !== null) {
			window.clearTimeout(this.visibilityTimer);
			this.visibilityTimer = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.removeDragGhost();
		this.removePageTabGhost();
		this.removeResizeOverlays();
		this.hub?.destroy();
		this.hub = null;
	}

	private updateVisibility(): void {
		const visible = this.containerEl.isShown();
		this.hub?.setVisible(visible);
		if (visible || this.visibilityTimer !== null) return;
		// Layout events can fire before the element is attached; recheck once.
		this.visibilityTimer = window.setTimeout(() => {
			this.visibilityTimer = null;
			if (this.containerEl.isShown()) this.hub?.setVisible(true);
		}, 1500);
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
			isZenMode: this.isZenMode,
		};
	}

	async setState(state: unknown, result: ViewStateResult) {
		const s = (state ?? {}) as {
			activePageId?: unknown;
			dashboardId?: unknown;
			pageId?: unknown;
			isZenMode?: unknown;
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
		if (typeof s.isZenMode === "boolean") {
			this.isZenMode = s.isZenMode;
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
		this.pagesScrollEl = null;
		this.subpagesEl = null;
		this.subpagesScrollEl = null;
		this.subpagesToggleEl = null;
		this.emptyEl = null;
		this.gridEl = null;
		this.toolbarSignature = "";
		this.pagesSignature = "";
		this.subpagesSignature = "";
	}

	private render(): void {
		const scrollTop = this.contentEl.scrollTop;
		this.contentEl.addClass("ioto-custom-dashboard-view");
		this.ensureShell();
		this.contentEl.toggleClass("is-zen", this.isZenMode);
		this.contentEl.toggleClass("is-mobile", Platform.isMobile);
		this.syncToolbar();
		this.syncBanner();
		this.syncPagesBar();
		this.syncSubpagesBar();

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
			this.pagesScrollEl = this.pagesEl.createDiv({
				cls: "ioto-dashboard-pages-scroll",
				attr: { role: "tablist" },
			});
			this.pagesLiveEl = this.pagesEl.createDiv({
				cls: "ioto-visually-hidden",
				attr: { "aria-live": "polite" },
			});
			// Bound once: the scroll container persists and is only emptied.
			this.pagesScrollEl.addEventListener("keydown", (event) =>
				this.handlePagesKeydown(event),
			);
			const add = this.pagesEl.createEl("button", {
				cls: "ioto-dashboard-page-add clickable-icon",
				attr: { type: "button", "aria-label": t("PAGE_TABS_ADD") },
			});
			setIcon(add, "plus");
			setTooltip(add, t("PAGE_TABS_ADD"));
			add.onClickEvent(() => void this.createPage());
			const exit = this.pagesEl.createEl("button", {
				cls: "ioto-dashboard-zen-exit clickable-icon",
				attr: { type: "button", "aria-label": t("ZEN_MODE_OFF") },
			});
			setIcon(exit, "minimize");
			setTooltip(exit, t("ZEN_MODE_OFF"));
			exit.onClickEvent(() => this.toggleZenMode());
		}
		if (!this.subpagesEl) {
			this.subpagesEl = this.contentEl.createDiv({
				cls: "ioto-dashboard-subpages",
			});
			this.subpagesEl.hide();
			this.pagesEl?.insertAdjacentElement("afterend", this.subpagesEl);
			this.subpagesScrollEl = this.subpagesEl.createDiv({
				cls: "ioto-dashboard-subpages-scroll",
				attr: { role: "tablist" },
			});
			this.subpagesScrollEl.addEventListener("keydown", (event) =>
				this.handlePagesKeydown(event),
			);
			this.subpagesToggleEl = this.subpagesEl.createEl("button", {
				cls: "ioto-dashboard-subpages-toggle clickable-icon",
				attr: {
					type: "button",
					"aria-label": t("PAGE_SUBPAGES_MENU"),
					"aria-haspopup": "menu",
				},
			});
			setIcon(this.subpagesToggleEl, "chevron-down");
			setTooltip(this.subpagesToggleEl, t("PAGE_SUBPAGES_MENU"));
			this.subpagesToggleEl.onClickEvent((event) =>
				this.openSubpagesMenu(event),
			);
		}
	}

	private syncToolbar(): void {
		const dashboard = this.activeDashboard;
		const selected = this.editMode ? this.selectedToolbarComponent() : null;
		const selectedTitle = selected
			? this.titleOf(selected, this.registry.get(selected.type))
			: "";
		const signature = [
			this.editMode ? "edit" : "view",
			dashboard?.id ?? "",
			dashboard?.name ?? "",
			selected?.id ?? "",
			selectedTitle,
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
		if (this.editMode) {
			this.addIconToolbarButton(
				manage,
				"layers",
				t("DASHBOARD_PAGES_TITLE"),
				() => this.openPagesPanel(),
			);
		}

		const actions = toolbar.createDiv({ cls: "ioto-dashboard-actions" });
		if (selected) {
			const selectedContext = actions.createDiv({
				cls: "ioto-dashboard-selected-context",
			});
			selectedContext.setAttr(
				"aria-label",
				t("DASHBOARD_SELECTED_COMPONENT"),
			);
			selectedContext.createSpan({
				cls: "ioto-dashboard-selected-title",
				text: selectedTitle,
			});
			this.addIconToolbarButton(
				selectedContext,
				"pencil",
				t("DASHBOARD_RENAME_COMPONENT"),
				() => this.selectComponent(selected.id, "title"),
			);
			this.addIconToolbarButton(
				selectedContext,
				"trash-2",
				t("DASHBOARD_CONFIG_REMOVE"),
				() => this.confirmRemove(selected.id),
				"ioto-dashboard-selected-remove",
			);
		}
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
		if (!this.editMode) {
			this.addIconToolbarButton(
				actions,
				"maximize",
				t("ZEN_MODE_ON"),
				() => this.toggleZenMode(),
				"ioto-dashboard-zen-enter",
			);
		}
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
		const groups = groupsOf(pages);
		const activeId = this.activePage?.id ?? "";
		const activeGroupId = groupOf(pages, activeId)?.page.id ?? "";
		const signature = [
			this.editMode ? "edit" : "view",
			activeId,
			groups
				.map((group) =>
					[
						`${group.page.id}:${group.page.name}`,
						...group.children.map(
							(child) => `${child.id}:${child.name}`,
						),
					].join(","),
				)
				.join("|"),
		].join("#");
		if (signature === this.pagesSignature) return;
		this.pagesSignature = signature;
		const strip = this.pagesScrollEl;
		if (!strip) return;
		strip.empty();
		const total = groups.length;
		groups.forEach((group, index) => {
			const page = group.page;
			const active = page.id === activeGroupId;
			const tab = strip.createDiv({
				cls: `ioto-dashboard-page-tab${active ? " is-active" : ""}`,
				attr: {
					role: "tab",
					tabindex: active ? "0" : "-1",
					"aria-selected": page.id === activeId ? "true" : "false",
					"aria-posinset": String(index + 1),
					"aria-setsize": String(total),
					"data-page-id": page.id,
					...(group.children.length > 0
						? { "aria-expanded": "true" }
						: {}),
				},
			});
			tab.createSpan({
				cls: "ioto-dashboard-page-tab-label",
				text: page.name,
			});
			if (group.children.length > 0) {
				const chevron = tab.createSpan({
					cls: "ioto-dashboard-page-tab-chevron",
					attr: { "aria-hidden": "true" },
				});
				setIcon(chevron, "chevron-down");
			}
			tab.onClickEvent(() => {
				if (this.suppressPageTabClick) {
					this.suppressPageTabClick = false;
					return;
				}
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
					tab.addEventListener("pointerdown", (event) => {
						// Tools inside the tab must keep their own click semantics.
						if ((event.target as HTMLElement | null)?.closest("button")) {
							return;
						}
						this.armPageTabDrag(tab, page, event);
					});
					tab.addEventListener("contextmenu", (event) => {
						if ((event.target as HTMLElement | null)?.closest("button")) {
							return;
						}
						event.preventDefault();
						this.openPageContextMenu(event, page);
					});
				}
				this.renderPageTabTools(tab, page);
			}
		});
	}

	private syncSubpagesBar(): void {
		const pages = this.activeDashboard?.pages ?? [];
		const activeId = this.activePage?.id ?? "";
		const group = groupOf(pages, activeId);
		const children = group?.children ?? [];
		const signature = [
			this.editMode ? "edit" : "view",
			activeId,
			children.map((page) => `${page.id}:${page.name}`).join("|"),
		].join("#");
		if (signature === this.subpagesSignature) return;
		this.subpagesSignature = signature;
		const root = this.subpagesEl;
		const strip = this.subpagesScrollEl;
		if (!root || !strip) return;
		strip.empty();
		if (children.length === 0) {
			root.hide();
			return;
		}
		root.show();
		const total = children.length;
		children.forEach((page, index) => {
			const active = page.id === activeId;
			const tab = strip.createDiv({
				cls: `ioto-dashboard-subpage-tab${active ? " is-active" : ""}`,
				attr: {
					role: "tab",
					tabindex: active ? "0" : "-1",
					"aria-selected": active ? "true" : "false",
					"aria-posinset": String(index + 1),
					"aria-setsize": String(total),
					"data-page-id": page.id,
				},
			});
			tab.createSpan({ text: page.name });
			tab.onClickEvent(() => {
				if (this.suppressPageTabClick) {
					this.suppressPageTabClick = false;
					return;
				}
				if (this.editMode && !Platform.isMobile) {
					this.openPageSettings(page);
					return;
				}
				this.switchPage(page.id);
			});
			if (!this.editMode || Platform.isMobile) return;
			tab.addEventListener("pointerdown", (event) => {
				if ((event.target as HTMLElement | null)?.closest("button")) {
					return;
				}
				this.armPageTabDrag(tab, page, event, strip);
			});
			tab.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				this.openPageContextMenu(event, page);
			});
		});
	}

	private openSubpagesMenu(event: MouseEvent): void {
		const pages = this.activeDashboard?.pages ?? [];
		const group = groupOf(pages, this.activePage?.id ?? "");
		if (!group || group.children.length === 0) return;
		const menu = new Menu();
		for (const child of group.children) {
			menu.addItem((item) => {
				item.setTitle(child.name).onClick(() =>
					this.switchPage(child.id),
				);
				if (child.id === this.activePage?.id) {
					item.setIcon("check");
				}
			});
		}
		if (event.detail > 0) {
			menu.showAtMouseEvent(event);
			return;
		}
		const rect = (event.target as HTMLElement).getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	private openPageContextMenu(event: MouseEvent, page: DashboardPage): void {
		if (!this.editMode || Platform.isMobile) return;
		const dashboard = this.activeDashboard;
		if (!dashboard) return;
		const pages = dashboard.pages;
		const hasChildren = descendantsOf(pages, page.id).length > 0;
		const menu = new Menu();
		if (!page.parentId) {
			menu.addItem((item) => {
				item.setTitle(t("PAGE_SUBPAGE_NEW"))
					.setIcon("corner-down-right")
					.onClick(() => void this.createPageWithParent(page.id));
			});
		}
		menu.addItem((item) => {
			item.setTitle(t("PAGE_SUBPAGE_MOVE_TO"))
				.setIcon("folder-symlink")
				.setDisabled(!page.parentId && hasChildren)
				.onClick(() => this.pickPageParent(page));
		});
		if (page.parentId) {
			menu.addItem((item) => {
				item.setTitle(t("PAGE_SUBPAGE_MOVE_OUT"))
					.setIcon("corner-up-left")
					.onClick(() => void this.applyPageParent(page.id, null));
			});
		}
		if (event.detail > 0) {
			menu.showAtMouseEvent(event);
			return;
		}
		const rect = (event.target as HTMLElement).getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	private pickPageParent(page: DashboardPage): void {
		const pages = this.activeDashboard?.pages ?? [];
		const hasChildren = descendantsOf(pages, page.id).length > 0;
		if (!page.parentId && hasChildren) return;
		const candidates = pages
			.filter(
				(item) =>
					!item.parentId && item.id !== page.id && item.id !== page.parentId,
			)
			.map((item) => ({
				dashboard: this.activeDashboard!,
				page: item,
			}));
		if (candidates.length === 0) {
			new Notice(t("PICKER_NO_PAGES_FOUND"));
			return;
		}
		new PagePickerModal(
			this.app,
			candidates,
			(target) => void this.applyPageParent(page.id, target.page.id),
			{
				describe: (target) => this.describePagePath(target),
				placeholder: t("PAGE_MOVE_PICKER_PLACEHOLDER"),
			},
		).open();
	}

	private async applyPageParent(
		pageId: string,
		parentId: string | null,
	): Promise<void> {
		this.store = await this.plugin.dashboardRepository.setPageParent(
			pageId,
			parentId,
		);
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	private describePagePath(target: PageTarget): string {
		const pages = target.dashboard.pages;
		const path = pagePath(pages, target.page.id);
		return [target.dashboard.name, ...path.map((page) => page.name)].join(
			" / ",
		);
	}

	private pageSiblingsOf(pageId: string): DashboardPage[] {
		const pages = this.activeDashboard?.pages ?? [];
		const page = pages.find((item) => item.id === pageId);
		if (!page) return [];
		if (page.parentId) {
			return groupOf(pages, page.id)?.children ?? [];
		}
		return pages.filter((item) => !item.parentId);
	}

	private handlePagesKeydown(event: KeyboardEvent): void {
		const inSubpages =
			event.currentTarget === this.subpagesScrollEl;
		const active = this.activePage;
		if (!active) return;
		const siblings = this.layerSiblings(active, inSubpages);
		if (siblings.length === 0) return;
		// The top strip keeps working while a subpage is active: it anchors on
		// the active subpage's parent page.
		const anchorId = inSubpages
			? active.id
			: (groupOf(
					this.activeDashboard?.pages ?? [],
					active.id,
				)?.page.id ?? active.id);
		const index = siblings.findIndex((page) => page.id === anchorId);
		if (index < 0) return;
		if (
			this.editMode &&
			!Platform.isMobile &&
			event.altKey &&
			(event.key === "ArrowLeft" || event.key === "ArrowRight")
		) {
			event.preventDefault();
			void this.moveActivePage(
				event.key === "ArrowLeft" ? -1 : 1,
				inSubpages,
			);
			return;
		}
		let next: number;
		switch (event.key) {
			case "ArrowRight":
				next = (index + 1) % siblings.length;
				break;
			case "ArrowLeft":
				next = (index - 1 + siblings.length) % siblings.length;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = siblings.length - 1;
				break;
			default:
				return;
		}
		const target = siblings[next];
		if (!target) return;
		event.preventDefault();
		this.switchPage(target.id);
		this.focusPageTab(target.id);
	}

	private layerSiblings(
		page: DashboardPage,
		inSubpages: boolean,
	): DashboardPage[] {
		const pages = this.activeDashboard?.pages ?? [];
		if (inSubpages) {
			return page.parentId
				? (groupOf(pages, page.id)?.children ?? [])
				: [];
		}
		return pages.filter((item) => !item.parentId);
	}

	private focusPageTab(pageId: string): void {
		const escaped = CSS.escape(pageId);
		const selector = `[role="tab"][data-page-id="${escaped}"]`;
		const tab =
			this.pagesScrollEl?.querySelector<HTMLElement>(selector) ??
			this.subpagesScrollEl?.querySelector<HTMLElement>(selector);
		tab?.focus();
		tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}

	private async moveActivePage(
		offset: -1 | 1,
		inSubpages = Boolean(this.activePage?.parentId),
	): Promise<void> {
		const page = this.activePage;
		if (!page) return;
		const siblings = this.layerSiblings(page, inSubpages);
		const moving = inSubpages
			? page
			: (groupOf(this.activeDashboard?.pages ?? [], page.id)?.page ??
				page);
		const index = siblings.findIndex((item) => item.id === moving.id);
		if (index < 0) return;
		const to = Math.min(
			siblings.length - 1,
			Math.max(0, index + offset),
		);
		if (to === index) return;
		this.store = await this.plugin.dashboardRepository.movePage(
			moving.id,
			to,
		);
		this.render();
		this.focusPageTab(moving.id);
		this.announcePageMove(moving.id);
	}

	private announcePageMove(pageId: string): void {
		const live = this.pagesLiveEl;
		const page = this.activeDashboard?.pages.find(
			(item) => item.id === pageId,
		);
		if (!live || !page) return;
		const siblings = this.layerSiblings(page, Boolean(page.parentId));
		const index = siblings.findIndex((item) => item.id === pageId);
		if (index < 0) return;
		live.setText(
			t("PAGE_MOVE_ANNOUNCE", [
				page.name,
				String(index + 1),
				String(siblings.length),
			]),
		);
	}

	private armPageTabDrag(
		tab: HTMLElement,
		page: DashboardPage,
		event: PointerEvent,
		strip: HTMLElement | null = this.pagesScrollEl,
	): void {
		armPointerDrag(tab, event, {
			onActivate: (startEvent) =>
				this.startPageTabDrag(tab, page, startEvent, strip),
		});
	}

	private startPageTabDrag(
		tab: HTMLElement,
		page: DashboardPage,
		startEvent: PointerEvent,
		strip: HTMLElement | null = this.pagesScrollEl,
	): void {
		if (!strip) return;
		// Guards the click that follows pointerup from opening page settings.
		this.suppressPageTabClick = true;
		startEvent.preventDefault();
		this.beginInteraction();
		try {
			tab.setPointerCapture(startEvent.pointerId);
		} catch {
			// Capture is best-effort; document listeners still receive moves.
		}
		const doc = tab.ownerDocument;
		const win = doc.defaultView ?? window;
		const reduceMotion =
			typeof win.matchMedia === "function" &&
			win.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const startX = startEvent.clientX;
		const startY = startEvent.clientY;
		const rect = tab.getBoundingClientRect();
		const ghost = tab.cloneNode(true) as HTMLElement;
		ghost.removeAttribute("data-page-id");
		ghost.removeAttribute("tabindex");
		ghost.setAttr("aria-hidden", "true");
		ghost.removeClass("is-active");
		ghost.addClass("ioto-custom-dashboard-view");
		ghost.addClass("ioto-dashboard-page-tab-ghost");
		ghost.style.left = `${rect.left}px`;
		ghost.style.top = `${rect.top}px`;
		ghost.style.width = `${rect.width}px`;
		ghost.style.height = `${rect.height}px`;
		doc.body.appendChild(ghost);
		this.pageTabDragGhost = ghost;
		tab.addClass("is-dragged");

		const pointer = { x: startX };
		let frame: number | null = null;
		let dirty = false;
		const tick = (): void => {
			frame = null;
			const scrolled = this.applyPageStripAutoScroll(strip, pointer.x);
			if (dirty || scrolled !== 0) {
				dirty = false;
				this.previewPageTabOrder(strip, tab, pointer.x, reduceMotion);
			}
			if (scrolled !== 0) frame = win.requestAnimationFrame(tick);
		};
		const schedule = (): void => {
			if (frame === null) frame = win.requestAnimationFrame(tick);
		};
		schedule();

		bindPointerSession(tab, startEvent.pointerId, {
			onMove: (moveEvent) => {
				pointer.x = moveEvent.clientX;
				ghost.style.transform = `translate3d(${
					moveEvent.clientX - startX
				}px, ${moveEvent.clientY - startY}px, 0)`;
				dirty = true;
				schedule();
			},
			onFinish: (cancelled) => {
				if (frame !== null) win.cancelAnimationFrame(frame);
				frame = null;
				win.setTimeout(() => {
					this.suppressPageTabClick = false;
				}, 0);
				this.removePageTabGhost();
				tab.removeClass("is-dragged");
				if (cancelled) {
					// Preview reordering mutated the strip; force a rebuild.
					this.pagesSignature = "";
					this.abortInteraction();
					return;
				}
				void this.commitPageTabOrder(page.id, strip);
			},
		});
	}

	private previewPageTabOrder(
		strip: HTMLElement,
		tab: HTMLElement,
		x: number,
		reduceMotion: boolean,
	): void {
		const tabs = Array.from(
			strip.querySelectorAll<HTMLElement>("[role='tab'][data-page-id]"),
		);
		const rects: CardRect[] = [];
		for (const element of tabs) {
			const rect = element.getBoundingClientRect();
			rects.push({
				id: element.dataset.pageId ?? "",
				top: rect.top,
				left: rect.left,
				width: rect.width,
				height: rect.height,
			});
		}
		const others = tabs.filter((element) => element !== tab);
		const reference =
			others[
				dropIndexX(rects, x, tab.dataset.pageId ?? "")
			] ?? null;
		if (tab.nextElementSibling === reference) return;
		if (reduceMotion) {
			strip.insertBefore(tab, reference);
			return;
		}
		this.flip(others, () => strip.insertBefore(tab, reference));
	}

	private applyPageStripAutoScroll(strip: HTMLElement, x: number): number {
		if (strip.scrollWidth <= strip.clientWidth + 1) return 0;
		const rect = strip.getBoundingClientRect();
		const edge = 24;
		let delta = 0;
		if (x < rect.left + edge) {
			delta = -Math.ceil((rect.left + edge - x) / 2);
		} else if (x > rect.right - edge) {
			delta = Math.ceil((x - (rect.right - edge)) / 2);
		}
		if (delta === 0) return 0;
		const before = strip.scrollLeft;
		strip.scrollLeft = before + delta;
		return strip.scrollLeft - before;
	}

	private async commitPageTabOrder(
		pageId: string,
		strip: HTMLElement | null = this.pagesScrollEl,
	): Promise<void> {
		const dashboard = this.activeDashboard;
		if (!dashboard) {
			this.abortInteraction();
			return;
		}
		const order = strip
			? Array.from(
					strip.querySelectorAll<HTMLElement>(
						"[role='tab'][data-page-id]",
					),
				)
					.map((element) => element.dataset.pageId ?? "")
					.filter(Boolean)
			: [];
		// Tab DOM order is the visible layer, so both branches pass a
		// layer-local index (group index or sibling index) to the repository.
		const toIndex = order.indexOf(pageId);
		const fromIndex = this.pageSiblingsOf(pageId).findIndex(
			(page) => page.id === pageId,
		);
		const changed =
			toIndex >= 0 && fromIndex >= 0 && toIndex !== fromIndex;
		if (changed) {
			this.store = await this.plugin.dashboardRepository.movePage(
				pageId,
				toIndex,
			);
		}
		const rendered = this.endInteraction();
		if (changed && !rendered) this.render();
		if (changed) this.announcePageMove(pageId);
	}

	private removePageTabGhost(): void {
		this.pageTabDragGhost?.remove();
		this.pageTabDragGhost = null;
	}

	private renderPageTabTools(tab: HTMLElement, page: DashboardPage): void {
		if (Platform.isMobile) {
			const layout = tab.createEl("button", {
				cls: "ioto-dashboard-page-tool ioto-dashboard-page-tool--layout",
				attr: { type: "button", "aria-label": t("PAGE_LAYOUT_TITLE") },
			});
			setIcon(layout, "layout-dashboard");
			setTooltip(layout, t("PAGE_LAYOUT_TITLE"));
			layout.onClickEvent((event) => {
				event.stopPropagation();
				this.openPageLayout(page);
			});
			const rename = tab.createEl("button", {
				cls: "ioto-dashboard-page-tool ioto-dashboard-page-tool--rename",
				attr: { type: "button", "aria-label": t("PAGE_RENAME") },
			});
			setIcon(rename, "pencil");
			setTooltip(rename, t("PAGE_RENAME"));
			rename.onClickEvent((event) => {
				event.stopPropagation();
				this.openRenamePage(page);
			});
			const duplicate = tab.createEl("button", {
				cls: "ioto-dashboard-page-tool ioto-dashboard-page-tool--duplicate",
				attr: { type: "button", "aria-label": t("PAGE_DUPLICATE") },
			});
			setIcon(duplicate, "copy");
			setTooltip(duplicate, t("PAGE_DUPLICATE"));
			duplicate.onClickEvent((event) => {
				event.stopPropagation();
				void this.duplicatePage(page);
			});
		}
		const remove = tab.createEl("button", {
			cls: "ioto-dashboard-page-tool ioto-dashboard-page-tool--delete is-danger",
			attr: { type: "button", "aria-label": t("PAGE_DELETE") },
		});
		setIcon(remove, "x");
		setTooltip(remove, t("PAGE_DELETE"));
		remove.onClickEvent((event) => {
			event.stopPropagation();
			this.confirmRemovePage(page);
		});
	}

	private switchPage(pageId: string): void {
		const dashboard = this.activeDashboard;
		if (!dashboard || pageId === this.activePage?.id) return;
		const local = this.localSelection();
		if (local?.kind !== "pages") this.clearSelection();
		const wasPageSettings = local?.kind === "page";
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

	/** 供插件激活入口精确落页；内部仍走 switchPage 的选择清理与持久化。 */
	showPage(pageId: string): void {
		this.switchPage(pageId);
	}

	toggleZenMode(): void {
		if (!this.isZenMode && this.editMode) {
			this.editMode = false;
			this.clearSelection();
		}
		this.isZenMode = !this.isZenMode;
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	private async createPage(): Promise<void> {
		await this.createPageWithParent();
	}

	private async createPageWithParent(parentId?: string): Promise<void> {
		const dashboard = this.activeDashboard;
		if (!dashboard) return;
		const local = this.localSelection();
		if (local?.kind !== "pages") this.clearSelection();
		const taken = new Set(
			this.store?.dashboards.flatMap((item) =>
				item.pages.map((page) => page.id),
			) ?? [],
		);
		const base = `page:${Date.now()}`;
		let id = base;
		let index = 2;
		while (taken.has(id)) id = `${base}-${index++}`;
		const siblingNames = dashboard.pages
			.filter((page) => page.parentId === parentId)
			.map((page) => page.name);
		const page: DashboardPage = {
			id,
			name: uniqueDashboardName(
				t("PAGE_DEFAULT_NAME", [String(siblingNames.length + 1)]),
				siblingNames,
			),
			components: [],
		};
		if (parentId) page.parentId = parentId;
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
		if (!dashboard) return;
		const descendants = descendantsOf(dashboard.pages, page.id);
		const remaining =
			dashboard.pages.length - 1 - descendants.length;
		if (remaining <= 0) {
			new Notice(t("PAGE_LAST_CANNOT_DELETE"));
			return;
		}
		const message =
			descendants.length > 0
				? t("PAGE_DELETE_SUBPAGES_MSG", [
						page.name,
						String(page.components.length),
						String(descendants.length),
					])
				: t("PAGE_DELETE_MSG", [
						page.name,
						String(page.components.length),
					]);
		new ConfirmModal(
			this.app,
			t("PAGE_DELETE_TITLE"),
			message,
			() => {
				void (async () => {
					const removed = new Set([
						page.id,
						...descendants.map((item) => item.id),
					]);
					this.store =
						await this.plugin.dashboardRepository.removePage(page.id);
					const selection = this.localSelection();
					if (
						selection?.kind === "page" &&
						removed.has(selection.pageId)
					) {
						this.plugin.inspectorService.clear(this.leafId);
					}
					if (this.leafPageId && removed.has(this.leafPageId)) {
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
				.setTitle(t("DASHBOARD_REFRESH_ALL"))
				.setIcon("refresh-cw")
				.onClick(() => this.hub?.refreshNow()),
		);
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

	private openCardMenu(
		event: MouseEvent,
		config: DashboardComponentConfig,
	): void {
		if (!this.editMode) return;
		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				"a, button, input, select, textarea, [contenteditable='true']",
			)
		) {
			return;
		}
		event.preventDefault();
		// duplicate/move 读取 selectedComponentId，先同步选中再打开菜单。
		this.selectComponent(config.id);
		const page = this.activePage;
		const location = page
			? findComponentLocation(page.components, config.id)
			: undefined;
		const depth = location?.depth ?? 0;
		const parentId = location?.parent?.id ?? null;
		const hasContainers =
			page?.components.some((item) => item.type === "container") ?? false;
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("DASHBOARD_RENAME_COMPONENT"))
				.setIcon("pencil")
				.onClick(() => this.selectComponent(config.id, "title")),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("DASHBOARD_DUPLICATE_COMPONENT"))
				.setIcon("copy")
				.onClick(() => void this.duplicateSelectedComponent()),
		);
		if (depth === 0) {
			menu.addItem((item) =>
				item
					.setTitle(t("DASHBOARD_MOVE_COMPONENT"))
					.setIcon("folder-symlink")
					.onClick(() => void this.moveSelectedComponent()),
			);
		}
		if (depth === 0 && config.type !== "container" && hasContainers) {
			menu.addItem((item) =>
				item
					.setTitle(t("DASHBOARD_MOVE_INTO_CONTAINER"))
					.setIcon("panel-top-open")
					.onClick(() => void this.moveSelectedIntoContainer()),
			);
		}
		if (parentId !== null) {
			menu.addItem((item) =>
				item
					.setTitle(t("DASHBOARD_MOVE_OUT_OF_CONTAINER"))
					.setIcon("panel-top-close")
					.onClick(() => void this.moveSelectedOutOfContainer()),
			);
		}
		if (config.type === "container") {
			menu.addItem((item) =>
				item
					.setTitle(t("DASHBOARD_DISSOLVE_CONTAINER"))
					.setIcon("ungroup")
					.onClick(() => void this.dissolveSelectedContainer()),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle(t("DASHBOARD_RESET_SIZE"))
				.setIcon("maximize")
				.onClick(() => void this.resetComponentSize(config.id)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("DASHBOARD_CONFIG_REMOVE"))
				.setIcon("trash-2")
				.onClick(() => this.confirmRemove(config.id)),
		);
		menu.showAtMouseEvent(event);
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
				let next: HTMLElement;
				try {
					next = this.createCard(grid, config, queries);
					this.renderFailures.delete(config.id);
				} catch (error) {
					if (!this.renderFailures.has(config.id)) {
						this.renderFailures.add(config.id);
						console.error(
							"IOTO Dashboard: card render failed",
							config.id,
							error,
						);
					}
					next = this.renderCardFallback(grid, config, error);
				}
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
		// Queryless cards never rebuild on data/query versions (keeps editor focus).
		const queryless = this.registry.get(config.type)?.queryless === true;
		// Child changes rebuild the whole container (single-level reconciliation).
		const childSignature = (config.children ?? [])
			.map((child) => `${child.id}:${this.cardSignature(child)}`)
			.join(",");
		return [
			config.type,
			queryless ? "" : config.queryId,
			config.basis ?? "",
			config.view ?? "",
			config.measure ?? "",
			JSON.stringify(config.options ?? {}),
			String(config.limit ?? ""),
			config.title ?? "",
			String(size.w),
			String(size.h),
			this.editMode ? "edit" : "view",
			queryless ? "" : String(this.dataVersion),
			queryless ? "" : String(this.queriesVersion),
			childSignature,
		].join("|");
	}

	private titleOf(
		config: DashboardComponentConfig,
		definition: ComponentDefinition | undefined,
	): string {
		return (
			config.title ??
			(definition
				? t(definition.labelKey as Parameters<typeof t>[0])
				: config.type)
		);
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
		const bare = style.surface !== "card";
		card.dataset.componentType = config.type;
		card.toggleClass("is-surface-plain", style.surface === "plain");
		card.toggleClass("is-surface-flat", style.surface === "flat");
		card.toggleClass("is-surface-bare", bare);
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
				// Nested cards handle their own selection; the container ignores it.
				const owner = this.cardOwnerOf(event);
				if (owner && owner !== card) return;
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

		const hideTitle = titleHiddenInMode(
			config.options,
			this.editMode,
			definition?.acceptsChildren === true,
		);
		const header = card.createDiv({ cls: "ioto-dashboard-card-header" });
		header.toggleClass("is-title-overlay", hideTitle);
		card.toggleClass("is-title-hidden", hideTitle);
		if (this.editMode) {
			this.renderDragHandle(header, grid, card, config);
		}
		if (hideTitle) {
			card.setAttr("aria-label", this.titleOf(config, definition));
		} else if (this.editMode && bare) {
			// 裸表面编辑态不渲染标题，避免回流位移；可访问名落到卡片上。
			card.setAttr("aria-label", this.titleOf(config, definition));
		} else {
			header.createDiv({
				cls: "ioto-dashboard-card-title",
				text: this.titleOf(config, definition),
			});
		}
		if (this.editMode && !bare && config.type !== "container") {
			this.renderRenameButton(header, config);
			this.renderRemoveButton(header, config);
		}
		if (this.editMode) {
			card.addEventListener("contextmenu", (event) => {
				const owner = this.cardOwnerOf(event);
				if (owner && owner !== card) return;
				this.openCardMenu(event, config);
			});
		}

		const body = card.createDiv({ cls: "ioto-dashboard-card-body" });
		if (this.editMode) {
			this.renderResizeHandle(card, grid, config);
		}
		if (definition?.acceptsChildren) {
			// Only the page level nests; a container inside a container stays flat.
			const depth =
				findComponentLocation(this.activePage?.components ?? [], config.id)
					?.depth ?? 0;
			if (depth < MAX_CONTAINER_DEPTH) {
				this.renderContainerBody(card, body, config);
			}
		}
		if (!definition) {
			this.registry.placeholder(body, config.type);
			return card;
		}

		const datasetRequest = definition.toDatasetRequest?.(config, query);
		const dataset = datasetRequest
			? this.hub?.getDataset(datasetKey(datasetRequest))
			: undefined;
		const { status, messageKey, message } = this.statusOf(
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
			if (message) {
				this.renderCardError(body, message);
				return card;
			}
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
			openProjectTasks: (group, ratioBase) =>
				this.openProjectTasks(group, ratioBase),
			openFile: (path, line) => void this.openNote(path, line),
			openFileInNewTab: (path, line) =>
				void this.openNote(path, line, true),
			openFolder: (path) => void this.openFolder(path),
			revealInExplorer: (path) => void this.revealInExplorer(path),
			openLink: (path, line, newTab) =>
				void this.openVaultTarget(path, line, newTab),
			executeCommand: (id) => this.app.commands.executeCommandById(id),
			openPage: (pageId) => this.openPageById(pageId),
			describeTarget: (picker, value) => this.describeTarget(picker, value),
			openChartBucket: (payload) => this.openChartBucket(payload),
			renderMarkdown: (el, path) => this.renderMarkdown(el, path),
			renderInlineMarkdown: (el, markdown, sourcePath) =>
				MarkdownRenderer.render(this.app, markdown, el, sourcePath, this),
			renderMarkdownFragment: (el, markdown) =>
				this.renderMarkdownFragment(el, markdown),
			patchComponent: (patch) => void this.updateComponent(config.id, patch),
		};
		try {
			definition.render(body, ctx);
		} catch (error) {
			console.error(
				"IOTO Dashboard: component render failed",
				config.id,
				config.type,
				error,
			);
			this.renderCardError(
				body,
				error instanceof Error ? error.message : String(error),
			);
			return card;
		}
		// `render` 先执行，头部钩子才能拿到已创建的列表句柄恢复过滤态。
		if (!this.editMode && (status === "ready" || status === "empty")) {
			definition.renderHeaderActions?.(header, ctx);
		}
		return card;
	}

	/** Innermost card under the event target; containers ignore nested events. */
	private cardOwnerOf(event: Event): HTMLElement | null {
		const target = event.target as HTMLElement | null;
		return target?.closest<HTMLElement>("[data-component-id]") ?? null;
	}

	/**
	 * Builds the nested grid before `render` runs, so the container component
	 * itself only adds the edit-mode empty hint.
	 */
	private renderContainerBody(
		card: HTMLElement,
		body: HTMLElement,
		config: DashboardComponentConfig,
	): void {
		const vars = containerVarsOf(config.options);
		card.addClass("is-container");
		card.style.setProperty("--ioto-dashboard-columns", String(vars.columns));
		card.style.setProperty(
			"--ioto-dashboard-row-height",
			`${vars.rowHeight}px`,
		);
		card.style.setProperty("--ioto-container-gap", `${vars.gap}px`);
		card.style.setProperty("--ioto-container-padding", `${vars.padding}px`);
		card.style.setProperty(
			"--ioto-container-border-width",
			`${vars.borderWidth}px`,
		);
		card.style.setProperty("--ioto-container-radius", `${vars.radius}px`);
		if (vars.borderColor) {
			card.style.setProperty(
				"--ioto-container-border-color",
				vars.borderColor,
			);
		}
		const nested = body.createDiv({
			cls: "ioto-dashboard-grid is-nested",
		});
		nested.setAttr("aria-label", t("CONTAINER_CONTENT_ARIA"));
		this.syncCards(nested, config.children ?? []);
	}

	private statusOf(
		definition: ComponentDefinition,
		query: QueryDefinition | undefined,
		result: MetricResult | undefined,
		dataset: import("../dashboard/dataset/types").Dataset | undefined,
		config: DashboardComponentConfig,
	): { status: ComponentStatus; messageKey?: string; message?: string } {
		if (definition.queryless) return { status: "ready" };
		if (!query) return { status: "error", messageKey: "DASHBOARD_ERROR_CONFIG" };
		if (definition.toDatasetRequest) {
			if (dataset) {
				const empty = definition.isEmptyDataset
					? definition.isEmptyDataset(dataset)
					: dataset.total === 0;
				return empty ? { status: "empty" } : { status: "ready" };
			}
			const key = datasetKey(definition.toDatasetRequest(config, query));
			const error = this.hub?.getDatasetError(key);
			if (error) return { status: "error", message: error };
			if (!this.hub?.isDatasetPending(key)) this.requestAutoRepair(key);
			return { status: "loading" };
		}
		if (result) {
			if (definition.isEmpty(result, config)) return { status: "empty" };
			return { status: "ready" };
		}
		const key = this.metricKeyOf(config);
		const error = this.hub?.getMetricError(key);
		if (error) return { status: "error", message: error };
		if (!this.hub?.isMetricPending(key)) this.requestAutoRepair(key);
		return { status: "loading" };
	}

	/** A key missing from both results and pending means a refresh never ran for it. */
	private requestAutoRepair(key: string): void {
		if (!key || this.autoRepairKeys.has(key)) return;
		this.autoRepairKeys.add(key);
		this.hub?.scheduleRefresh(0);
	}

	private renderCardError(body: HTMLElement, message: string): void {
		body.empty();
		const state = body.createDiv({ cls: "ioto-error-state" });
		state.createSpan({
			text: t("DASHBOARD_REFRESH_FAILED", [message]),
			attr: { title: message },
		});
		const retry = state.createEl("button", {
			cls: "ioto-error-retry",
			text: t("DASHBOARD_RETRY"),
		});
		retry.addEventListener("click", () => this.hub?.refreshNow());
	}

	private renderCardFallback(
		grid: HTMLElement,
		config: DashboardComponentConfig,
		error: unknown,
	): HTMLElement {
		const card = grid.ownerDocument.createElement("div");
		card.addClass("ioto-dashboard-card");
		card.setAttr("data-component-id", config.id);
		const size = clampSize(config.w, config.h, this.boundsFor(config));
		card.style.gridColumn = `span ${size.w}`;
		card.style.gridRow = `span ${size.h}`;
		const header = card.createDiv({ cls: "ioto-dashboard-card-header" });
		header.createDiv({
			cls: "ioto-dashboard-card-title",
			text: config.title ?? config.type,
		});
		const body = card.createDiv({ cls: "ioto-dashboard-card-body" });
		this.renderCardError(
			body,
			error instanceof Error ? error.message : String(error),
		);
		return card;
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
		const parent = page
			? findComponentLocation(page.components, config.id)?.parent
			: null;
		// A child's width cap follows the container columns, not the page.
		const columns = parent
			? containerColumnsOf(parent.options)
			: (page?.columns ?? 12);
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
		const config = page
			? findComponentLocation(page.components, componentId)?.config
			: undefined;
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
		const config = page
			? findComponentLocation(page.components, componentId)?.config
			: undefined;
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
		const location = findComponentLocation(page.components, componentId);
		if (!location) return;
		const from = location.index;
		const to = from + offset;
		if (to < 0 || to >= location.siblings.length) return;
		this.store = await this.plugin.dashboardRepository.moveComponent(
			page.id,
			componentId,
			to,
			location.parent?.id ?? null,
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

	/** 选中操作渲染在工具栏的条件：裸表面组件，或容器。 */
	private selectedToolbarComponent(): DashboardComponentConfig | null {
		const id = this.selectedComponentId;
		const page = this.activePage;
		if (!id || !page) return null;
		const config = findComponentLocation(page.components, id)?.config;
		if (!config) return null;
		return config.type === "container" ||
			cardSurfaceOf(config.options) !== "card"
			? config
			: null;
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
		const selection = this.localSelection();
		if (!this.selectedComponentId && !selection) return;
		this.selectedComponentId = null;
		this.syncSelectionClasses();
		this.inspectorEl?.toggleClass("is-hidden", true);
		this.plugin.inspectorService.clear(this.leafId);
	}

	private syncSelectionState(): void {
		const id = this.selectedComponentId;
		if (id) {
			const page = this.activePage;
			if (page && findComponentLocation(page.components, id)) return;
			this.selectedComponentId = null;
			this.plugin.inspectorService.clear(this.leafId);
			return;
		}
		const selection = this.localSelection();
		if (!selection) return;
		if (selection.kind === "page") {
			const pages = this.activeDashboard?.pages ?? [];
			if (pages.some((page) => page.id === selection.pageId)) return;
			this.plugin.inspectorService.clear(this.leafId);
			return;
		}
		if (selection.kind === "pages") {
			if (this.activeDashboard?.id === selection.dashboardId) return;
			this.plugin.inspectorService.clear(this.leafId);
		}
	}

	private syncSelectionClasses(): void {
		const grid = this.gridEl;
		if (grid) {
			// Includes nested cards; selecting a container never marks its children.
			for (const element of Array.from(
				grid.querySelectorAll<HTMLElement>("[data-component-id]"),
			)) {
				const id = element.dataset.componentId;
				if (!id) continue;
				element.toggleClass("is-selected", id === this.selectedComponentId);
			}
		}
		this.syncToolbar();
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
		const selection = this.localSelection();
		return (
			this.selectedComponentId !== null ||
			selection?.kind === "page" ||
			selection?.kind === "pages"
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
					moveIntoContainer: () =>
						this.controller?.moveIntoContainer(),
					moveOutOfContainer: () =>
						this.controller?.moveOutOfContainer(),
					dissolveContainer: () =>
						this.controller?.dissolveContainer(),
					remove: () => this.controller?.remove(),
					openPageSettings: () => {
						const page = this.activePage;
						if (page) this.openPageSettings(page);
					},
					pickTarget: (picker, key) =>
						this.controller?.pickTarget(picker, key),
					describeTarget: (picker, value) =>
						this.controller?.describeTarget(picker, value) ?? value,
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
					setParent: (parentId) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "page") {
							controller.setPageParent(parentId);
						}
					},
					remove: () => {
						const controller = service.current()?.controller;
						if (controller?.kind === "page") {
							controller.removePage();
						}
					},
				},
				pages: {
					switchTo: (id) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.switchPage(id);
						}
					},
					create: () => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.createPage();
						}
					},
					createSubpage: (id) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.createSubpage(id);
						}
					},
					pickParent: (id) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.pickParent(id);
						}
					},
					setParent: (id, parentId) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.setPageParent(id, parentId);
						}
					},
					duplicate: (id) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.duplicatePage(id);
						}
					},
					rename: (id) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.renamePage(id);
						}
					},
					remove: (id) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.removePage(id);
						}
					},
					move: (id, target, mode) => {
						const controller = service.current()?.controller;
						if (controller?.kind === "pages") {
							controller.movePage(id, target, mode);
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
				: current.selection.kind === "page"
					? this.activePage?.id === current.selection.pageId
					: this.activeDashboard?.id ===
						current.selection.dashboardId);
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
			moveIntoContainer: () => void this.moveSelectedIntoContainer(),
			moveOutOfContainer: () => void this.moveSelectedOutOfContainer(),
			dissolveContainer: () => void this.dissolveSelectedContainer(),
			remove: () => this.confirmRemoveSelected(),
			openPageSettings: () => {
				const page = this.activePage;
				if (page) this.openPageSettings(page);
			},
			pickTarget: (picker, key) => this.pickTargetForComponent(picker, key),
			describeTarget: (picker, value) => this.describeTarget(picker, value),
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
			setPageParent: (parentId) => void this.applyPageParent(pageId, parentId),
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
		const location = findComponentLocation(page.components, id);
		if (!location) return null;
		const config = location.config;
		const bounds = this.boundsFor(config);
		return {
			kind: "component",
			pageName: page.name,
			index: location.index,
			total: location.siblings.length,
			parentId: location.parent?.id ?? null,
			depth: location.depth,
			hasContainers: page.components.some(
				(component) => component.type === "container",
			),
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
		const pages = dashboard.pages;
		const index = pages.findIndex((item) => item.id === pageId);
		if (index < 0) return null;
		const path = pagePath(pages, pageId);
		return {
			kind: "page",
			pageId,
			pageName: page.name,
			dashboardName: dashboard.name,
			index,
			total: pages.length,
			componentCount: page.components.length,
			columns: page.columns === 24 ? 24 : 12,
			rowHeight: page.rowHeight ?? 72,
			canDelete: pages.length - 1 - descendantsOf(pages, pageId).length > 0,
			parentId: page.parentId ?? null,
			parentOptions: pages
				.filter((item) => !item.parentId && item.id !== pageId)
				.map((item) => ({ id: item.id, name: item.name })),
			canSetParent: descendantsOf(pages, pageId).length === 0,
			parentPath:
				path.length > 1
					? path.map((item) => item.name).join(" / ")
					: null,
		};
	}

	private openPagesPanel(): void {
		const dashboard = this.activeDashboard;
		if (!dashboard || !this.editMode) return;
		this.selectedComponentId = null;
		this.syncSelectionClasses();
		this.plugin.inspectorService.select(
			{ kind: "pages", leafId: this.leafId, dashboardId: dashboard.id },
			this.createPagesInspectorController(dashboard.id),
		);
		this.ensureInspectorHost();
	}

	private pagesInspectorTarget(): DashboardPagesInspectorTarget | null {
		const dashboard = this.activeDashboard;
		if (!dashboard) return null;
		const activeId = this.activePage?.id ?? "";
		return {
			kind: "pages",
			dashboardId: dashboard.id,
			dashboardName: dashboard.name,
			activePageId: activeId,
			pages: dashboard.pages.map((page) => ({
				id: page.id,
				name: page.name,
				parentId: page.parentId ?? null,
				componentCount: page.components.length,
				isActive: page.id === activeId,
				canDelete:
					dashboard.pages.length -
						1 -
						descendantsOf(dashboard.pages, page.id).length >
					0,
			})),
		};
	}

	private createPagesInspectorController(
		dashboardId: string,
	): PagesInspectorController {
		const pageById = (id: string) =>
			this.activeDashboard?.pages.find((page) => page.id === id);
		const moveTo = (pageId: string, target: number): void => {
			void (async () => {
				const from = this.pageSiblingsOf(pageId).findIndex(
					(page) => page.id === pageId,
				);
				if (from < 0 || target === from) return;
				this.store = await this.plugin.dashboardRepository.movePage(
					pageId,
					target,
				);
				this.render();
			})();
		};
		return {
			kind: "pages",
			leafId: this.leafId,
			isEditable: () => this.editMode,
			getTarget: () =>
				this.activeDashboard?.id === dashboardId
					? this.pagesInspectorTarget()
					: null,
			switchPage: (pageId) => this.switchPage(pageId),
			createPage: () => void this.createPage(),
			createSubpage: (pageId) =>
				void this.createPageWithParent(pageId),
			setPageParent: (pageId, parentId) =>
				void this.applyPageParent(pageId, parentId),
			pickParent: (pageId) => {
				const page = pageById(pageId);
				if (page) this.pickPageParent(page);
			},
			duplicatePage: (pageId) => {
				const page = pageById(pageId);
				if (page) void this.duplicatePage(page);
			},
			renamePage: (pageId) => {
				const page = pageById(pageId);
				if (page) this.openPageSettings(page, "name");
			},
			removePage: (pageId) => {
				const page = pageById(pageId);
				if (page) this.confirmRemovePage(page);
			},
			movePage: (pageId, target, mode) => {
				if (mode === "index") {
					moveTo(pageId, target);
					return;
				}
				const from = this.pageSiblingsOf(pageId).findIndex(
					(page) => page.id === pageId,
				);
				if (from < 0) return;
				moveTo(pageId, from + target);
			},
		};
	}

	canDuplicateSelected(): boolean {
		const id = this.selectedComponentId;
		const page = this.activePage;
		return Boolean(
			this.editMode &&
				id &&
				page &&
				findComponentLocation(page.components, id),
		);
	}

	async duplicateSelectedComponent(): Promise<void> {
		if (!this.canDuplicateSelected()) return;
		const page = this.activePage;
		const id = this.selectedComponentId;
		if (!page || !id) return;
		const source = findComponentLocation(page.components, id)?.config;
		if (!source) return;
		const suffix = t("DASHBOARD_COMPONENT_COPY_SUFFIX");
		const base = this.componentDisplayName(source);
		const title = base.endsWith(suffix.trim()) ? base : `${base}${suffix}`;
		const result = await this.plugin.dashboardRepository.duplicateComponent(
			page.id,
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

	private pageTargets(excludePageId?: string): PageTarget[] {
		const targets: PageTarget[] = [];
		const others: PageTarget[] = [];
		const currentDashboardId = this.activeDashboard?.id;
		for (const dashboard of this.store?.dashboards ?? []) {
			for (const page of dashboard.pages) {
				if (page.id === excludePageId) continue;
				const entry = { dashboard, page };
				if (dashboard.id === currentDashboardId) targets.push(entry);
				else others.push(entry);
			}
		}
		return [...targets, ...others];
	}

	private pickTargetForComponent(
		picker: TargetPickerKind,
		key: string,
	): void {
		const componentId = this.selectedComponentId;
		if (!componentId) return;
		const apply = (value: string): void => {
			void this.updateComponent(componentId, {
				options: { [key]: value || undefined },
			} as Partial<DashboardComponentConfig>);
		};
		if (picker === "note") {
			new NotePickerModal(this.app, (file) => apply(file.path)).open();
			return;
		}
		if (picker === "command") {
			new CommandPickerModal(this.app, (command) =>
				apply(command.id),
			).open();
			return;
		}
		const targets = this.pageTargets(this.activePage?.id);
		if (targets.length === 0) {
			new Notice(t("PICKER_NO_PAGES_FOUND"));
			return;
		}
		new PagePickerModal(
			this.app,
			targets,
			(target) => apply(target.page.id),
			{ describe: (target) => this.describePagePath(target) },
		).open();
	}

	private async moveSelectedComponent(): Promise<void> {
		const page = this.activePage;
		const id = this.selectedComponentId;
		const location = page && id
			? findComponentLocation(page.components, id)
			: undefined;
		if (!page || !location || !this.store) return;
		if (location.depth > 0) return;
		const config = location.config;
		const targets = this.pageTargets(page.id);
		if (targets.length === 0) {
			new Notice(t("DASHBOARD_MOVE_COMPONENT_FAILED"));
			return;
		}
		new PagePickerModal(
			this.app,
			targets,
			(target) => {
				void this.transferSelectedComponent(config, page.id, target);
			},
			{ describe: (target) => this.describePagePath(target) },
		).open();
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

	private async moveSelectedIntoContainer(): Promise<void> {
		const page = this.activePage;
		const id = this.selectedComponentId;
		if (!page || !id) return;
		const location = findComponentLocation(page.components, id);
		if (!location || location.depth !== 0) return;
		if (location.config.type === "container") return;
		const targets: ContainerTarget[] = page.components
			.filter((component) => component.type === "container")
			.map((component) => ({
				id: component.id,
				label: this.componentDisplayName(component),
			}));
		if (targets.length === 0) return;
		new ContainerPickerModal(this.app, targets, (target) => {
			void this.reparentSelectedComponent(target.id);
		}).open();
	}

	private async moveSelectedOutOfContainer(): Promise<void> {
		await this.reparentSelectedComponent(null);
	}

	private async reparentSelectedComponent(
		targetContainerId: string | null,
	): Promise<void> {
		const page = this.activePage;
		const id = this.selectedComponentId;
		if (!page || !id) return;
		const location = findComponentLocation(page.components, id);
		if (!location) return;
		const name = this.componentDisplayName(location.config);
		const targetConfig =
			targetContainerId === null
				? undefined
				: findComponentLocation(page.components, targetContainerId)?.config;
		const targetName = targetConfig
			? this.componentDisplayName(targetConfig)
			: "";
		const result =
			await this.plugin.dashboardRepository.reparentComponent(
				page.id,
				id,
				targetContainerId,
			);
		if (!result) {
			new Notice(t("DASHBOARD_MOVE_COMPONENT_FAILED"));
			return;
		}
		this.store = result;
		this.render();
		this.selectComponent(id);
		new Notice(
			targetContainerId === null
				? t("DASHBOARD_MOVED_OUT_OF_CONTAINER", [name])
				: t("DASHBOARD_MOVED_INTO_CONTAINER", [name, targetName]),
		);
	}

	private async dissolveSelectedContainer(): Promise<void> {
		const page = this.activePage;
		const id = this.selectedComponentId;
		if (!page || !id) return;
		const store = await this.plugin.dashboardRepository.dissolveContainer(
			page.id,
			id,
		);
		if (!store) return;
		this.store = store;
		this.selectedComponentId = null;
		this.plugin.inspectorService.clear(this.leafId);
		this.render();
	}

	private confirmRemoveSelected(): void {
		const id = this.selectedComponentId;
		if (!id) return;
		this.confirmRemove(id);
	}

	private confirmRemove(componentId: string): void {
		const page = this.activePage;
		const config = page
			? findComponentLocation(page.components, componentId)?.config
			: undefined;
		const count = config?.children?.length ?? 0;
		const message =
			count > 0
				? t("DASHBOARD_CONTAINER_REMOVE_CONFIRM", [String(count)])
				: t("INSPECTOR_REMOVE_CONFIRM");
		new ConfirmModal(this.app, t("INSPECTOR_TITLE"), message, () =>
			void this.removeComponent(componentId),
		).open();
	}

	private async removeComponent(componentId: string): Promise<void> {
		const page = this.activePage;
		if (!page) return;
		const target = findComponentLocation(page.components, componentId);
		const selected = this.selectedComponentId;
		const selectedRemoved =
			selected !== null &&
			(selected === componentId ||
				(target !== null &&
					containsComponent(target.config, selected)));
		this.store = await this.plugin.dashboardRepository.removeComponent(
			page.id,
			componentId,
		);
		if (selectedRemoved) {
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
		const handle = event.currentTarget as HTMLElement | null;
		if (!handle) return;
		const win = card.ownerDocument.defaultView ?? window;
		armPointerDrag(handle, event, {
			onActivate: (startEvent) =>
				this.startDragSession(
					grid,
					card,
					componentId,
					handle,
					startEvent,
					win,
				),
		});
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

		bindPointerSession(handle, startEvent.pointerId, {			onMove: (moveEvent) => {
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
		const location = findComponentLocation(page.components, componentId);
		const fromIndex = location?.index ?? -1;
		const parentId = location?.parent?.id ?? null;
		const changed =
			toIndex >= 0 && fromIndex >= 0 && toIndex !== fromIndex;
		if (changed) {
			this.store = await this.plugin.dashboardRepository.moveComponent(
				pageId,
				componentId,
				toIndex,
				parentId,
			);
		}
		const rendered = this.endInteraction();
		if (changed && !rendered) this.render();
	}

	private readGridMetrics(grid: HTMLElement): GridMetrics {
		let gap = 12;
		let rowHeight = 72;
		let columns = this.activePage?.columns === 24 ? 24 : 12;
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
			// Nested grids inherit their own column count from the container card.
			const parsedColumns = Number.parseInt(
				style.getPropertyValue("--ioto-dashboard-columns"),
				10,
			);
			if (Number.isFinite(parsedColumns) && parsedColumns > 0) {
				columns = parsedColumns;
			}
		}
		return gridMetrics(grid.clientWidth, columns, gap, rowHeight);
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
		bindPointerSession(handle, event.pointerId, {
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
				for (const location of walkComponents(page.components)) {
					const config = location.config;
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
				for (const location of walkComponents(page.components)) {
					const config = location.config;
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
					let queryId = "";
					if (!definition.queryless) {
						const preferred = queries.get(definition.defaultQueryId);
						const targets = queryTargetsFor(definition);
						const target = targets[0] ?? "task";
						const objectQuery = queries.defaultFor(target);
						queryId =
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

	private async openNote(
		path: string,
		line?: number,
		newTab = false,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
		await leaf.openFile(file, { eState: { line: line ?? 0 } });
	}

	private openPageById(pageId: string): void {
		const target = this.store
			? findDashboardForPage(this.store, pageId)
			: undefined;
		if (!target) {
			new Notice(t("BUTTON_PAGE_MISSING"));
			return;
		}
		if (target.id === this.activeDashboard?.id) {
			this.switchPage(pageId);
			return;
		}
		void this.plugin.activateCustomDashboard(target.id, { pageId });
	}

	private describeTarget(picker: TargetPickerKind, value: string): string {
		const stored = value.trim();
		if (!stored) return "";
		if (picker === "note") {
			return stored.split("/").pop()?.replace(/\.md$/i, "") || stored;
		}
		if (picker === "command") {
			return (
				this.app.commands
					.listCommands()
					.find((command) => command.id === stored)?.name ?? stored
			);
		}
		const dashboard = this.store
			? findDashboardForPage(this.store, stored)
			: undefined;
		const page = dashboard?.pages.find((item) => item.id === stored);
		return dashboard && page ? `${dashboard.name} / ${page.name}` : stored;
	}

	private async openVaultTarget(
		path: string,
		line: number | undefined,
		newTab: boolean,
	): Promise<void> {		if (!path) return;
		let node: TAbstractFile | null =
			this.app.vault.getAbstractFileByPath(path);

		// 兜底：单元格里若不是绝对路径（如 [[笔记]] 文本），按链接解析
		if (!node) {
			node = this.app.metadataCache.getFirstLinkpathDest(path, "");
		}

		// 文件夹必须先于文件判定，否则会走 openFile 失败
		if (node instanceof TFolder) {
			this.openFolderContents(node.path);
			return;
		}
		if (node instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
			await leaf.openFile(node, { eState: { line: line ?? 0 } });
			return;
		}
		new Notice(t("TABLE_LINK_MISSING", [path]));
	}

	private openFolderContents(path: string): void {
		new FolderContentsModal(this.app, {
			rootPath: path,
			openFile: (filePath) => void this.openNote(filePath, undefined, true),
			reveal: (target) => void this.revealInExplorer(target),
		}).open();
	}

	private openChartBucket(payload: ChartBucketPayload): void {
		new ChartBucketModal(this.app, {
			payload,
			openTask: (path, line, newTab) =>
				void this.openVaultTarget(path, line, newTab ?? true),
			reveal: (path) => void this.revealInExplorer(path),
		}).open();
	}

	private openProjectTasks(
		group: ProjectProgressGroup,
		ratioBase: string,
	): void {
		const hasFolder = group.folder.length > 0;
		const notePath = hasFolder ? `${group.folder}/_project.md` : "";
		new ProjectTasksModal(this.app, {
			group,
			ratioBase,
			projectNotePath: notePath,
			projectNoteExists:
				hasFolder &&
				this.app.vault.getAbstractFileByPath(notePath) instanceof TFile,
			revealable: hasFolder,
			openTask: (path, line, newTab) => void this.openNote(path, line, newTab),
			reveal: (path) => void this.revealInExplorer(path),
		}).open();
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

	/**
	 * Renders free-form Markdown at vault root; the container keeps a single
	 * delegated listener so links rendered asynchronously are still handled.
	 */
	private async renderMarkdownFragment(
		el: HTMLElement,
		markdown: string,
	): Promise<void> {
		el.addClass("markdown-rendered");
		await MarkdownRenderer.render(this.app, markdown, el, "", this);
		this.delegateMarkdownLinks(el);
	}

	private delegateMarkdownLinks(el: HTMLElement): void {
		if (el.dataset.linksBound === "1") return;
		el.dataset.linksBound = "1";
		el.addEventListener("click", (event) => {
			const anchor = (event.target as HTMLElement | null)?.closest("a");
			if (!anchor) return;
			if (anchor.classList.contains("external-link")) {
				// Let Obsidian's global handler open external URLs.
				event.stopPropagation();
				return;
			}
			if (!anchor.classList.contains("internal-link")) return;
			event.preventDefault();
			event.stopPropagation();
			const href = anchor.getAttribute("data-href") ?? "";
			if (!href) return;
			const { path } = parseLinktext(href);
			const file = this.app.metadataCache.getFirstLinkpathDest(path, "");
			const newTab = event.metaKey || event.ctrlKey;
			if (file) void this.openVaultTarget(file.path, undefined, newTab);
			else void this.app.workspace.openLinkText(href, "", newTab);
		});
		el.addEventListener("mouseover", (event) => {
			const anchor = (event.target as HTMLElement | null)?.closest(
				"a.internal-link",
			);
			if (!anchor) return;
			const href = anchor.getAttribute("data-href") ?? "";
			if (!href) return;
			this.app.workspace.trigger("hover-link", {
				event,
				source: CUSTOM_DASHBOARD_VIEW_TYPE,
				hoverParent: el,
				targetEl: anchor,
				linktext: href,
				sourcePath: "",
			});
		});
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
	const componentSignature = (
		components: readonly DashboardComponentConfig[],
	): string =>
		components
			.map((component) =>
				component.children === undefined
					? component.id
					: `${component.id}(${componentSignature(component.children)})`,
			)
			.join(",");
	return store.dashboards
		.map(
			(dashboard) =>
				`${dashboard.id}:${dashboard.name}[${dashboard.pages
					.map(
						(page) =>
							`${page.id}:${page.name}(${componentSignature(
								page.components,
							)})`,
					)
					.join(",")}]`,
		)
		.join("|");
}
