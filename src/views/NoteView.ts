import {
	ItemView,
	WorkspaceLeaf,
	debounce,
	Notice,
	ViewStateResult,
} from "obsidian";
import { NOTE_VIEW_TYPE } from "../models/constants";
import IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { SavedQuery } from "../settings";
import {
	Category,
	FilterState,
	SortOption,
	SortOrder,
	GroupOption,
	PaginationInfo,
	NoteViewState,
} from "../models/types";
import type { NoteFacets, NoteRecord } from "../data/types";
import { collectFacets } from "../data/note-source";
import { queryNotes } from "../data/note-query";
import { sortNotes } from "../data/sort";
import {
	createDefaultFilterState,
	savedQueryToFilterState,
} from "../data/saved-query-adapter";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { MiddleSection } from "./components/MiddleSection";
import { SaveQueryModal } from "../ui/SaveQueryModal";
import { ConfirmModal } from "../ui/ConfirmModal";

const IOO_TYPES = ["Input", "Output", "Outcome"];

export class NoteView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Notes";
	activeTab: "Notes" | "Tasks" = "Notes";
	activeQueryId: string | null = null;
	activeQueryName: string | null = null;
	sortOption: SortOption = "modified";
	sortOrder: SortOrder = "desc";
	groupOption: GroupOption = "type";
	leftPanelCollapsed = false;
	rightPanelCollapsed = false;
	isZenMode = false;
	isQuickSearchVisible = false;

	// Data (consumed from VaultIndex only)
	notes: NoteRecord[] = [];
	filteredFiles: NoteRecord[] = [];
	facets: NoteFacets = { projects: [], statuses: [], subjects: [] };

	// Pagination
	pagination: PaginationInfo = {
		currentPage: 1,
		totalItems: 0,
		pageSize: 20,
		totalPages: 0,
		onPageChange: (page: number) => {
			this.pagination.currentPage = page;
			this.renderMiddleColumn();
		},
	};

	// Filters
	filters: FilterState = createDefaultFilterState();

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;
	middleSection: MiddleSection | null = null;
	leftSidebar: LeftSidebar | null = null;
	rightSidebar: RightSidebar | null = null;

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
		return NOTE_VIEW_TYPE;
	}

	getDisplayText() {
		return t("NAV_NOTES");
	}

	getIcon() {
		return "sticky-note";
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
		const s = (state ?? {}) as Partial<NoteViewState>;
		if (typeof s.isZenMode === "boolean") {
			this.isZenMode = s.isZenMode;
			const grid = this.contentEl.querySelector(".dashboard-grid");
			if (grid) {
				if (this.isZenMode) grid.addClass("zen-mode");
				else grid.removeClass("zen-mode");
			}
		}
		if (s.activeCategory) this.activeCategory = s.activeCategory;
		if (s.activeTab) this.activeTab = s.activeTab;
		if (s.activeQueryId !== undefined)
			this.activeQueryId = s.activeQueryId;
		if (s.sortOption) this.sortOption = s.sortOption;
		if (s.sortOrder) this.sortOrder = s.sortOrder;
		if (s.groupOption) this.groupOption = s.groupOption;
		await super.setState(state, result);

		if (this.activeQueryId) {
			const query = this.plugin.settings.savedQueries.find(
				(q) => q.id === this.activeQueryId,
			);
			if (query) {
				this.filters = savedQueryToFilterState(query);
				this.activeQueryName = query.name;
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

	toggleQuickSearch() {
		this.isQuickSearchVisible = !this.isQuickSearchVisible;
		this.renderMiddleColumn();
	}

	async refreshFiles() {
		const snapshot = await this.plugin.index.getSnapshot();
		this.notes = snapshot.notes.filter((note) =>
			IOO_TYPES.includes(note.ioType),
		);
		this.facets = collectFacets(snapshot.notes);
		this.applyFilters(false);
	}

	applyFilters(render = true) {
		this.filteredFiles = sortNotes(
			queryNotes(
				this.notes,
				this.filters,
				this.plugin.settings.customFilters,
			),
			this.sortOption,
			this.sortOrder,
		);

		this.pagination.totalItems = this.filteredFiles.length;
		this.pagination.totalPages = Math.ceil(
			this.pagination.totalItems / this.pagination.pageSize,
		);

		const maxPage = this.pagination.totalPages || 1;
		if (this.pagination.currentPage > maxPage) {
			this.pagination.currentPage = 1;
		}

		if (render) this.renderMiddleColumn();
	}

	renderLeftColumn(container: HTMLElement) {
		this.leftSidebar = new LeftSidebar(
			container,
			this.activeCategory,
			this.activeQueryId,
			this.leftPanelCollapsed,
			this.plugin.settings.savedQueries.filter((q) => q.type === "Note"),
			(category) => {
				if (category === "Notes") {
					this.activeCategory = category;
					this.activeQueryId = null;
					this.activeQueryName = null;
					this.filters = createDefaultFilterState();
					this.applyFilters();
					this.renderLeftColumn(container);
					this.renderRightColumn();
					this.app.workspace.requestSaveLayout();
				}
			},
			(query) => {
				void this.loadSavedQuery(query);
			},
			["Notes"],
		);
		this.leftSidebar.render();
	}

	renderMiddleColumn() {
		if (this.middleSection) {
			this.removeChild(this.middleSection);
		}

		const pageSize = this.plugin.settings.pageSize;
		const totalNotes = this.filteredFiles.length;
		const maxNotePage = Math.max(1, Math.ceil(totalNotes / pageSize));

		if (this.pagination.currentPage > maxNotePage)
			this.pagination.currentPage = maxNotePage;

		this.pagination.pageSize = pageSize;
		this.pagination.totalItems = totalNotes;
		this.pagination.totalPages = maxNotePage;

		this.middleSection = new MiddleSection(
			this.app,
			this.middleContainer,
			this.activeCategory,
			this.activeTab,
			this.activeQueryId,
			this.activeQueryName,
			this.filteredFiles,
			[],
			this.isZenMode,
			this.sortOption,
			this.sortOrder,
			this.groupOption,
			(tab) => {
				this.activeTab = tab;
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
			},
			(option, order) => {
				this.sortOption = option;
				this.sortOrder = order;
				this.applyFilters();
				this.app.workspace.requestSaveLayout();
			},
			(option) => {
				this.groupOption = option;
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
			},
			(id) => {
				const query = this.plugin.settings.savedQueries.find(
					(q) => q.id === id,
				);
				if (!query) return;
				new SaveQueryModal(
					this.app,
					t("MODAL_SAVE_TITLE"),
					query.name,
					(newName) => {
						query.name = newName;
						void this.plugin.saveSettings().then(() => {
							this.activeQueryName = newName;
							this.renderMiddleColumn();
							const leftCol =
								this.contentEl.querySelector(".dashboard-left");
							if (leftCol instanceof HTMLElement)
								this.renderLeftColumn(leftCol);
						});
					},
				).open();
			},
			(id) => {
				void this.deleteSavedQuery(id);
			},
			async () => {},
			async () => {},
			() => {
				this.isZenMode = !this.isZenMode;
				const grid = this.contentEl.querySelector(".dashboard-grid");
				if (grid) {
					if (this.isZenMode) grid.addClass("zen-mode");
					else grid.removeClass("zen-mode");
				}
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
			},
			this.isQuickSearchVisible,
			this.filters.name,
			(val) => {
				this.filters.name = val;
				this.applyFilters(true);
			},
			() => {
				this.isQuickSearchVisible = false;
				this.filters.name = "";
				this.applyFilters(true);
			},
			() => {
				this.toggleQuickSearch();
			},
			this.pagination,
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

	renderRightColumn() {
		this.rightContainer.empty();
		this.rightSidebar = new RightSidebar(
			this.rightContainer,
			this.filters,
			this.activeTab,
			this.activeQueryId,
			this.facets.projects,
			this.facets.statuses,
			this.facets.subjects,
			this.plugin.settings.customFilters,
			(filters) => {
				this.filters = filters;
				this.applyFilters();
			},
			() => {
				this.filters = createDefaultFilterState();
				this.applyFilters();
				this.renderRightColumn();
			},
			() => {
				new SaveQueryModal(
					this.app,
					t("MODAL_SAVE_TITLE"),
					"",
					(name) => {
						const existing = this.plugin.settings.savedQueries.find(
							(q) => q.name === name,
						);
						if (existing) {
							new Notice(t("NOTICE_QUERY_EXISTS"));
							return;
						}

						const newQuery: SavedQuery = {
							id: Date.now().toString(),
							name,
							category: "Notes",
							tab: "Notes",
							type: "Note",
							sortOption: this.sortOption,
							sortOrder: this.sortOrder,
							groupOption: this.groupOption,
							filters: { ...this.filters },
						};
						this.plugin.settings.savedQueries.push(newQuery);
						void this.plugin.saveSettings().then(() => {
							this.loadSavedQuery(newQuery);
							new Notice(t("NOTICE_QUERY_SAVED"));
						});
					},
				).open();
			},
			() => {
				if (!this.activeQueryId) return;
				const queryIndex = this.plugin.settings.savedQueries.findIndex(
					(q) => q.id === this.activeQueryId,
				);
				if (queryIndex !== -1) {
					const existing =
						this.plugin.settings.savedQueries[queryIndex];
					if (!existing) return;
					this.plugin.settings.savedQueries[queryIndex] = {
						...existing,
						sortOption: this.sortOption,
						sortOrder: this.sortOrder,
						groupOption: this.groupOption,
						filters: { ...this.filters },
					};
					void this.plugin.saveSettings().then(() => {
						new Notice(t("NOTICE_QUERY_UPDATED"));
					});
				}
			},
			true, // note type filter
		);
		this.rightSidebar.render();
	}

	loadSavedQuery(query: SavedQuery) {
		this.activeQueryId = query.id;
		this.activeQueryName = query.name;
		this.filters = savedQueryToFilterState(query);

		this.sortOption = query.sortOption;
		this.sortOrder = query.sortOrder;
		this.groupOption = query.groupOption;

		this.applyFilters();
		const leftCol = this.contentEl.querySelector(".dashboard-left");
		if (leftCol instanceof HTMLElement) {
			this.renderLeftColumn(leftCol);
		}
		this.renderRightColumn();
		this.app.workspace.requestSaveLayout();
	}

	async deleteSavedQuery(id: string) {
		new ConfirmModal(
			this.app,
			t("MODAL_DELETE_QUERY_TITLE"),
			t("MODAL_DELETE_QUERY_MESSAGE"),
			() => {
				void (async () => {
					const newQueries = this.plugin.settings.savedQueries.filter(
						(q) => q.id !== id,
					);
					this.plugin.settings.savedQueries = newQueries;
					await this.plugin.saveSettings();

					if (this.activeQueryId === id) {
						this.activeQueryId = null;
						this.activeQueryName = null;
						this.filters = createDefaultFilterState();
						this.applyFilters();
						this.renderRightColumn();
					}

					const leftCol =
						this.contentEl.querySelector(".dashboard-left");
					if (leftCol instanceof HTMLElement) {
						this.renderLeftColumn(leftCol);
					}
					new Notice(t("NOTICE_QUERY_DELETED"));
					this.app.workspace.requestSaveLayout();
				})();
			},
		).open();
	}
}
