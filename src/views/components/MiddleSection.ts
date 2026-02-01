import {
	App,
	setIcon,
	TFile,
	MarkdownRenderer,
	Component,
	Menu,
	debounce,
	MarkdownView,
} from "obsidian";
import { t } from "../../lang/helpers";
import {
	Category,
	TaskItem,
	SortOption,
	SortOrder,
	GroupOption,
	PaginationInfo,
} from "../../models/types";
import { DASHBOARD_VIEW_TYPE } from "../../models/constants";

export class MiddleSection extends Component {
	sortOption: SortOption;
	sortOrder: SortOrder;
	groupOption: GroupOption;
	private collapsedGroups: Set<string> = new Set();
	private isComposing = false;

	constructor(
		private app: App,
		private container: HTMLElement,
		private activeCategory: Category,
		private activeTab: "Notes" | "Tasks",
		private activeQueryId: string | null,
		private activeQueryName: string | null,
		private filteredFiles: TFile[],
		private filteredTasks: TaskItem[],
		private isZenMode: boolean,
		sortOption: SortOption,
		sortOrder: SortOrder,
		groupOption: GroupOption,
		private onTabChange: (tab: "Notes" | "Tasks") => void,
		private onSortChange: (option: SortOption, order: SortOrder) => void,
		private onGroupChange: (option: GroupOption) => void,
		private onEditQuery: (id: string) => void,
		private onDeleteQuery: (id: string) => void,
		private onTaskToggle: (task: TaskItem) => Promise<void>,
		private onDeleteTask: (task: TaskItem) => Promise<void>,
		private onToggleZenMode: () => void,
		private isQuickSearchVisible: boolean,
		private searchText: string,
		private onSearch: (val: string) => void,
		private onCloseSearch: () => void,
		private pagination: PaginationInfo,
	) {
		super();
		this.sortOption = sortOption;
		this.sortOrder = sortOrder;
		this.groupOption = groupOption;
	}

	private listContainer: HTMLElement;

	updateData(filteredFiles: TFile[], filteredTasks: TaskItem[]) {
		this.filteredFiles = filteredFiles;
		this.filteredTasks = filteredTasks;
		this.refreshList();
	}

	refreshList() {
		if (!this.listContainer) return;
		this.listContainer.empty();
		if (this.groupOption === "none") {
			if (this.activeTab === "Notes") {
				this.renderNoteList(this.listContainer);
			} else {
				this.renderTaskList(this.listContainer);
			}
		} else {
			if (this.activeTab === "Notes") {
				this.renderGroupedNoteList(this.listContainer);
			} else {
				this.renderGroupedTaskList(this.listContainer);
			}
		}
	}

	render() {
		this.container.empty();

		// Header
		const header = this.container.createDiv({
			cls: "content-header",
		});
		header.style.display = "flex";
		header.style.justifyContent = "space-between";
		header.style.alignItems = "center";

		const count = this.pagination.totalItems;

		let titleText = `${this.activeCategory} (${count})`;
		if (this.activeQueryName) {
			titleText = `${this.activeQueryName} - ${titleText}`;
		}

		const title = header.createEl("h2", {
			text: titleText,
			cls: "view-header-title",
		});
		title.style.margin = "0";

		// Actions
		const actionsDiv = header.createDiv({ cls: "header-actions" });
		actionsDiv.style.display = "flex";
		actionsDiv.style.alignItems = "center";
		actionsDiv.style.paddingBottom = "10px";

		// Zen Mode Button
		const zenBtn = actionsDiv.createEl("button", {
			cls: "clickable-icon",
		});
		setIcon(zenBtn, this.isZenMode ? "minimize-2" : "maximize-2");
		zenBtn.setAttribute(
			"aria-label",
			this.isZenMode ? t("ZEN_MODE_OFF") : t("ZEN_MODE_ON"),
		);
		zenBtn.onclick = () => {
			this.onToggleZenMode();
		};

		// Query Actions
		if (this.activeQueryId) {
			const editBtn = actionsDiv.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(editBtn, "pencil");
			editBtn.setAttribute("aria-label", t("BTN_EDIT_QUERY"));
			editBtn.onclick = () => {
				this.onEditQuery(this.activeQueryId!);
			};

			const deleteBtn = actionsDiv.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(deleteBtn, "trash");
			deleteBtn.setAttribute("aria-label", t("BTN_DELETE_QUERY"));
			deleteBtn.onclick = () => {
				this.onDeleteQuery(this.activeQueryId!);
			};
		}

		// Tabs
		const tabs = this.container.createDiv({ cls: "content-tabs" });
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
			this.onTabChange("Notes");
		};
		tasksTab.onclick = () => {
			this.onTabChange("Tasks");
		};

