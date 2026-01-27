import {
	ItemView,
	WorkspaceLeaf,
	setIcon,
	TFile,
	TFolder,
	TextComponent,
	DropdownComponent,
	MarkdownView,
} from "obsidian";
import { DASHBOARD_VIEW_TYPE } from "../models/constants";
import IotoDashboardPlugin from "../main";

type Category = "Input" | "Output" | "Outcome";

interface FilterState {
	name: string;
	project: string;
	dateType: "created" | "modified";
	dateStart: string;
	dateEnd: string;
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
		return "IOTO Dashboard";
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

		if (this.filters.dateStart) {
			const startDate = new Date(this.filters.dateStart);
			if (date < startDate) return false;
		}

		if (this.filters.dateEnd) {
			const endDate = new Date(this.filters.dateEnd);
			endDate.setHours(23, 59, 59, 999);
			if (date > endDate) return false;
		}

		return true;
	}

	renderLeftColumn(container: HTMLElement) {
		container.empty();

		const header = container.createDiv({ cls: "nav-header" });
		if (!this.leftPanelCollapsed) {
			header.createEl("h3", { text: "Navigation" });
		}

		const toggle = header.createEl("button", { cls: "nav-toggle" });
		setIcon(
			toggle,
			this.leftPanelCollapsed ? "chevrons-right" : "chevrons-left",
		);
		toggle.onclick = () => {
			this.leftPanelCollapsed = !this.leftPanelCollapsed;
			const grid = container.closest(".dashboard-grid");
			if (grid) {
				if (this.leftPanelCollapsed) grid.addClass("usages-collapsed");
				else grid.removeClass("usages-collapsed");
			}
			this.renderLeftColumn(container);
		};

		const navItems: Category[] = ["Input", "Output", "Outcome"];
		const list = container.createEl("ul", { cls: "nav-list" });

		navItems.forEach((item) => {
			const li = list.createEl("li", {
				text: this.leftPanelCollapsed ? item.charAt(0) : item,
				cls: "nav-item",
			});
			if (item === this.activeCategory) li.addClass("is-active");

			li.onclick = async () => {
				this.activeCategory = item;
				container
					.findAll(".nav-item")
					.forEach((el) => el.removeClass("is-active"));
				li.addClass("is-active");

				await this.refreshFiles();
				this.renderMiddleColumn();
				this.renderRightColumn();
			};
		});
	}

	renderMiddleColumn() {
		this.middleContainer.empty();

		// Header
		const header = this.middleContainer.createDiv({
			cls: "content-header",
		});

		const count =
			this.activeTab === "Notes"
				? this.filteredFiles.length
				: this.filteredTasks.length;

		header.createEl("h2", {
			text: `${this.activeCategory} (${count})`,
		});

		// Tabs
		const tabs = this.middleContainer.createDiv({ cls: "content-tabs" });
		const notesTab = tabs.createDiv({ cls: "content-tab", text: "笔记" });
		const tasksTab = tabs.createDiv({ cls: "content-tab", text: "任务" });

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
			container.createEl("p", { text: "No notes found." });
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
			container.createEl("p", { text: "No tasks found." });
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
		this.rightContainer.createEl("h3", { text: "Filters" });

		const form = this.rightContainer.createDiv({ cls: "filter-form" });

		// Name Filter
		const nameDiv = form.createDiv({ cls: "filter-item" });
		nameDiv.createEl("label", {
			text: this.activeTab === "Notes" ? "Note Name" : "Task Content",
		});
		new TextComponent(nameDiv)
			.setValue(this.filters.name)
			.setPlaceholder("Search...")
			.onChange((val) => {
				this.filters.name = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});

		// Status Filter (Only for Tasks)
		if (this.activeTab === "Tasks") {
			const statusDiv = form.createDiv({ cls: "filter-item" });
			statusDiv.createEl("label", { text: "Status" });
			new DropdownComponent(statusDiv)
				.addOption("all", "All")
				.addOption("completed", "Completed")
				.addOption("incomplete", "Incomplete")
				.setValue(this.filters.status)
				.onChange((val: "all" | "completed" | "incomplete") => {
					this.filters.status = val;
					this.applyFilters();
					this.renderMiddleColumn();
				});
		}

		// Project Filter
		const projectDiv = form.createDiv({ cls: "filter-item" });
		projectDiv.createEl("label", { text: "Project" });

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
			.setPlaceholder("Project name...")
			.onChange((val) => {
				this.filters.project = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});
		projectInput.inputEl.setAttribute("list", dataListId);

		// Date Type
		const dateTypeDiv = form.createDiv({ cls: "filter-item" });
		dateTypeDiv.createEl("label", { text: "Date Type" });
		new DropdownComponent(dateTypeDiv)
			.addOption("created", "Created")
			.addOption("modified", "Modified")
			.setValue(this.filters.dateType)
			.onChange((val: "created" | "modified") => {
				this.filters.dateType = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});

		// Date Start
		const dateStartDiv = form.createDiv({ cls: "filter-item" });
		dateStartDiv.createEl("label", { text: "From Date" });
		const dateStartInput = dateStartDiv.createEl("input", { type: "date" });
		dateStartInput.value = this.filters.dateStart;
		dateStartInput.onchange = (e) => {
			this.filters.dateStart = (e.target as HTMLInputElement).value;
			this.applyFilters();
			this.renderMiddleColumn();
		};

		// Date End
		const dateEndDiv = form.createDiv({ cls: "filter-item" });
		dateEndDiv.createEl("label", { text: "To Date" });
		const dateEndInput = dateEndDiv.createEl("input", { type: "date" });
		dateEndInput.value = this.filters.dateEnd;
		dateEndInput.onchange = (e) => {
			this.filters.dateEnd = (e.target as HTMLInputElement).value;
			this.applyFilters();
			this.renderMiddleColumn();
		};

		// Reset Button
		const btnDiv = form.createDiv({ cls: "filter-actions" });
		const resetBtn = btnDiv.createEl("button", { text: "Reset Filters" });
		resetBtn.onclick = () => {
			this.filters = {
				name: "",
				project: "",
				dateType: "created",
				dateStart: "",
				dateEnd: "",
				status: "all",
			};
			this.applyFilters();
			this.renderMiddleColumn();
			this.renderRightColumn();
		};
	}
}
