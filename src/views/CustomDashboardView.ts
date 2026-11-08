import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { CUSTOM_DASHBOARD_VIEW_TYPE } from "../models/constants";
import type IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { createComponentRegistry } from "../dashboard/components";
import { DataHub } from "../dashboard/data-hub";
import { clampSize, type ComponentDefinition, type ComponentStatus } from "../dashboard/registry";
import { activeDashboard, type DashboardComponentConfig, type DashboardStoreData } from "../dashboard/types";
import { metricKey, type MetricRequest, type MetricResult, type ProjectProgressGroup } from "../metrics/types";
import { QueryRepository } from "../query/repository";
import type { QueryDefinition } from "../query/types";
import { ComponentPickerModal } from "../ui/component-picker";
import { ConfirmModal } from "../ui/ConfirmModal";
import { QueryEditModal, QueryManagerModal } from "../ui/query-editor";

export class CustomDashboardView extends ItemView {
	private store: DashboardStoreData | null = null;
	private hub: DataHub | null = null;
	private registry = createComponentRegistry();
	private editMode = false;
	private damaged = false;
	private unsubscribers: Array<() => void> = [];

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
		await this.loadStore();

		this.hub = new DataHub({
			index: this.plugin.index,
			getQueries: () => this.queryRepository(),
			getIndexConfig: () => this.plugin.getIndexConfig(),
			getCustomFilters: () => this.plugin.settings.customFilters,
			snapshotStore: this.plugin.snapshotStore,
		});
		this.unsubscribers.push(this.hub.subscribe(() => this.render()));
		this.unsubscribers.push(
			this.plugin.index.subscribe(() => this.hub?.scheduleRefresh()),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.updateVisibility()),
		);
		this.registerDomEvent(document, "visibilitychange", () =>
			this.updateVisibility(),
		);
		this.render();
		this.updateVisibility();
	}

	async onClose(): Promise<void> {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.unsubscribers = [];
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

	private get dashboardId(): string {
		const dashboard = this.store ? activeDashboard(this.store) : undefined;
		return dashboard?.id ?? "";
	}

	private render(): void {
		const dashboard = this.store
			? activeDashboard(this.store)
			: undefined;
		this.contentEl.empty();
		this.contentEl.addClass("ioto-custom-dashboard-view");

		const toolbar = this.contentEl.createDiv({ cls: "ioto-dashboard-toolbar" });
		toolbar.createEl("h2", {
			text: dashboard?.name ?? t("CUSTOM_DASHBOARD_TITLE"),
		});
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

		if (this.damaged) {
			this.contentEl.createDiv({
				cls: "ioto-dashboard-banner",
				text: t("DASHBOARD_STORE_DAMAGED"),
			});
		}

		if (!dashboard || dashboard.components.length === 0) {
			this.renderEmptyState();
			this.publishRequests();
			return;
		}

		const grid = this.contentEl.createDiv({ cls: "ioto-dashboard-grid" });
		const queries = this.queryRepository();
		for (const config of dashboard.components) {
			this.renderComponent(grid, config, queries);
		}
		this.publishRequests();
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

	private renderEmptyState(): void {
		const empty = this.contentEl.createDiv({ cls: "ioto-dashboard-empty" });
		empty.createEl("h3", { text: t("DASHBOARD_EMPTY_TITLE") });
		empty.createEl("p", { text: t("DASHBOARD_EMPTY_DESC") });
		const button = empty.createEl("button", {
			text: t("DASHBOARD_ADD_COMPONENT"),
			cls: "mod-cta",
		});
		button.onClickEvent(() => this.openComponentPicker());
	}

	private renderComponent(
		grid: HTMLElement,
		config: DashboardComponentConfig,
		queries: QueryRepository,
	): void {
		const definition = this.registry.get(config.type);
		const query = queries.get(config.queryId);
		const result = this.hub?.getResults().get(this.metricKeyOf(config));
		const card = grid.createDiv({ cls: "ioto-dashboard-card" });
		const size = clampSize(config.w, config.h);
		card.style.gridColumn = `span ${size.w}`;
		card.style.gridRow = `span ${size.h}`;

		const header = card.createDiv({ cls: "ioto-dashboard-card-header" });
		header.createDiv({
			cls: "ioto-dashboard-card-title",
			text:
				config.title ??
				(definition
					? t(definition.labelKey as Parameters<typeof t>[0])
					: config.type),
		});
		if (this.editMode) {
			this.renderCardControls(header, config, queries);
		}

		const body = card.createDiv({ cls: "ioto-dashboard-card-body" });
		if (!definition) {
			this.registry.placeholder(body, config.type);
			return;
		}

		const { status, messageKey } = this.statusOf(definition, query, result);
		if (status === "loading") {
			body.createDiv({ cls: "ioto-loading", text: t("DASHBOARD_LOADING") });
			return;
		}
		if (status === "error") {
			body.createDiv({
				cls: "ioto-error-state",
				text: t(
					(messageKey ?? "DASHBOARD_ERROR_CONFIG") as Parameters<typeof t>[0],
				),
			});
			return;
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

	private renderCardControls(
		header: HTMLElement,
		config: DashboardComponentConfig,
		queries: QueryRepository,
	): void {
		const select = header.createEl("select", {
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

		const basis = header.createEl("select", { cls: "dropdown ioto-card-basis" });
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

		const remove = header.createEl("button", {
			cls: "clickable-icon",
			attr: {
				"aria-label": t("DASHBOARD_CONFIG_REMOVE"),
				title: t("DASHBOARD_CONFIG_REMOVE"),
			},
			text: "×",
		});
		remove.onClickEvent(async () => {
			this.store = await this.plugin.dashboardRepository.removeComponent(
				this.dashboardId,
				config.id,
			);
			this.render();
		});
	}

	private async updateComponent(
		componentId: string,
		patch: Partial<DashboardComponentConfig>,
	): Promise<void> {
		this.store = await this.plugin.dashboardRepository.updateComponent(
			this.dashboardId,
			componentId,
			patch,
		);
		this.render();
	}

	private publishRequests(): void {
		const dashboard = this.store ? activeDashboard(this.store) : undefined;
		if (!dashboard || !this.hub) return;
		const requests: MetricRequest[] = [];
		for (const config of dashboard.components) {
			const definition = this.registry.get(config.type);
			if (!definition) continue;
			requests.push(definition.toMetricRequest(config));
		}
		this.hub.setRequests(requests);
	}

	private metricKeyOf(config: DashboardComponentConfig): string {
		const definition = this.registry.get(config.type);
		if (!definition) return "";
		return metricKey(definition.toMetricRequest(config));
	}

	private openComponentPicker(): void {
		new ComponentPickerModal(this.app, this.registry.list(), (definition) => {
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
				this.store = await this.plugin.dashboardRepository.addComponent(
					this.dashboardId,
					config,
				);
				this.editMode = true;
				this.render();
			})();
		}).open();
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
				onDuplicate: (query) => {
					void (async () => {
						const copy: QueryDefinition = {
							...structuredClone(query),
							id: `user:${Date.now()}`,
							name: `${query.name} copy`,
						};
						delete copy.nameKey;
						this.store = await this.plugin.dashboardRepository.addQuery(copy);
						this.render();
					})();
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
								this.render();
							})();
						},
					).open();
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