		// Spacer
		const spacer = tabs.createDiv();
		spacer.style.flex = "1";

		// Sort Button
		const sortBtn = tabs.createEl("button", {
			cls: "clickable-icon",
		});
		sortBtn.setAttribute("aria-label", t("SORT_LABEL"));
		setIcon(sortBtn, "arrow-up-down");
		sortBtn.onclick = (e) => {
			this.showSortMenu(e as MouseEvent);
		};

		// Group Button
		const groupBtn = tabs.createEl("button", {
			cls: "clickable-icon",
		});
		groupBtn.setAttribute("aria-label", t("GROUP_LABEL"));
		setIcon(groupBtn, "layers");
		groupBtn.style.marginLeft = "8px";
		groupBtn.onclick = (e) => {
			this.showGroupMenu(e as MouseEvent);
		};

		// Quick Search
		if (this.isQuickSearchVisible) {
			const searchContainer = this.container.createDiv({
				cls: "dashboard-search-container",
			});
			searchContainer.style.padding = "0 1px 8px 1px";

			const wrapper = searchContainer.createDiv({
				cls: "search-input-wrapper",
			});
			wrapper.style.position = "relative";
			wrapper.style.display = "flex";
			wrapper.style.alignItems = "center";

			const searchIcon = wrapper.createSpan({ cls: "search-icon" });
			setIcon(searchIcon, "search");
			searchIcon.style.position = "absolute";
			searchIcon.style.left = "10px";
			searchIcon.style.color = "var(--text-muted)";
			searchIcon.style.pointerEvents = "none";
			searchIcon.style.display = "flex";

			const searchInput = wrapper.createEl("input", {
				type: "text",
				cls: "dashboard-search-input",
			});
			searchInput.style.width = "100%";
			searchInput.style.paddingLeft = "32px";
			searchInput.style.paddingRight = "32px";
			searchInput.placeholder = t("FILTER_NAME_PLACEHOLDER");
			searchInput.value = this.searchText;

			if (this.searchText) {
				const clearIcon = wrapper.createSpan({
					cls: "search-clear-icon clickable-icon",
				});
				setIcon(clearIcon, "x");
				clearIcon.style.position = "absolute";
				clearIcon.style.right = "10px";
				clearIcon.style.cursor = "pointer";
				clearIcon.style.color = "var(--text-muted)";
				clearIcon.style.display = "flex";

				clearIcon.onclick = () => {
					this.onSearch("");
				};
			}

			// Auto-focus logic
			setTimeout(() => {
				searchInput.focus();
				// Optional: select text? Or just cursor at end?
				// To put cursor at end:
				const len = searchInput.value.length;
				searchInput.setSelectionRange(len, len);
			}, 0);

			searchInput.addEventListener("compositionstart", () => {
				this.isComposing = true;
			});

			searchInput.addEventListener("compositionend", (e) => {
				this.isComposing = false;
				const val = (e.target as HTMLInputElement).value;
				this.onSearch(val);
			});

			const debouncedOnSearch = debounce(
				(val: string) => {
					if (this.isComposing) return;
					this.onSearch(val);
				},
				300,
				true,
			);

			searchInput.oninput = (e) => {
				if (this.isComposing) return;
				const val = (e.target as HTMLInputElement).value;
				debouncedOnSearch(val);
			};

			searchInput.onkeydown = (e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					this.onCloseSearch();
				}
			};
		}

		// List
		this.listContainer = this.container.createDiv({ cls: "file-list" });
		this.refreshList();
		this.renderPagination();
	}

	renderPagination() {
		if (this.pagination.totalPages <= 1) return;

		const paginationContainer = this.container.createDiv({
			cls: "dashboard-pagination",
		});
		paginationContainer.style.display = "flex";
		paginationContainer.style.justifyContent = "center";
		paginationContainer.style.alignItems = "center";
		paginationContainer.style.gap = "12px";
		paginationContainer.style.padding = "10px 0 30px 0";
		paginationContainer.style.marginTop = "10px";
		paginationContainer.style.borderTop =
			"1px solid var(--background-modifier-border)";
		paginationContainer.style.flexShrink = "0";

		// Prev Button
		const prevBtn = paginationContainer.createEl("button", {
			text: t("PAGINATION_PREV"),
		});
		prevBtn.disabled = this.pagination.currentPage <= 1;
		prevBtn.onclick = () => {
			if (this.pagination.currentPage > 1) {
				this.pagination.onPageChange(this.pagination.currentPage - 1);
			}
		};

		// Page Info
		const pageInfo = paginationContainer.createSpan({
			cls: "pagination-info",
		});
		pageInfo.setText(
			t("PAGINATION_PAGE")
				.replace("{0}", String(this.pagination.currentPage))
				.replace("{1}", String(this.pagination.totalPages)),
		);

		// Next Button
		const nextBtn = paginationContainer.createEl("button", {
			text: t("PAGINATION_NEXT"),
		});
		nextBtn.disabled =
			this.pagination.currentPage >= this.pagination.totalPages;
		nextBtn.onclick = () => {
			if (this.pagination.currentPage < this.pagination.totalPages) {
				this.pagination.onPageChange(this.pagination.currentPage + 1);
			}
		};
	}

	showSortMenu(event: MouseEvent) {
		const menu = new Menu();

		const addSortItem = (
			label: string,
			option: SortOption,
			order: SortOrder,
		) => {
			menu.addItem((item) => {
				item.setTitle(label)
					.setChecked(
						this.sortOption === option && this.sortOrder === order,
					)
					.onClick(() => {
						this.onSortChange(option, order);
					});
			});
		};

		addSortItem(t("SORT_MODIFIED_DESC"), "modified", "desc");
		addSortItem(t("SORT_MODIFIED_ASC"), "modified", "asc");
		menu.addSeparator();
		addSortItem(t("SORT_CREATED_DESC"), "created", "desc");
		addSortItem(t("SORT_CREATED_ASC"), "created", "asc");
		menu.addSeparator();
		addSortItem(t("SORT_NAME_ASC"), "name", "asc");
		addSortItem(t("SORT_NAME_DESC"), "name", "desc");
		menu.addSeparator();
		addSortItem(t("SORT_SIZE_DESC"), "size", "desc");
		addSortItem(t("SORT_SIZE_ASC"), "size", "asc");

		menu.showAtMouseEvent(event);
	}

	showGroupMenu(event: MouseEvent) {
		const menu = new Menu();

		const addGroupItem = (label: string, option: GroupOption) => {
			menu.addItem((item) => {
				item.setTitle(label)
					.setChecked(this.groupOption === option)
					.onClick(() => {
						this.onGroupChange(option);
					});
			});
		};

		addGroupItem(t("GROUP_NONE"), "none");
		menu.addSeparator();
		addGroupItem(t("GROUP_PROJECT"), "project");
		addGroupItem(t("GROUP_CREATED"), "created");
		addGroupItem(t("GROUP_MODIFIED"), "modified");

		menu.showAtMouseEvent(event);
	}

	getGroups(
		items: (TFile | TaskItem)[],
		type: "file" | "task",
	): { label: string; items: (TFile | TaskItem)[] }[] {
		const groups: { [key: string]: (TFile | TaskItem)[] } = {};

		items.forEach((item) => {
			let key = "";
			const file =
				type === "file" ? (item as TFile) : (item as TaskItem).file;

			if (this.groupOption === "project") {
				const cache = this.app.metadataCache.getFileCache(file);
				key = cache?.frontmatter?.["Project"] || t("GROUP_NONE");
			} else if (this.groupOption === "created") {
				key = window.moment(file.stat.ctime).format("YYYY-MM-DD");
			} else if (this.groupOption === "modified") {
				key = window.moment(file.stat.mtime).format("YYYY-MM-DD");
			} else {
				key = t("GROUP_NONE");
			}

			if (!groups[key]) groups[key] = [];
			groups[key]!.push(item);
		});

		const sortedKeys = Object.keys(groups).sort((a, b) => {
			if (
				this.groupOption === "created" ||
				this.groupOption === "modified"
			) {
				return b.localeCompare(a); // Newest first
			}
			return a.localeCompare(b); // A-Z
		});

		return sortedKeys.map((key) => ({
			label: key,
			items: groups[key]!,
		}));
	}

	renderGroupedNoteList(container: HTMLElement) {
		const groups = this.getGroups(this.filteredFiles, "file");
		if (groups.length === 0) {
			container.createEl("p", { text: t("NO_NOTES_FOUND") });
			return;
		}

		groups.forEach((group) => {
			const groupContainer = container.createDiv({
				cls: "group-container",
			});
			const header = groupContainer.createDiv({
				cls: "group-header",
			});
			header.style.padding = "8px 16px 4px 0px";
			header.style.marginBottom = "8px";
			header.style.display = "flex";
			header.style.alignItems = "center";
			header.style.cursor = "pointer";

			const isCollapsed = this.collapsedGroups.has(group.label);

			const iconSpan = header.createSpan({ cls: "group-icon" });
			setIcon(iconSpan, isCollapsed ? "chevron-right" : "chevron-down");
			iconSpan.style.marginRight = "8px";
			iconSpan.style.display = "flex";

			const title = header.createEl("h5", {
				text: `${group.label} (${group.items.length})`,
			});
			title.style.margin = "0";

			const itemsContainer = groupContainer.createDiv({
				cls: "group-items",
			});
			if (isCollapsed) {
				itemsContainer.style.display = "none";
			}

			header.onclick = () => {
				if (this.collapsedGroups.has(group.label)) {
					this.collapsedGroups.delete(group.label);
					itemsContainer.style.display = "block";
					setIcon(iconSpan, "chevron-down");
				} else {
					this.collapsedGroups.add(group.label);
					itemsContainer.style.display = "none";
					setIcon(iconSpan, "chevron-right");
				}
			};

			this.renderNoteList(itemsContainer, group.items as TFile[]);
		});
	}

	renderGroupedTaskList(container: HTMLElement) {
		const groups = this.getGroups(this.filteredTasks, "task");
		if (groups.length === 0) {
			container.createEl("p", { text: t("NO_TASKS_FOUND") });
			return;
		}

		groups.forEach((group) => {
			const groupContainer = container.createDiv({
				cls: "group-container",
			});
			const header = groupContainer.createDiv({
				cls: "group-header",
			});
			header.style.padding = "8px 16px 4px 0px";
			header.style.marginBottom = "8px";
			header.style.display = "flex";
			header.style.alignItems = "center";
			header.style.cursor = "pointer";

			const isCollapsed = this.collapsedGroups.has(group.label);

			const iconSpan = header.createSpan({ cls: "group-icon" });
			setIcon(iconSpan, isCollapsed ? "chevron-right" : "chevron-down");
			iconSpan.style.marginRight = "8px";
			iconSpan.style.display = "flex";

			const title = header.createEl("h5", {
				text: `${group.label} (${group.items.length})`,
			});
			title.style.margin = "0";

			const itemsContainer = groupContainer.createDiv({
				cls: "group-items",
			});
			if (isCollapsed) {
				itemsContainer.style.display = "none";
			}

			header.onclick = () => {
				if (this.collapsedGroups.has(group.label)) {
					this.collapsedGroups.delete(group.label);
					itemsContainer.style.display = "block";
					setIcon(iconSpan, "chevron-down");
				} else {
					this.collapsedGroups.add(group.label);
					itemsContainer.style.display = "none";
					setIcon(iconSpan, "chevron-right");
				}
			};

			this.renderTaskList(itemsContainer, group.items as TaskItem[]);
		});
	}

	renderNoteList(
		container: HTMLElement,
		files: TFile[] = this.filteredFiles,
	) {
		if (files.length === 0) {
			container.createEl("p", { text: t("NO_NOTES_FOUND") });
			return;
		}

		files.forEach((file) => {
			const item = container.createDiv({ cls: "file-item" });
			item.createEl("h6", { text: file.basename });

			item.addEventListener("mouseenter", (e) => {
				this.app.workspace.trigger("hover-link", {
					event: e,
					source: DASHBOARD_VIEW_TYPE,
					hoverParent: item,
					targetEl: item,
					linktext: file.path,
					sourcePath: file.path,
				});
			});

			const meta = item.createDiv({ cls: "file-meta" });
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];

			if (project) {
				const projectSpan = meta.createEl("p", {
					cls: "file-project",
				});
				// Use Lucide icon 'folder'
				const iconSpan = projectSpan.createSpan({ cls: "meta-icon" });
				setIcon(iconSpan, "folder");
				projectSpan.createSpan({ text: ` ${project}` });
			}

			const dateSpan = meta.createEl("p", { cls: "file-date" });
			// Use Lucide icon 'calendar'
			const dateIconSpan = dateSpan.createSpan({ cls: "meta-icon" });
			setIcon(dateIconSpan, "calendar");
			const date = new Date(file.stat.ctime).toLocaleDateString();
			dateSpan.createSpan({ text: ` ${date}` });

			const sizeSpan = meta.createEl("p", { cls: "file-size" });
			const sizeIconSpan = sizeSpan.createSpan({ cls: "meta-icon" });
			setIcon(sizeIconSpan, "file-text");
			const sizeText = sizeSpan.createSpan({
				text: ` ${file.stat.size}`,
			});

			item.onclick = (e) => {
				e.stopPropagation();
				e.preventDefault();

				let leaf;
				// Check for modifier keys to open in new split
				// Mac: Cmd+Opt, Windows: Ctrl+Alt
				if ((e.metaKey && e.altKey) || (e.ctrlKey && e.altKey)) {
					leaf = this.app.workspace.getLeaf("split", "vertical");
				} else {
					leaf = this.app.workspace.getLeaf(false);
				}
				leaf.openFile(file);
			};
		});
	}

	renderTaskList(
		container: HTMLElement,
		tasks: TaskItem[] = this.filteredTasks,
	) {
		if (tasks.length === 0) {
			container.createEl("p", { text: t("NO_TASKS_FOUND") });
			return;
		}

		tasks.forEach((task) => {
			const item = container.createDiv({ cls: "task-item" });

			const header = item.createDiv({ cls: "task-item-header" });
			header.createEl("span", { text: task.file.basename });
			const date = new Date(task.file.stat.ctime).toLocaleDateString();
			header.createEl("span", { text: date });

			const content = item.createDiv({ cls: "task-content" });
			content.style.display = "flex";
			content.style.justifyContent = "space-between";
			content.style.alignItems = "center";

			const leftContainer = content.createDiv({ cls: "task-left" });
			leftContainer.style.display = "flex";
			leftContainer.style.flex = "1";
			leftContainer.style.alignItems = "center";

			const checkbox = leftContainer.createEl("input", {
				type: "checkbox",
				cls: "task-checkbox",
			});
			// Explicitly allow pointer events to ensure click is captured
			checkbox.style.pointerEvents = "auto";
			checkbox.style.marginTop = "0";
			checkbox.checked = task.status !== " ";
			checkbox.onclick = async (e) => {
				e.stopPropagation();
				await this.onTaskToggle(task);
			};

			const textSpan = leftContainer.createEl("div", {
				cls: "task-markdown-content",
			});
			textSpan.style.flex = "1";
			textSpan.style.marginLeft = "8px";

			const deleteBtn = content.createEl("button", {
				cls: "task-delete-btn clickable-icon",
			});
			setIcon(deleteBtn, "trash");
			deleteBtn.setAttribute(
				"aria-label",
				t("CONFIRM_DELETE_TASK_TITLE"),
			);
			deleteBtn.style.opacity = "0"; // Initially hidden
			deleteBtn.style.transition = "opacity 0.2s ease";
			deleteBtn.style.marginLeft = "8px";
			deleteBtn.style.border = "none";
			deleteBtn.style.background = "transparent";
			deleteBtn.style.cursor = "pointer";

			item.onmouseenter = () => {
				deleteBtn.style.opacity = "0.7";
			};
			item.onmouseleave = () => {
				deleteBtn.style.opacity = "0";
			};
			deleteBtn.onmouseenter = () => {
				deleteBtn.style.opacity = "1";
			};

			deleteBtn.onclick = async (e) => {
				e.stopPropagation();
				await this.onDeleteTask(task);
			};
			MarkdownRenderer.render(
				this.app,
				task.content,
				textSpan,
				task.file.path,
				this,
			).then(() => {
				// Remove paragraph margins to keep it inline-like
				const p = textSpan.querySelector("p");
				if (p) {
					p.style.margin = "0";
					p.style.display = "inline";
				}

				// Handle internal links (preview and navigation)
				const internalLinks =
					textSpan.querySelectorAll("a.internal-link");
				internalLinks.forEach((link) => {
					// Hover preview
					link.addEventListener("mouseenter", (e) => {
						this.app.workspace.trigger("hover-link", {
							event: e,
							source: DASHBOARD_VIEW_TYPE,
							hoverParent: textSpan,
							targetEl: link,
							linktext: link.getAttribute("data-href"),
							sourcePath: task.file.path,
						});
					});

					// Click navigation
					link.addEventListener("click", (e) => {
						e.preventDefault();
						e.stopPropagation();
						const href = link.getAttribute("data-href");
						if (href) {
							this.app.workspace.openLinkText(
								href,
								task.file.path,
								false, // open in same tab? or true for new tab? usually false for clicking link
							);
						}
					});
				});

				// Handle external links (stop propagation to avoid opening task file)
				const externalLinks =
					textSpan.querySelectorAll("a.external-link");
				externalLinks.forEach((link) => {
					link.addEventListener("click", (e) => {
						e.stopPropagation();
					});
				});
			});

			item.onclick = async (e) => {
				const target = e.target as HTMLElement;
				// Prevent triggering if clicking checkbox directly
				if (
					target instanceof HTMLInputElement &&
					target.type === "checkbox"
				) {
					return;
				}
				// Prevent triggering if clicking a link (internal or external)
				if (target.tagName === "A" || target.closest("a")) {
					return;
				}

				// Handle selection state
				container.querySelectorAll(".task-item").forEach((el) => {
					el.removeClass("is-selected");
				});
				item.addClass("is-selected");

				e.stopPropagation();
				e.preventDefault();

				let leaf;
				// Check for modifier keys to open in new split
				// Mac: Cmd+Opt, Windows: Ctrl+Alt
				if ((e.metaKey && e.altKey) || (e.ctrlKey && e.altKey)) {
					leaf = this.app.workspace.getLeaf("split", "vertical");
				} else {
					leaf = this.app.workspace.getLeaf(false);
				}

				await leaf.openFile(task.file, {
					eState: { line: task.line },
				});

				const view = leaf.view;
				if (view instanceof MarkdownView) {
					const editor = view.editor;
					const lineContent = editor.getLine(task.line);
					editor.setCursor({
						line: task.line,
						ch: lineContent.length,
					});
					editor.focus();
				}
			};
		});
	}
}
