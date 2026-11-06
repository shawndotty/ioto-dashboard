import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	Notice,
	debounce,
	ViewStateResult,
} from "obsidian";
import { DASHBOARD_VIEW_TYPE } from "../models/constants";
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
	DashboardViewState,
} from "../models/types";
import type {
	IoType,
	NoteFacets,
	NoteRecord,
	SectionRole,
	TaskRecord,
	TaskScope,
} from "../data/types";
import { collectFacets } from "../data/note-source";
import { queryNotes } from "../data/note-query";
import { queryTasks } from "../data/task-query";
import { sortNotes, sortTasks } from "../data/sort";
import {
	createDefaultFilterState,
	savedQueryToFilterState,
} from "../data/saved-query-adapter";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { MiddleSection } from "./components/MiddleSection";

function categoryToIoType(category: Category): IoType {
	switch (category) {
		case "Input":
			return "Input";
		case "Output":
			return "Output";
		case "Outcome":
			return "Outcome";
		case "Tasks":
			return "Task";
		default:
			return "Unknown";
	}
}

function categoryToSectionRole(category: Category): SectionRole {
	switch (category) {
		case "Input":
			return "input";
		case "Output":
			return "output";
		case "Outcome":
			return "outcome";
		default:
			return "task";
	}
}

export class DashboardView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Input";
	activeTab: "Notes" | "Tasks" = "Notes";
	activeQueryId: string | null = null;
	sortOption: SortOption = "modified";
	sortOrder: SortOrder = "desc";
	groupOption: GroupOption = "none";
	leftPanelCollapsed = false;
	rightPanelCollapsed = false;
	isZenMode = false;
	isQuickSearchVisible = false;

	// Data (consumed from VaultIndex only)
	files: NoteRecord[] = [];
	filteredFiles: NoteRecord[] = [];
	tasks: TaskRecord[] = [];
	filteredTasks: TaskRecord[] = [];
	facets: NoteFacets = { projects: [], statuses: [], subjects: [] };

	// Pagination
	noteCurrentPage = 1;
	taskCurrentPage = 1;

	// Filters
	filters: FilterState = createDefaultFilterState();

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;
	middleSection: MiddleSection | null = null;

	// Debounced refresh on index change
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
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText() {
		return t("DASHBOARD_TITLE");
	}

	getIcon() {
		return "columns-3";
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
		this.facets = collectFacets(snapshot.notes);
		this.files = snapshot.notes.filter(
			(note) => note.ioType === categoryToIoType(this.activeCategory),
		);
		this.tasks = snapshot.tasks;
		this.applyFilters();
	}

	private taskScope(): TaskScope {
		return {
			folders: "task",
			sections: [categoryToSectionRole(this.activeCategory)],
			includeEmptyText: false,
			includePlaceholders: false,
		};
	}

	applyFilters(resetPage = true) {
		if (resetPage) {
			this.noteCurrentPage = 1;
			this.taskCurrentPage = 1;
		}

		const customFilters = this.plugin.settings.customFilters;
		this.filteredFiles = sortNotes(
			queryNotes(this.files, this.filters, customFilters),
			this.sortOption,
			this.sortOrder,
		);

		const scopedTasks = this.tasks.filter(
			(task) =>
				task.ioType === "Task" &&
				task.sectionRole === categoryToSectionRole(this.activeCategory),
		);
		this.filteredTasks = sortTasks(
			queryTasks(scopedTasks, this.filters, this.taskScope(), customFilters),
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
			this.plugin.settings.savedQueries.filter((q) => q.type === "all"),
			(category) => {
				this.activeCategory = category;
				this.activeQueryId = null;
				this.renderLeftColumn(container);

				void this.refreshFiles().then(() => {
					this.renderMiddleColumn();
					this.renderRightColumn();
					this.app.workspace.requestSaveLayout();
				});
			},
			(query) => {
				void this.loadSavedQuery(query);
			},
		).render();
	}

	async loadSavedQuery(query: SavedQuery) {
		this.activeQueryId = query.id;
		this.activeCategory = query.category;
		this.activeTab = query.tab;
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
		const totalNotes = this.filteredFiles.length;
		const totalTasks = this.filteredTasks.length;

		const maxNotePage = Math.max(1, Math.ceil(totalNotes / pageSize));
		const maxTaskPage = Math.max(1, Math.ceil(totalTasks / pageSize));

		if (this.noteCurrentPage > maxNotePage)
			this.noteCurrentPage = maxNotePage;
		if (this.taskCurrentPage > maxTaskPage)
			this.taskCurrentPage = maxTaskPage;

		this.middleSection = new MiddleSection(
			this.app,
			this.middleContainer,
			this.activeCategory,
			this.activeTab,
			this.activeQueryId,
			activeQueryName,
			this.filteredFiles,
			this.filteredTasks,
			this.isZenMode,
			this.sortOption,
			this.sortOrder,
			this.groupOption,
			(tab: "Notes" | "Tasks") => {
				this.activeTab = tab;
				this.renderMiddleColumn();
				this.renderRightColumn();
				this.app.workspace.requestSaveLayout();
			},
			(option: SortOption, order: SortOrder) => {
				this.sortOption = option;
				this.sortOrder = order;
				this.applyFilters();
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
			},
			(option: GroupOption) => {
				this.groupOption = option;
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
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
				currentPage:
					this.activeTab === "Notes"
						? this.noteCurrentPage
						: this.taskCurrentPage,
				totalPages:
					this.activeTab === "Notes" ? maxNotePage : maxTaskPage,
				totalItems:
					this.activeTab === "Notes" ? totalNotes : totalTasks,
				pageSize: pageSize,
				onPageChange: (page: number) => {
					if (this.activeTab === "Notes") this.noteCurrentPage = page;
					else this.taskCurrentPage = page;
					this.renderMiddleColumn();
				},
			},
			false, // hideTabs
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
			activeCategory: this.activeCategory,
			activeTab: this.activeTab,
			activeQueryId: this.activeQueryId,
			sortOption: this.sortOption,
			sortOrder: this.sortOrder,
			groupOption: this.groupOption,
		};
	}

	async setState(state: unknown, result: ViewStateResult) {
		const s = (state ?? {}) as Partial<DashboardViewState>;
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
		if (s.activeCategory) {
			this.activeCategory = s.activeCategory;
		}
		if (s.activeTab) {
			this.activeTab = s.activeTab;
		}
		if (s.activeQueryId !== undefined) {
			this.activeQueryId = s.activeQueryId;
		}
		if (s.sortOption) {
			this.sortOption = s.sortOption;
		}
		if (s.sortOrder) {
			this.sortOrder = s.sortOrder;
		}
		if (s.groupOption) {
			this.groupOption = s.groupOption;
		}
		await super.setState(state, result);

		if (this.activeQueryId) {
			const query = this.plugin.settings.savedQueries.find(
				(q) => q.id === this.activeQueryId,
			);
			if (query) {
				this.filters = savedQueryToFilterState(query);
				this.activeCategory = query.category;
				this.activeTab = query.tab;
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

			// Immediate local update; the index reconciles on the modify event.
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
			this.activeTab,
			this.activeQueryId,
			this.facets.projects,
			this.facets.statuses,
			this.facets.subjects,
			this.plugin.settings.customFilters,
			(newFilters, shouldReRender) => {
				this.filters = newFilters;
				this.applyFilters();
				this.renderMiddleColumn();
				if (shouldReRender) {
					this.renderRightColumn();
				}
			},
			() => {
				this.filters = createDefaultFilterState();
				this.activeQueryId = null;
				this.applyFilters();
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
						void this.saveCurrentQuery(name);
					},
				).open();
			},
			() => {
				void this.updateSavedQuery(this.activeQueryId!);
			},
		).render();
	}

	async saveCurrentQuery(name: string) {
		const newQuery: SavedQuery = {
			id: Date.now().toString(),
			name,
			category: this.activeCategory,
			tab: this.activeTab,
			type: "all",
			filters: structuredClone(this.filters),
			sortOption: this.sortOption,
			sortOrder: this.sortOrder,
			groupOption: this.groupOption,
		};
		this.plugin.settings.savedQueries.push(newQuery);
		await this.plugin.saveSettings();
		new Notice(t("NOTICE_QUERY_SAVED"));
		this.activeQueryId = newQuery.id;
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
		this.app.workspace.requestSaveLayout();
	}

	async updateSavedQuery(id: string) {
		const query = this.plugin.settings.savedQueries.find(
			(q) => q.id === id,
		);
		if (!query) return;

		query.category = this.activeCategory;
		query.tab = this.activeTab;
		query.filters = structuredClone(this.filters);
		query.sortOption = this.sortOption;
		query.sortOrder = this.sortOrder;
		query.groupOption = this.groupOption;

		await this.plugin.saveSettings();
		new Notice(t("NOTICE_QUERY_UPDATED"));
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
				});
			},
		).open();
	}

	async deleteSavedQuery(id: string) {
		this.plugin.settings.savedQueries =
			this.plugin.settings.savedQueries.filter((q) => q.id !== id);
		await this.plugin.saveSettings();
		new Notice(t("NOTICE_QUERY_DELETED"));
		if (this.activeQueryId === id) {
			this.activeQueryId = null;
		}
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.app.workspace.requestSaveLayout();
	}
}
