import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	Notice,
	debounce,
	ViewStateResult,
} from "obsidian";
import { TASK_VIEW_TYPE } from "../models/constants";
import IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { SaveQueryModal } from "../ui/SaveQueryModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import { SavedQuery } from "../settings";
import {
	Category,
	FilterState,
	SortOption,
	SortOrder,
	GroupOption,
	TaskViewState,
} from "../models/types";
import type {
	NoteFacets,
	TaskRecord,
} from "../data/types";
import { DEFAULT_TASK_SCOPE } from "../data/types";
import { collectFacets } from "../data/note-source";
import { queryTasks } from "../data/task-query";
import { sortTasks } from "../data/sort";
import {
	createDefaultFilterState,
	savedQueryToFilterState,
} from "../data/saved-query-adapter";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { MiddleSection } from "./components/MiddleSection";

export class TaskView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Tasks";
	activeTab: "Notes" | "Tasks" = "Tasks";
	activeQueryId: string | null = null;
	sortOption: SortOption = "modified";
	sortOrder: SortOrder = "desc";
	groupOption: GroupOption = "type";
	leftPanelCollapsed = false;
	rightPanelCollapsed = false;
	isZenMode = false;
	isQuickSearchVisible = false;

	// Data (consumed from VaultIndex only)
	tasks: TaskRecord[] = [];
	filteredTasks: TaskRecord[] = [];
	facets: NoteFacets = { projects: [], statuses: [], subjects: [] };

	// Pagination
	taskCurrentPage = 1;

	// Filters
	filters: FilterState = createDefaultFilterState();

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;
	middleSection: MiddleSection | null = null;

	requestRefresh = debounce(
		async () => {
			await this.refreshFiles();
			this.renderMiddleColumn();
			this.renderRightColumn();
		},
		500,
		true,
	);

	constructor(leaf: WorkspaceLeaf, plugin: IotoDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return TASK_VIEW_TYPE;
	}

	getDisplayText() {
		return t("NAV_TASKS");
	}

	getIcon() {
		return "check-square";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("ioto-dashboard-view");
		container.setAttr("tabindex", "0");

		const grid = container.createDiv({ cls: "dashboard-grid" });
		if (this.leftPanelCollapsed) grid.addClass("usages-collapsed");
		if (this.rightPanelCollapsed) grid.addClass("right-collapsed");
		if (this.isZenMode) grid.addClass("zen-mode");

		const leftCol = grid.createDiv({ cls: "dashboard-left" });
		this.renderLeftColumn(leftCol);

		this.middleContainer = grid.createDiv({ cls: "dashboard-middle" });
		this.rightContainer = grid.createDiv({ cls: "dashboard-right" });

		await this.refreshFiles();
		this.renderMiddleColumn();
		this.renderRightColumn();

		this.register(this.plugin.index.subscribe(() => this.requestRefresh()));
	}

	async onClose() {
		if (this.middleSection) {
			this.middleSection.unload();
		}
	}

	toggleQuickSearch() {
		this.isQuickSearchVisible = !this.isQuickSearchVisible;
		this.renderMiddleColumn();
	}

	async refreshFiles() {
		const snapshot = await this.plugin.index.getSnapshot();
		this.tasks = snapshot.tasks;
		this.facets = collectFacets(snapshot.notes);
		this.applyFilters();
	}

	applyFilters(resetPage = true) {
		if (resetPage) {
			this.taskCurrentPage = 1;
		}

		this.filteredTasks = sortTasks(
			queryTasks(
				this.tasks,
				this.filters,
				DEFAULT_TASK_SCOPE,
				this.plugin.settings.customFilters,
			),
			this.sortOption,
			this.sortOrder,
		);
	}

	renderLeftColumn(container: HTMLElement) {
		new LeftSidebar(
			container,
			this.activeCategory,
			this.activeQueryId,
			this.leftPanelCollapsed,
			this.plugin.settings.savedQueries.filter((q) => q.type === "Task"),
			(category) => {
				this.activeCategory = category;
				this.activeQueryId = null;
				this.renderLeftColumn(container);
				void this.refreshFiles().then(() => {
					this.renderMiddleColumn();
					this.renderRightColumn();
				});
			},
			(query) => {
				void this.loadSavedQuery(query);
			},
			["Tasks"],
		).render();
	}

	async loadSavedQuery(query: SavedQuery) {
		this.activeQueryId = query.id;
		this.activeCategory = query.category;
		this.activeTab = "Tasks";
		this.filters = savedQueryToFilterState(query);

		await this.refreshFiles();
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
		this.app.workspace.requestSaveLayout();
	}

	renderMiddleColumn() {
		let activeQueryName: string | null = null;
		if (this.activeQueryId) {
			const query = this.plugin.settings.savedQueries.find(
				(q) => q.id === this.activeQueryId,
			);
			if (query) {
				activeQueryName = query.name;
			}
		}

		if (this.middleSection) {
			this.removeChild(this.middleSection);
		}

		const pageSize = this.plugin.settings.pageSize;
		const totalTasks = this.filteredTasks.length;
		const maxTaskPage = Math.max(1, Math.ceil(totalTasks / pageSize));

		if (this.taskCurrentPage > maxTaskPage)
			this.taskCurrentPage = maxTaskPage;

		this.middleSection = new MiddleSection(
			this.app,
			this.middleContainer,
			this.activeCategory,
			"Tasks",
			this.activeQueryId,
			activeQueryName,
			[],
			this.filteredTasks,
			this.isZenMode,
			this.sortOption,
			this.sortOrder,
			this.groupOption,
			() => {
				// Notes tab is not available in TaskView
			},
			(option: SortOption, order: SortOrder) => {
				this.sortOption = option;
				this.sortOrder = order;
				this.applyFilters();
				this.renderMiddleColumn();
			},
			(option: GroupOption) => {
				this.groupOption = option;
				this.renderMiddleColumn();
			},
			(id: string) => {
				void this.renameSavedQuery(id);
			},
			(id: string) => {
				new ConfirmModal(
					this.app,
					t("CONFIRM_DELETE_TITLE"),
					t("CONFIRM_DELETE_MSG"),
					() => {
						void this.deleteSavedQuery(id);
					},
				).open();
			},
			async (task: TaskRecord) => {
				await this.toggleTaskStatus(task);
			},
			async (task: TaskRecord) => {
				await this.deleteTask(task);
			},
			() => {
				this.toggleZenMode();
			},
			this.isQuickSearchVisible,
			this.filters.name,
			(val: string) => {
				this.filters.name = val;
				this.applyFilters(true);
				this.renderMiddleColumn();
				this.renderRightColumn();
			},
			() => {
				this.toggleQuickSearch();
			},
			() => {
				this.toggleQuickSearch();
			},
			{
				currentPage: this.taskCurrentPage,
				totalPages: maxTaskPage,
				totalItems: totalTasks,
				pageSize: pageSize,
				onPageChange: (page: number) => {
					this.taskCurrentPage = page;
					this.renderMiddleColumn();
				},
			},
			true, // hide tabs
			{
				input: this.plugin.settings.inputFolder,
				output: this.plugin.settings.outputFolder,
				outcome: this.plugin.settings.outcomeFolder,
			},
		);
		this.addChild(this.middleSection);
		this.middleSection.render();
	}

	toggleZenMode() {
		this.isZenMode = !this.isZenMode;
		const grid = this.contentEl.querySelector(".dashboard-grid");
		if (grid) {
			if (this.isZenMode) {
				grid.addClass("zen-mode");
			} else {
				grid.removeClass("zen-mode");
			}
		}
		this.renderMiddleColumn();
		this.app.workspace.requestSaveLayout();
	}

	getState() {
		return {
			isZenMode: this.isZenMode,
			activeQueryId: this.activeQueryId,
		};
	}

	async setState(state: unknown, result: ViewStateResult) {
		const s = (state ?? {}) as Partial<TaskViewState>;
		if (typeof s.isZenMode === "boolean") {
			this.isZenMode = s.isZenMode;
			const grid = this.contentEl.querySelector(".dashboard-grid");
			if (grid) {
				if (this.isZenMode) {
					grid.addClass("zen-mode");
				} else {
					grid.removeClass("zen-mode");
				}
			}
		}
		if (s.activeQueryId !== undefined) {
			this.activeQueryId = s.activeQueryId;
		}
		await super.setState(state, result);

		if (this.activeQueryId) {
			const query = this.plugin.settings.savedQueries.find(
				(q) => q.id === this.activeQueryId,
			);
			if (query) {
				this.filters = savedQueryToFilterState(query);
			}
		}

		const leftCol = this.contentEl.querySelector(".dashboard-left");
		if (leftCol) {
			await this.refreshFiles();
			this.renderLeftColumn(leftCol as HTMLElement);
			this.renderMiddleColumn();
			this.renderRightColumn();
		}
	}

	private async resolveFile(task: TaskRecord): Promise<TFile | null> {
		const abstractFile = this.app.vault.getAbstractFileByPath(task.path);
		return abstractFile instanceof TFile ? abstractFile : null;
	}

	async deleteTask(task: TaskRecord) {
		new ConfirmModal(
			this.app,
			t("CONFIRM_DELETE_TASK_TITLE"),
			t("CONFIRM_DELETE_TASK_MSG"),
			() => {
				void (async () => {
					const file = await this.resolveFile(task);
					if (!file) return;
					const content = await this.app.vault.read(file);
					const lines = content.split("\n");

					if (task.line >= lines.length) return;

					lines.splice(task.line, 1);

					await this.app.vault.modify(file, lines.join("\n"));
					new Notice(t("TASK_DELETED"));

					await this.refreshFiles();
					this.renderMiddleColumn();
				})();
			},
		).open();
	}

	async toggleTaskStatus(task: TaskRecord) {
		const file = await this.resolveFile(task);
		if (!file) return;
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		if (task.line >= lines.length) return;

		const lineContent = lines[task.line];
		if (!lineContent) return;

		const taskRegex = /^(\s*[-*]\s*\[)(.)(\]\s*.*)$/;
		const match = lineContent.match(taskRegex);

		if (match) {
			const prefix = match[1];
			const currentStatus = match[2];
			const suffix = match[3];

			const newStatus = currentStatus === " " ? "x" : " ";
			lines[task.line] = `${prefix}${newStatus}${suffix}`;

			await this.app.vault.modify(file, lines.join("\n"));

			task.marker = newStatus === "x" ? "done" : "open";
			task.isCompleted = newStatus === "x";

			this.applyFilters();
			this.renderMiddleColumn();
		}
	}

	renderRightColumn() {
		new RightSidebar(
			this.rightContainer,
			this.filters,
			"Tasks",
			this.activeQueryId,
			this.facets.projects,
			this.facets.statuses,
			this.facets.subjects,
			this.plugin.settings.customFilters,
			(newFilters) => {
				this.filters = newFilters;
				this.applyFilters(false);
				this.renderMiddleColumn();
			},
			() => {
				this.filters = createDefaultFilterState();
				this.activeQueryId = null;
				this.applyFilters(true);
				this.renderMiddleColumn();
				this.renderRightColumn();
				this.renderLeftColumn(
					this.contentEl.querySelector(
						".dashboard-left",
					) as HTMLElement,
				);
				this.app.workspace.requestSaveLayout();
			},
			() => {
				new SaveQueryModal(
					this.app,
					t("MODAL_SAVE_TITLE"),
					"",
					(name) => {
						void this.saveQuery(name);
					},
				).open();
			},
			() => {
				if (this.activeQueryId) {
					void this.updateQuery(this.activeQueryId);
				}
			},
			true, // show task type filter
		).render();
	}

	async saveQuery(name: string) {
		const newQuery: SavedQuery = {
			id: Date.now().toString(),
			name: name,
			category: this.activeCategory,
			tab: "Tasks",
			type: "Task",
			filters: structuredClone(this.filters),
			sortOption: this.sortOption,
			sortOrder: this.sortOrder,
			groupOption: this.groupOption,
		};
		this.plugin.settings.savedQueries.push(newQuery);
		await this.plugin.saveSettings();
		this.activeQueryId = newQuery.id;

		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
		this.app.workspace.requestSaveLayout();
	}

	async updateQuery(id: string) {
		const queryIndex = this.plugin.settings.savedQueries.findIndex(
			(q) => q.id === id,
		);
		if (
			queryIndex !== -1 &&
			this.plugin.settings.savedQueries[queryIndex]
		) {
			const existing = this.plugin.settings.savedQueries[queryIndex];
			this.plugin.settings.savedQueries[queryIndex] = {
				...existing,
				filters: structuredClone(this.filters),
				sortOption: this.sortOption,
				sortOrder: this.sortOrder,
				groupOption: this.groupOption,
			};
			await this.plugin.saveSettings();
			new Notice(t("NOTICE_QUERY_UPDATED"));
		}
	}

	async renameSavedQuery(id: string) {
		const query = this.plugin.settings.savedQueries.find(
			(q) => q.id === id,
		);
		if (!query) return;

		new SaveQueryModal(
			this.app,
			t("MODAL_EDIT_TITLE"),
			query.name,
			(newName) => {
				query.name = newName;
				void this.plugin.saveSettings().then(() => {
					this.renderLeftColumn(
						this.contentEl.querySelector(
							".dashboard-left",
						) as HTMLElement,
					);
					this.renderMiddleColumn();
				});
			},
		).open();
	}

	async deleteSavedQuery(id: string) {
		this.plugin.settings.savedQueries =
			this.plugin.settings.savedQueries.filter((q) => q.id !== id);
		await this.plugin.saveSettings();

		if (this.activeQueryId === id) {
			this.activeQueryId = null;
		}

		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
		this.app.workspace.requestSaveLayout();
	}
}
