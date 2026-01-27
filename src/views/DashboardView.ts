import {
	ItemView,
	WorkspaceLeaf,
	setIcon,
	TFile,
	TFolder,
	TextComponent,
	DropdownComponent,
	MarkdownView,
	Menu,
	Notice,
} from "obsidian";
import { DASHBOARD_VIEW_TYPE } from "../models/constants";
import IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { SaveQueryModal } from "../ui/SaveQueryModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import { SavedQuery } from "../settings";

type Category = "Input" | "Output" | "Outcome";

interface FilterState {
	name: string;
	project: string;
	dateType: "created" | "modified";
	dateStart: string;
	dateEnd: string;
	datePreset:
		| "all"
		| "last3days"
		| "last7days"
		| "last14days"
		| "last30days"
		| "custom";
	status: "all" | "completed" | "incomplete";
}

interface TaskItem {
	file: TFile;
	content: string;
	status: string;
	line: number;
}

export class DashboardView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Input";
	activeTab: "Notes" | "Tasks" = "Notes";
	activeQueryId: string | null = null;
	leftPanelCollapsed = false;
	rightPanelCollapsed = false;

	// Data
	files: TFile[] = [];
	filteredFiles: TFile[] = [];
	tasks: TaskItem[] = [];
	filteredTasks: TaskItem[] = [];

	// Filters
	filters: FilterState = {
		name: "",
		project: "",
		dateType: "created",
		dateStart: "",
		dateEnd: "",
		datePreset: "all",
		status: "all",
	};

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;

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
		return "layout-dashboard";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("dashboard-container");

		const grid = container.createDiv({ cls: "dashboard-grid" });
		if (this.leftPanelCollapsed) grid.addClass("usages-collapsed");
		if (this.rightPanelCollapsed) grid.addClass("right-collapsed");

		// Left Column: Navigation
		const leftCol = grid.createDiv({ cls: "dashboard-left" });
		this.renderLeftColumn(leftCol);

		// Middle Column: Content
		this.middleContainer = grid.createDiv({ cls: "dashboard-middle" });

		// Right Column: Filters
		this.rightContainer = grid.createDiv({ cls: "dashboard-right" });

		// Initial Load
		await this.refreshFiles();
		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	async refreshFiles() {
		// 1. Fetch Notes
		let folderPath = "";
		switch (this.activeCategory) {
			case "Input":
				folderPath = this.plugin.settings.inputFolder;
				break;
			case "Output":
				folderPath = this.plugin.settings.outputFolder;
				break;
			case "Outcome":
				folderPath = this.plugin.settings.outcomeFolder;
				break;
		}

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (folder && folder instanceof TFolder) {
			this.files = this.getAllFiles(folder);
		} else {
			this.files = [];
		}

		// 2. Fetch Tasks
		await this.fetchTasks();

		// 3. Apply Filters
		this.applyFilters();
	}

	getAllFiles(folder: TFolder): TFile[] {
		let files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				if (child.extension === "md") {
					files.push(child);
				}
			} else if (child instanceof TFolder) {
				files.push(...this.getAllFiles(child));
			}
		}
		return files;
	}

	getAllProjects(): string[] {
		const projects = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];
			if (project) {
				projects.add(String(project));
			}
		}
		return Array.from(projects).sort();
	}

	async fetchTasks() {
		this.tasks = [];
		const taskFolderPath = this.plugin.settings.taskFolder;
		const taskFolder = this.app.vault.getAbstractFileByPath(taskFolderPath);

		if (!taskFolder || !(taskFolder instanceof TFolder)) {
			return;
		}

		const files = this.getAllFiles(taskFolder);
		const targetHeader = this.getTargetHeader(this.activeCategory);

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.headings) continue;

			const headings = cache.headings;

			console.dir(headings);
			console.dir(targetHeader);

			// Find the target header
			const headingIndex = headings.findIndex(
				(h) => h.heading === targetHeader,
			);
			console.dir(headingIndex);
			if (headingIndex === -1) continue;

			const targetHeading = headings[headingIndex];
			if (!targetHeading) continue;

			const startLine = targetHeading.position.start.line;

			// Find end line
			let endLine = Infinity;
			for (let i = headingIndex + 1; i < headings.length; i++) {
				const h = headings[i];
				if (!h) continue;
				if (h.level <= targetHeading.level) {
					endLine = h.position.start.line;
					break;
				}
			}

			// Get list items in range
			if (!cache.listItems) continue;
			const relevantItems = cache.listItems.filter(
				(item) =>
					item.position.start.line > startLine &&
					item.position.start.line < endLine &&
					item.task !== undefined,
			);

			if (relevantItems.length > 0) {
				// Read file content
				const content = await this.app.vault.read(file);
				const lines = content.split("\n");

				for (const item of relevantItems) {
					let text = lines[item.position.start.line];
					if (text === undefined) continue;

					// Strip checkbox pattern like "- [ ] " or "* [x] "
					text = text.replace(/^(\s*)[-*+]\s*\[.\]\s*/, "");

					if (!text.trim()) continue;

					this.tasks.push({
						file: file,
						content: text,
						status: item.task!,
						line: item.position.start.line,
					});
				}
			}
		}
	}

	getTargetHeader(category: Category): string {
		switch (category) {
			case "Input":
				return "输入 LEARN";
			case "Output":
				return "输出 THINK";
			case "Outcome":
				return "成果 DO";
		}
	}

	applyFilters() {
		// Filter Files
		this.filteredFiles = this.files.filter((file) => {
			return this.matchesFilter(file, file.basename);
		});
		this.filteredFiles.sort((a, b) => b.stat.ctime - a.stat.ctime);

		// Filter Tasks
		this.filteredTasks = this.tasks.filter((task) => {
			if (!this.matchesFilter(task.file, task.content)) return false;

			// Status Filter
			if (this.filters.status !== "all") {
				const isCompleted = task.status !== " ";
				if (this.filters.status === "completed" && !isCompleted)
					return false;
				if (this.filters.status === "incomplete" && isCompleted)
					return false;
			}

			return true;
		});
		// Sort tasks? Maybe by file creation date?
		this.filteredTasks.sort(
			(a, b) => b.file.stat.ctime - a.file.stat.ctime,
		);
	}

	matchesFilter(file: TFile, textContent: string): boolean {
		// 1. Name Filter (applies to File Name or Task Content)
		if (
			this.filters.name &&
			!textContent.toLowerCase().includes(this.filters.name.toLowerCase())
		) {
			return false;
		}

		// 2. Project Filter
		if (this.filters.project) {
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];
			if (
				!project ||
				!String(project)
					.toLowerCase()
					.includes(this.filters.project.toLowerCase())
			) {
				return false;
			}
		}

		// 3. Date Filter
		const dateValue =
			this.filters.dateType === "created"
				? file.stat.ctime
				: file.stat.mtime;
		const date = new Date(dateValue);

		if (
			this.filters.datePreset !== "all" &&
			this.filters.datePreset !== "custom"
		) {
			const now = new Date();
			let days = 0;
			if (this.filters.datePreset === "last3days") days = 3;
			else if (this.filters.datePreset === "last7days") days = 7;
			else if (this.filters.datePreset === "last14days") days = 14;
			else if (this.filters.datePreset === "last30days") days = 30;

			const startDate = new Date();
			startDate.setDate(now.getDate() - days);
			startDate.setHours(0, 0, 0, 0);

			if (date < startDate) return false;
		} else if (this.filters.datePreset === "custom") {
			if (this.filters.dateStart) {
				const startDate = new Date(this.filters.dateStart);
				if (date < startDate) return false;
			}

			if (this.filters.dateEnd) {
				const endDate = new Date(this.filters.dateEnd);
				endDate.setHours(23, 59, 59, 999);
				if (date > endDate) return false;
			}
		}

		return true;
	}

	renderLeftColumn(container: HTMLElement) {
		container.empty();

		const header = container.createDiv({ cls: "nav-header" });
		if (!this.leftPanelCollapsed) {
			header.createEl("h3", { text: t("NAV_TITLE") });
		}

		// const toggle = header.createEl("button", { cls: "nav-toggle" });
		// setIcon(
		// 	toggle,
		// 	this.leftPanelCollapsed ? "chevrons-right" : "chevrons-left",
		// );
		// toggle.onclick = () => {
		// 	this.leftPanelCollapsed = !this.leftPanelCollapsed;
		// 	const grid = container.closest(".dashboard-grid");
		// 	if (grid) {
		// 		if (this.leftPanelCollapsed) grid.addClass("usages-collapsed");
		// 		else grid.removeClass("usages-collapsed");
		// 	}
		// 	this.renderLeftColumn(container);
		// };

		const navItems: Category[] = ["Input", "Output", "Outcome"];
		const list = container.createEl("ul", { cls: "nav-list" });

		navItems.forEach((item) => {
			let label = "";
			if (item === "Input") label = t("NAV_INPUT");
			else if (item === "Output") label = t("NAV_OUTPUT");
			else if (item === "Outcome") label = t("NAV_OUTCOME");

			const li = list.createEl("li", {
				text: this.leftPanelCollapsed ? label.charAt(0) : label,
				cls: "nav-item",
			});
			if (item === this.activeCategory && !this.activeQueryId)
				li.addClass("is-active");

			li.onclick = async () => {
				this.activeCategory = item;
				this.activeQueryId = null; // Reset active query when switching main category
				container
					.findAll(".nav-item")
					.forEach((el) => el.removeClass("is-active"));
				li.addClass("is-active");

				await this.refreshFiles();
				this.renderMiddleColumn();
				this.renderRightColumn();
			};
		});

		// Saved Queries
		if (this.plugin.settings.savedQueries.length > 0) {
			const divider = container.createDiv({ cls: "nav-divider" });
			divider.style.borderTop =
				"1px solid var(--background-modifier-border)";
			divider.style.margin = "10px 0";

			const queryHeader = container.createDiv({ cls: "nav-header" });
			if (!this.leftPanelCollapsed) {
				queryHeader.createEl("h3", { text: t("NAV_USER_QUERIES") });
			}

			const queryList = container.createEl("ul", { cls: "nav-list" });
			this.plugin.settings.savedQueries.forEach((query) => {
				const li = queryList.createEl("li", {
					text: this.leftPanelCollapsed
						? query.name.charAt(0)
						: query.name,
					cls: "nav-item",
				});
				if (this.activeQueryId === query.id) li.addClass("is-active");
				// Add a tooltip if collapsed
				if (this.leftPanelCollapsed) {
					li.setAttribute("aria-label", query.name);
				}

				li.onclick = async () => {
					this.loadSavedQuery(query);
				};
			});
		}
	}

	async loadSavedQuery(query: SavedQuery) {
		this.activeQueryId = query.id;
		this.activeCategory = query.category;
		this.activeTab = query.tab;
		// Clone filters to avoid reference issues
		this.filters = JSON.parse(JSON.stringify(query.filters));

		await this.refreshFiles();
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	renderMiddleColumn() {
		this.middleContainer.empty();

		// Header
		const header = this.middleContainer.createDiv({
			cls: "content-header",
		});
		header.style.display = "flex";
		header.style.justifyContent = "space-between";
		header.style.alignItems = "center";

		const count =
			this.activeTab === "Notes"
				? this.filteredFiles.length
				: this.filteredTasks.length;

		const title = header.createEl("h2", {
			text: `${this.activeCategory} (${count})`,
			cls: "view-header-title",
		});
		title.style.margin = "0";

		// Query Actions
		if (this.activeQueryId) {
			const actionsDiv = header.createDiv({ cls: "header-actions" });
			actionsDiv.style.display = "flex";
			actionsDiv.style.alignItems = "center";
			actionsDiv.style.paddingBottom = "10px";

			const editBtn = actionsDiv.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(editBtn, "pencil");
			editBtn.setAttribute("aria-label", t("BTN_EDIT_QUERY"));
			editBtn.onclick = () => {
				this.renameSavedQuery(this.activeQueryId!);
			};

			const deleteBtn = actionsDiv.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(deleteBtn, "trash");
			deleteBtn.setAttribute("aria-label", t("BTN_DELETE_QUERY"));
			deleteBtn.style.marginLeft = "8px";
			deleteBtn.onclick = () => {
				new ConfirmModal(
					this.app,
					t("CONFIRM_DELETE_TITLE"),
					t("CONFIRM_DELETE_MSG"),
					async () => {
						await this.deleteSavedQuery(this.activeQueryId!);
					},
				).open();
			};
		}

		// Tabs
		const tabs = this.middleContainer.createDiv({ cls: "content-tabs" });
		const notesTab = tabs.createDiv({
			cls: "content-tab",
			text: t("TAB_NOTES"),
		});
		const tasksTab = tabs.createDiv({
			cls: "content-tab",
			text: t("TAB_TASKS"),
		});

		if (this.activeTab === "Notes") notesTab.addClass("is-active");
		else tasksTab.addClass("is-active");

		notesTab.onclick = () => {
			this.activeTab = "Notes";
			this.renderMiddleColumn();
			this.renderRightColumn();
		};
		tasksTab.onclick = () => {
			this.activeTab = "Tasks";
			this.renderMiddleColumn();
			this.renderRightColumn();
		};

		// List
		const list = this.middleContainer.createDiv({ cls: "file-list" });

		if (this.activeTab === "Notes") {
			this.renderNoteList(list);
		} else {
			this.renderTaskList(list);
		}
	}

	renderNoteList(container: HTMLElement) {
		if (this.filteredFiles.length === 0) {
			container.createEl("p", { text: t("NO_NOTES_FOUND") });
			return;
		}

		this.filteredFiles.forEach((file) => {
			const item = container.createDiv({ cls: "file-item" });
			item.createEl("h4", { text: file.basename });

			const meta = item.createDiv({ cls: "file-meta" });
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];

			if (project) {
				meta.createEl("span", {
					text: `📂 ${project}`,
					cls: "file-project",
				});
			}

			const date = new Date(file.stat.ctime).toLocaleDateString();
			meta.createEl("span", { text: `📅 ${date}`, cls: "file-date" });

			item.onclick = () => {
				this.app.workspace.getLeaf(false).openFile(file);
			};
		});
	}

	renderTaskList(container: HTMLElement) {
		if (this.filteredTasks.length === 0) {
			container.createEl("p", { text: t("NO_TASKS_FOUND") });
			return;
		}

		this.filteredTasks.forEach((task) => {
			const item = container.createDiv({ cls: "task-item" });

			const header = item.createDiv({ cls: "task-item-header" });
			header.createEl("span", { text: task.file.basename });
			const date = new Date(task.file.stat.ctime).toLocaleDateString();
			header.createEl("span", { text: date });

			const content = item.createDiv({ cls: "task-content" });
			const checkbox = content.createEl("input", {
				type: "checkbox",
				cls: "task-checkbox",
			});
			checkbox.checked = task.status !== " ";

			content.createEl("span", { text: task.content });

			item.onclick = (e) => {
				// Prevent triggering if clicking checkbox directly (though it's pointer-events: none currently)
				this.app.workspace.getLeaf(false).openFile(task.file, {
					eState: { line: task.line },
				});
			};
		});
	}

	renderRightColumn() {
		this.rightContainer.empty();
		this.rightContainer.createEl("h3", { text: t("FILTER_TITLE") });

		const form = this.rightContainer.createDiv({ cls: "filter-form" });

		// Name Filter
		const nameDiv = form.createDiv({ cls: "filter-item" });
		nameDiv.createEl("label", {
			text:
				this.activeTab === "Notes"
					? t("FILTER_NAME_LABEL_NOTES")
					: t("FILTER_NAME_LABEL_TASKS"),
		});
		new TextComponent(nameDiv)
			.setValue(this.filters.name)
			.setPlaceholder(t("FILTER_NAME_PLACEHOLDER"))
			.onChange((val) => {
				this.filters.name = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});

		// Status Filter (Only for Tasks)
		if (this.activeTab === "Tasks") {
			const statusDiv = form.createDiv({ cls: "filter-item" });
			statusDiv.createEl("label", { text: t("FILTER_STATUS_LABEL") });
			new DropdownComponent(statusDiv)
				.addOption("all", t("FILTER_STATUS_ALL"))
				.addOption("completed", t("FILTER_STATUS_COMPLETED"))
				.addOption("incomplete", t("FILTER_STATUS_INCOMPLETE"))
				.setValue(this.filters.status)
				.onChange((val: "all" | "completed" | "incomplete") => {
					this.filters.status = val;
					this.applyFilters();
					this.renderMiddleColumn();
				});
		}

		// Project Filter
		const projectDiv = form.createDiv({ cls: "filter-item" });
		projectDiv.createEl("label", { text: t("FILTER_PROJECT_LABEL") });

		const allProjects = this.getAllProjects();
		const dataListId = "project-list-" + Date.now();
		const dataList = projectDiv.createEl("datalist", {
			attr: { id: dataListId },
		});
		allProjects.forEach((p) => {
			dataList.createEl("option", { attr: { value: p } });
		});

		const projectInput = new TextComponent(projectDiv)
			.setValue(this.filters.project)
			.setPlaceholder(t("FILTER_PROJECT_PLACEHOLDER"))
			.onChange((val) => {
				this.filters.project = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});
		projectInput.inputEl.setAttribute("list", dataListId);

		// Date Type
		const dateTypeDiv = form.createDiv({ cls: "filter-item" });
		dateTypeDiv.createEl("label", { text: t("FILTER_DATE_TYPE_LABEL") });
		new DropdownComponent(dateTypeDiv)
			.addOption("created", t("FILTER_DATE_TYPE_CREATED"))
			.addOption("modified", t("FILTER_DATE_TYPE_MODIFIED"))
			.setValue(this.filters.dateType)
			.onChange((val: "created" | "modified") => {
				this.filters.dateType = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});

		// Date Preset
		const datePresetDiv = form.createDiv({ cls: "filter-item" });
		datePresetDiv.createEl("label", {
			text: t("FILTER_DATE_PRESET_LABEL"),
		});
		new DropdownComponent(datePresetDiv)
			.addOption("all", t("FILTER_DATE_PRESET_ALL"))
			.addOption("last3days", t("FILTER_DATE_PRESET_LAST_3_DAYS"))
			.addOption("last7days", t("FILTER_DATE_PRESET_LAST_7_DAYS"))
			.addOption("last14days", t("FILTER_DATE_PRESET_LAST_14_DAYS"))
			.addOption("last30days", t("FILTER_DATE_PRESET_LAST_30_DAYS"))
			.addOption("custom", t("FILTER_DATE_PRESET_CUSTOM"))
			.setValue(this.filters.datePreset)
			.onChange(
				(
					val:
						| "all"
						| "last3days"
						| "last7days"
						| "last14days"
						| "last30days"
						| "custom",
				) => {
					this.filters.datePreset = val;
					this.applyFilters();
					this.renderMiddleColumn();
					this.renderRightColumn(); // Re-render to show/hide custom dates
				},
			);

		// Date Start & End (Only if Custom)
		if (this.filters.datePreset === "custom") {
			const dateStartDiv = form.createDiv({ cls: "filter-item" });
			dateStartDiv.createEl("label", {
				text: t("FILTER_DATE_START_LABEL"),
			});
			const dateStartInput = dateStartDiv.createEl("input", {
				type: "date",
			});
			dateStartInput.value = this.filters.dateStart;
			dateStartInput.onchange = (e) => {
				this.filters.dateStart = (e.target as HTMLInputElement).value;
				this.applyFilters();
				this.renderMiddleColumn();
			};

			const dateEndDiv = form.createDiv({ cls: "filter-item" });
			dateEndDiv.createEl("label", { text: t("FILTER_DATE_END_LABEL") });
			const dateEndInput = dateEndDiv.createEl("input", { type: "date" });
			dateEndInput.value = this.filters.dateEnd;
			dateEndInput.onchange = (e) => {
				this.filters.dateEnd = (e.target as HTMLInputElement).value;
				this.applyFilters();
				this.renderMiddleColumn();
			};
		}

		// Reset Button
		const btnDiv = form.createDiv({ cls: "filter-actions" });
		btnDiv.style.display = "flex";
		btnDiv.style.gap = "10px";

		const resetBtn = btnDiv.createEl("button", {
			text: t("FILTER_RESET_BTN"),
		});
		resetBtn.style.flex = "1";
		resetBtn.onclick = () => {
			this.filters = {
				name: "",
				project: "",
				dateType: "created",
				dateStart: "",
				dateEnd: "",
				datePreset: "all",
				status: "all",
			};
			this.activeQueryId = null;
			this.applyFilters();
			this.renderMiddleColumn();
			this.renderRightColumn();
			this.renderLeftColumn(
				this.contentEl.querySelector(".dashboard-left") as HTMLElement,
			);
		};

		if (this.activeQueryId) {
			const updateBtn = btnDiv.createEl("button", {
				text: t("BTN_UPDATE_QUERY"),
				cls: "mod-cta",
			});
			updateBtn.style.flex = "1";
			updateBtn.onclick = async () => {
				await this.updateSavedQuery(this.activeQueryId!);
			};
		} else {
			const saveBtn = btnDiv.createEl("button", {
				text: t("BTN_SAVE_QUERY"),
				cls: "mod-cta",
			});
			saveBtn.style.flex = "1";
			saveBtn.onclick = () => {
				new SaveQueryModal(
					this.app,
					t("MODAL_SAVE_TITLE"),
					"",
					async (name) => {
						await this.saveCurrentQuery(name);
					},
				).open();
			};
		}
	}

	async saveCurrentQuery(name: string) {
		const newQuery: SavedQuery = {
			id: Date.now().toString(),
			name,
			category: this.activeCategory,
			tab: this.activeTab,
			filters: JSON.parse(JSON.stringify(this.filters)),
		};
		this.plugin.settings.savedQueries.push(newQuery);
		await this.plugin.saveSettings();
		new Notice(`Query "${name}" saved.`);
		this.activeQueryId = newQuery.id;
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	async updateSavedQuery(id: string) {
		const query = this.plugin.settings.savedQueries.find(
			(q) => q.id === id,
		);
		if (!query) return;

		// Update query details
		query.category = this.activeCategory;
		query.tab = this.activeTab;
		query.filters = JSON.parse(JSON.stringify(this.filters));

		await this.plugin.saveSettings();
		new Notice(`Query "${query.name}" updated.`);
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
			async (newName) => {
				query.name = newName;
				await this.plugin.saveSettings();
				this.renderLeftColumn(
					this.contentEl.querySelector(
						".dashboard-left",
					) as HTMLElement,
				);
			},
		).open();
	}

	async deleteSavedQuery(id: string) {
		this.plugin.settings.savedQueries =
			this.plugin.settings.savedQueries.filter((q) => q.id !== id);
		await this.plugin.saveSettings();
		new Notice("Query deleted.");
		if (this.activeQueryId === id) {
			this.activeQueryId = null;
		}
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
	}
}
