import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextComponent,
} from "obsidian";
import { t } from "../lang/helpers";
import { createDefaultFilterState } from "../data/saved-query-adapter";
import {
	DATE_PRESETS,
	DATE_PRESET_LABEL_KEYS,
	defaultCustomRange,
	isDateRangeValid,
	normalizeDatePreset,
} from "../data/date-presets";
import {
	FILE_EXTENSION_GROUPS,
	normalizeExtensions,
	type FileExtensionGroupKey,
} from "../data/file-extensions";
import {
	groupByTarget,
	querySourceOf,
	type QuerySource,
} from "../query/manager";
import { queryDisplayName, queryTargetLabel } from "./query-labels";
import { QUERY_TARGETS, type QueryDefinition, type QueryTarget } from "../query/types";
import {
	type CollectionAction,
	type CollectionItem,
	type CollectionLayout,
	renderCollection,
} from "./collection-view";
import { applyModalShell, createLayoutToggle } from "./modal-shell";
import { FolderPickerModal } from "./pickers/folder-picker";

export interface QueryMutationResult {
	queries: QueryDefinition[];
	created: QueryDefinition;
}

export interface QueryManagerActions {
	onNew(
		target: QueryTarget,
		onAdopted: (result: QueryMutationResult) => void,
	): void;
	onEdit(
		query: QueryDefinition,
		onAdopted: (result: QueryMutationResult) => void,
	): void;
	/** Persists a copy and returns the fresh list; null means the write failed. */
	onDuplicate(query: QueryDefinition): Promise<QueryMutationResult | null>;
	onDelete(
		query: QueryDefinition,
		onDeleted: (queries: QueryDefinition[]) => void,
	): void;
}

export interface QueryManagerPreferences {
	layout: CollectionLayout;
	onLayoutChange(layout: CollectionLayout): void;
}

type LocaleKey = Parameters<typeof t>[0];

/** Must match the `.is-newly-created::after` animation length in styles.css. */
const REVEAL_HIGHLIGHT_MS = 900;

const SOURCE_LABEL_KEYS: Record<QuerySource, LocaleKey> = {
	builtin: "QUERY_SOURCE_BUILTIN",
	saved: "QUERY_SOURCE_SAVED",
	user: "QUERY_SOURCE_USER",
};

/** Survives modal reopen within the plugin instance; deliberately not persisted. */
let rememberedTarget: QueryTarget | null = null;

const displayName = queryDisplayName;

const targetLabel = queryTargetLabel;

function metaLabel(query: QueryDefinition, references: number): string {
	const source = querySourceOf(query.id);
	const citation = `${t("QUERY_MANAGER_REFERENCES")} ${references}`;
	return source
		? `${t(SOURCE_LABEL_KEYS[source])} · ${citation}`
		: citation;
}

export class QueryManagerModal extends Modal {
	private layout: CollectionLayout;
	private activeTarget: QueryTarget;
	private collectionEl: HTMLElement | null = null;
	private tabbarEl: HTMLElement | null = null;
	private references = new Map<string, number>();
	private duplicating = false;

	constructor(
		app: App,
		private queries: QueryDefinition[],
		private referenceCount: (queryId: string) => number,
		private actions: QueryManagerActions,
		private preferences?: QueryManagerPreferences,
	) {
		super(app);
		this.layout = preferences?.layout ?? "list";
		const groups = groupByTarget(queries);
		this.activeTarget =
			rememberedTarget ??
			QUERY_TARGETS.find((target) => groups[target].length > 0) ??
			"task";
		this.rebuildReferences();
	}

	onOpen(): void {
		const { contentEl } = this;
		applyModalShell(this, {
			kind: "query-manager",
			restore: true,
			title: t("QUERY_MANAGER_TITLE"),
		});

		const toolbar = contentEl.createDiv({ cls: "ioto-query-toolbar" });
		this.tabbarEl = toolbar.createDiv({
			cls: "ioto-query-tabs",
			attr: { role: "tablist" },
		});
		this.tabbarEl.addEventListener("keydown", (event) =>
			this.handleTabKeydown(event),
		);
		new ButtonComponent(toolbar)
			.setButtonText(t("QUERY_MANAGER_NEW"))
			.setCta()
			.onClick(() =>
				this.actions.onNew(this.activeTarget, (result) =>
					this.adopt(result),
				),
			);

		const body = contentEl.createDiv({ cls: "ioto-modal-body" });
		this.collectionEl = body.createDiv({
			cls: "ioto-modal-collection",
			attr: { role: "tabpanel" },
		});
		this.renderTabs();
		this.renderItems();

		if (this.preferences) {
			createLayoutToggle(this, this.layout, (layout) => {
				this.layout = layout;
				this.preferences?.onLayoutChange(layout);
				this.renderItems();
			});
		}
	}

	private rebuildReferences(): void {
		this.references.clear();
		for (const query of this.queries) {
			this.references.set(query.id, this.referenceCount(query.id));
		}
	}

	private selectTarget(target: QueryTarget, focus = false): void {
		if (target !== this.activeTarget) {
			this.activeTarget = target;
			rememberedTarget = target;
			this.renderTabs();
			this.renderItems();
		}
		if (focus) {
			this.tabbarEl
				?.querySelector<HTMLElement>(`#ioto-query-tab-${target}`)
				?.focus();
		}
	}

	private handleTabKeydown(event: KeyboardEvent): void {
		const index = QUERY_TARGETS.indexOf(this.activeTarget);
		let next: number;
		switch (event.key) {
			case "ArrowRight":
				next = (index + 1) % QUERY_TARGETS.length;
				break;
			case "ArrowLeft":
				next = (index - 1 + QUERY_TARGETS.length) % QUERY_TARGETS.length;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = QUERY_TARGETS.length - 1;
				break;
			default:
				return;
		}
		const target = QUERY_TARGETS[next];
		if (!target) return;
		event.preventDefault();
		this.selectTarget(target, true);
	}

	private renderTabs(): void {
		if (!this.tabbarEl) return;

		const groups = groupByTarget(this.queries);
		this.tabbarEl.empty();

		for (const target of QUERY_TARGETS) {
			const active = target === this.activeTarget;
			const label = targetLabel(target);
			const count = groups[target].length;
			const tab = this.tabbarEl.createEl("button", {
				cls: "ioto-query-tab",
				attr: {
					type: "button",
					role: "tab",
					id: `ioto-query-tab-${target}`,
					tabindex: active ? "0" : "-1",
					"aria-selected": active ? "true" : "false",
					"aria-label": `${label} (${count})`,
				},
			});
			if (active) tab.addClass("is-active");
			tab.createSpan({ cls: "ioto-query-tab__label", text: label });
			tab.createSpan({
				cls: "ioto-query-tab__count",
				text: String(count),
			});
			tab.addEventListener("click", () => this.selectTarget(target));
		}

		this.collectionEl?.setAttribute(
			"aria-labelledby",
			`ioto-query-tab-${this.activeTarget}`,
		);
	}

	private renderItems(): void {
		if (!this.collectionEl) return;

		const queries = groupByTarget(this.queries)[this.activeTarget];
		if (queries.length === 0) {
			this.renderEmptyState();
			return;
		}

		const items: CollectionItem[] = queries.map((query) => {
			const isUser = query.id.startsWith("user:");
			const references = this.references.get(query.id) ?? 0;

			const actions: CollectionAction[] = [
				{
					icon: "copy",
					label: t("QUERY_MANAGER_DUPLICATE"),
					onClick: () => void this.duplicate(query),
				},
			];

			if (isUser) {
				actions.push(
					{
						icon: "pencil",
						label: t("QUERY_MANAGER_EDIT"),
						onClick: () =>
							this.actions.onEdit(query, (result) =>
								this.adopt(result, false),
							),
					},
					{
						icon: "trash",
						label: t("QUERY_MANAGER_DELETE"),
						danger: true,
						onClick: () =>
							this.actions.onDelete(query, (queries) =>
								this.adoptList(queries),
							),
					},
				);
			}

			return {
				id: query.id,
				title: displayName(query),
				meta: metaLabel(query, references),
				actions,
			};
		});

		renderCollection(this.collectionEl, items, this.layout);
	}

	private renderEmptyState(): void {
		if (!this.collectionEl) return;

		const label = targetLabel(this.activeTarget);
		this.collectionEl.empty();
		const empty = this.collectionEl.createDiv({ cls: "ioto-query-empty" });
		empty.createDiv({
			cls: "ioto-query-empty__hint",
			text: t("QUERY_MANAGER_EMPTY_TARGET", [label]),
		});
		if (this.activeTarget === "file" || this.activeTarget === "folder") {
			empty.createDiv({
				cls: "ioto-query-empty__hint",
				text: t("QUERY_MANAGER_TABLE_ONLY_HINT"),
			});
		}
		empty
			.createEl("button", {
				text: t("QUERY_MANAGER_NEW_TARGET", [label]),
			})
			.addEventListener("click", () => {
				this.actions.onNew(this.activeTarget, (result) =>
					this.adopt(result),
				);
			});
	}

	private async duplicate(query: QueryDefinition): Promise<void> {
		if (this.duplicating) return;
		this.duplicating = true;
		try {
			const result = await this.actions.onDuplicate(query);
			if (!result) {
				new Notice(t("QUERY_DUPLICATE_FAILED"));
				return;
			}
			this.queries = result.queries;
			this.rebuildReferences();
			this.renderTabs();
			this.renderItems();
			this.revealItem(result.created.id);
			new Notice(t("QUERY_DUPLICATED", [result.created.name]));
		} finally {
			this.duplicating = false;
		}
	}

	private adopt(result: QueryMutationResult, announce = true): void {
		if (!this.collectionEl?.isConnected) return;
		this.queries = result.queries;
		this.rebuildReferences();
		if (result.created.target !== this.activeTarget) {
			this.activeTarget = result.created.target;
			rememberedTarget = result.created.target;
		}
		this.renderTabs();
		this.renderItems();
		this.revealItem(result.created.id);
		if (announce) {
			new Notice(t("QUERY_CREATED", [displayName(result.created)]));
		}
	}

	private adoptList(queries: QueryDefinition[]): void {
		if (!this.collectionEl?.isConnected) return;
		this.queries = queries;
		this.rebuildReferences();
		this.renderTabs();
		this.renderItems();
	}

	private revealItem(id: string): void {
		const el = this.collectionEl?.querySelector<HTMLElement>(
			`[data-id="${CSS.escape(id)}"]`,
		);
		if (!el) return;
		el.scrollIntoView({ block: "nearest" });
		el.addClass("is-newly-created");
		el.setAttribute("tabindex", "-1");
		el.focus({ preventScroll: true });
		window.setTimeout(() => el.removeClass("is-newly-created"), REVEAL_HIGHLIGHT_MS);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Query editor for `user:*` definitions; builtins/saved are duplicated first. */
export class QueryEditModal extends Modal {
	private draft: QueryDefinition;
	private targetsEl: HTMLElement | null = null;
	private dynamicEl: HTMLElement | null = null;
	private saveButton: ButtonComponent | null = null;
	private nameInputEl: HTMLInputElement | null = null;
	private nameHintEl: HTMLElement | null = null;
	private nameTouched = false;
	private rangeEl: HTMLElement | null = null;
	private dateStartInputEl: HTMLInputElement | null = null;
	private dateEndInputEl: HTMLInputElement | null = null;
	private rangeErrorEl: HTMLElement | null = null;
	private foldersInput: TextComponent | null = null;
	private saving = false;

	constructor(
		app: App,
		initial: QueryDefinition | null,
		private onSave: (query: QueryDefinition) => void,
		initialTarget?: QueryTarget,
	) {
		super(app);
		this.draft = initial
			? structuredClone(initial)
			: {
					id: `user:${Date.now()}`,
					name: "",
					target: initialTarget ?? "task",
					scope: { folders: [], includeSubfolders: true },
					filters: createDefaultFilterState(),
				};
		this.draft.filters.datePreset = normalizeDatePreset(
			this.draft.filters.datePreset,
		);
	}

	onOpen(): void {
		const { contentEl } = this;
		applyModalShell(this, {
			kind: "query-editor",
			restore: true,
			title: this.editorTitle(),
		});

		const body = contentEl.createDiv({ cls: "ioto-modal-body" });

		body.createEl("h3", {
			cls: "setting-item-heading",
			text: t("QUERY_SECTION_BASIC"),
		});

		this.targetsEl = body.createDiv({
			cls: "ioto-query-editor__targets",
			attr: { role: "group", "aria-label": t("QUERY_TARGET") },
		});
		this.renderTargets();

		new Setting(body).setName(t("QUERY_NAME")).addText((text) => {
			this.nameInputEl = text.inputEl;
			text.setValue(this.draft.name).onChange((value) => {
				this.draft.name = value;
				this.nameTouched = true;
				this.updateSaveState();
			});
			text.inputEl.addEventListener("blur", () => {
				this.nameTouched = true;
				this.updateSaveState();
			});
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" && !event.isComposing) {
					event.preventDefault();
					this.trySave();
				}
			});
		});

		this.nameHintEl = body.createDiv({
			cls: "ioto-modal-hint",
			text: t("QUERY_NAME_REQUIRED"),
		});
		this.nameHintEl.hidden = true;

		this.dynamicEl = body.createDiv({ cls: "ioto-query-editor__dynamic" });
		this.renderDynamic();

		const footer = contentEl.createDiv({ cls: "ioto-modal-footer" });
		const actions = footer.createDiv({
			cls: "ioto-modal-footer__actions",
		});
		new ButtonComponent(actions)
			.setButtonText(t("BTN_CANCEL"))
			.onClick(() => this.close());
		this.saveButton = new ButtonComponent(actions)
			.setButtonText(t("QUERY_SAVE"))
			.setCta()
			.onClick(() => this.trySave());
		this.updateSaveState();

		window.setTimeout(() => this.nameInputEl?.focus(), 0);
	}

	private editorTitle(): string {
		const key =
			this.draft.name.trim().length === 0
				? "QUERY_EDITOR_TITLE_NEW_TARGET"
				: "QUERY_EDITOR_TITLE_EDIT_TARGET";
		return t(key, [targetLabel(this.draft.target)]);
	}

	private renderTargets(): void {
		if (!this.targetsEl) return;
		this.targetsEl.empty();
		for (const target of QUERY_TARGETS) {
			const active = target === this.draft.target;
			const button = this.targetsEl.createEl("button", {
				cls: "ioto-query-editor__target",
				text: targetLabel(target),
				attr: {
					type: "button",
					"aria-pressed": active ? "true" : "false",
				},
			});
			button.toggleClass("is-active", active);
			button.addEventListener("click", () => this.selectTarget(target));
		}
	}

	private selectTarget(target: QueryTarget): void {
		if (target === this.draft.target) return;
		this.draft.target = target;
		this.setTitle(this.editorTitle());
		this.renderTargets();
		this.renderDynamic();
		this.updateSaveState();
	}

	private renderDynamic(): void {
		if (!this.dynamicEl) return;
		const body = this.dynamicEl;
		body.empty();
		this.foldersInput = null;
		this.rangeEl = null;
		this.dateStartInputEl = null;
		this.dateEndInputEl = null;
		this.rangeErrorEl = null;

		body.createEl("h3", {
			cls: "setting-item-heading",
			text: t("QUERY_SECTION_SCOPE"),
		});

		const foldersSetting = new Setting(body)
			.setName(t("QUERY_FOLDERS"))
			.setDesc(t("QUERY_FOLDERS_DESC"));
		foldersSetting.addText((text) => {
			this.foldersInput = text;
			text.setPlaceholder(t("QUERY_FOLDERS_PLACEHOLDER"))
				.setValue(this.draft.scope.folders.join(", "))
				.onChange((value) => {
					this.draft.scope.folders = value
						.split(",")
						.map((item) => item.trim())
						.filter((item) => item.length > 0);
				});
		});
		foldersSetting.addButton((button) =>
			button
				.setIcon("folder")
				.setTooltip(t("QUERY_BROWSE_FOLDER"))
				.onClick(() => {
					new FolderPickerModal(this.app, (folder) => {
						if (!this.draft.scope.folders.includes(folder.path)) {
							this.draft.scope.folders.push(folder.path);
						}
						this.foldersInput?.setValue(
							this.draft.scope.folders.join(", "),
						);
						this.foldersInput?.inputEl.focus();
					}).open();
				}),
		);

		new Setting(body)
			.setName(t("QUERY_INCLUDE_SUBFOLDERS"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.draft.scope.includeSubfolders)
					.onChange((value) => {
						this.draft.scope.includeSubfolders = value;
					}),
			);

		if (this.draft.target === "file") {
			this.renderFileFilters(body);
			return;
		}
		if (this.draft.target === "folder") {
			this.renderFolderFilters(body);
			return;
		}

		this.renderFilters(body);
	}

	private renderFileFilters(body: HTMLElement): void {
		body.createEl("h3", {
			cls: "setting-item-heading",
			text: t("QUERY_SECTION_FILTERS"),
		});
		const filters = body.createDiv({
			cls: "ioto-modal-filters ioto-modal-filters--single",
		});
		this.addFilterInput(
			filters,
			t("QUERY_FILTER_NAME"),
			"name",
			this.draft.filters.name,
		);
		this.renderExtensionPicker(body);
	}

	private renderFolderFilters(body: HTMLElement): void {
		body.createEl("h3", {
			cls: "setting-item-heading",
			text: t("QUERY_SECTION_FILTERS"),
		});
		const filters = body.createDiv({
			cls: "ioto-modal-filters ioto-modal-filters--single",
		});
		this.addFilterInput(
			filters,
			t("QUERY_FILTER_NAME"),
			"name",
			this.draft.filters.name,
		);
		body.createDiv({ cls: "ioto-modal-note", text: t("QUERY_FILES_NAME_ONLY") });
	}

	private renderExtensionPicker(body: HTMLElement): void {
		const setting = new Setting(body).setName(t("QUERY_FILE_TYPES"));
		setting.settingEl.addClass("ioto-extension-setting");

		const chips = setting.controlEl.createDiv({ cls: "ioto-ext-chips" });
		const input = setting.controlEl.createEl("input", {
			cls: "ioto-ext-input",
			attr: { type: "text", placeholder: t("QUERY_FILE_TYPES_PLACEHOLDER") },
		});

		// 打开即归一化，避免历史数据里的 ".PDF " / "md" 直接显示在文本框
		this.draft.scope.extensions = normalizeExtensions(
			this.draft.scope.extensions,
		);
		const current = (): readonly string[] => this.draft.scope.extensions ?? [];
		const chipEls: { el: HTMLElement; extensions: readonly string[] }[] = [];

		const allEl = chips.createEl("button", {
			cls: "ioto-ext-chip ioto-ext-chip--all",
			text: t("QUERY_FILE_TYPE_GROUP_ALL"),
			attr: { type: "button" },
		});

		const sync = (): void => {
			const active = new Set(current());
			allEl.toggleClass("is-active", active.size === 0);
			for (const chip of chipEls) {
				chip.el.toggleClass(
					"is-active",
					chip.extensions.length > 0 &&
						chip.extensions.every((ext) => active.has(ext)),
				);
			}
		};
		const write = (next: readonly string[]): void => {
			this.draft.scope.extensions = normalizeExtensions(next);
			input.value = current().join(", ");
			sync();
		};

		allEl.addEventListener("click", () => write([]));

		const labels: Record<FileExtensionGroupKey, LocaleKey> = {
			document: "QUERY_FILE_TYPE_GROUP_DOCUMENT",
			sheet: "QUERY_FILE_TYPE_GROUP_SHEET",
			slide: "QUERY_FILE_TYPE_GROUP_SLIDE",
			image: "QUERY_FILE_TYPE_GROUP_IMAGE",
			media: "QUERY_FILE_TYPE_GROUP_MEDIA",
			archive: "QUERY_FILE_TYPE_GROUP_ARCHIVE",
		};
		for (const group of FILE_EXTENSION_GROUPS) {
			const el = chips.createEl("button", {
				cls: "ioto-ext-chip",
				text: t(labels[group.key]),
				attr: { type: "button" },
			});
			chipEls.push({ el, extensions: group.extensions });
			el.addEventListener("click", () => {
				const active = new Set(current());
				const on = group.extensions.every((ext) => active.has(ext));
				for (const ext of group.extensions) {
					if (on) active.delete(ext);
					else active.add(ext);
				}
				write([...active]);
			});
		}

		input.value = current().join(", ");
		input.addEventListener("change", () => write(input.value.split(",")));
		sync();

		body.createDiv({ cls: "ioto-modal-note", text: t("QUERY_FILE_TYPES_HINT") });
	}

	private renderFilters(body: HTMLElement): void {
		body.createEl("h3", {
			cls: "setting-item-heading",
			text: t("QUERY_SECTION_FILTERS"),
		});

		const filters = body.createDiv({ cls: "ioto-modal-filters" });
		this.addFilterInput(
			filters,
			t("QUERY_FILTER_NAME"),
			"name",
			this.draft.filters.name,
		);
		this.addFilterInput(
			filters,
			t("QUERY_FILTER_PROJECT"),
			"project",
			this.draft.filters.project,
		);
		this.addFilterInput(
			filters,
			t("QUERY_FILTER_SUBJECT"),
			"subject",
			this.draft.filters.subject,
		);

		new Setting(body)
			.setName(t("QUERY_FILTER_DATE_PRESET"))
			.addDropdown((dropdown) => {
				for (const preset of DATE_PRESETS) {
					dropdown.addOption(
						preset,
						t(DATE_PRESET_LABEL_KEYS[preset]),
					);
				}
				dropdown
					.setValue(this.draft.filters.datePreset)
					.onChange((value) => {
						this.draft.filters.datePreset =
							normalizeDatePreset(value);
						this.syncDateRange();
					});
			});

		this.renderDateRange(body);
	}

	private renderDateRange(body: HTMLElement): void {
		const wrap = body.createDiv({ cls: "ioto-modal-date-range-wrap" });

		const range = wrap.createDiv({ cls: "ioto-modal-date-range" });
		const startField = range.createDiv({ cls: "ioto-modal-filter" });
		startField.createEl("label", {
			text: t("FILTER_DATE_START_LABEL"),
		});
		this.dateStartInputEl = startField.createEl("input", {
			attr: { type: "date" },
		});
		this.dateStartInputEl.addEventListener("change", () => {
			this.draft.filters.dateStart = this.dateStartInputEl?.value ?? "";
			this.syncDateRange();
		});

		const endField = range.createDiv({ cls: "ioto-modal-filter" });
		endField.createEl("label", { text: t("FILTER_DATE_END_LABEL") });
		this.dateEndInputEl = endField.createEl("input", {
			attr: { type: "date" },
		});
		this.dateEndInputEl.addEventListener("change", () => {
			this.draft.filters.dateEnd = this.dateEndInputEl?.value ?? "";
			this.syncDateRange();
		});

		wrap.createDiv({
			cls: "ioto-modal-note",
			text: t("QUERY_DATE_RANGE_HINT"),
		});
		this.rangeErrorEl = wrap.createDiv({
			cls: "ioto-modal-error",
			text: t("QUERY_DATE_RANGE_INVALID"),
		});
		this.rangeErrorEl.hidden = true;

		this.rangeEl = wrap;
		this.syncDateRange();
	}

	private syncDateRange(): void {
		if (!this.rangeEl) {
			this.updateSaveState();
			return;
		}
		const custom = this.draft.filters.datePreset === "custom";
		if (
			custom &&
			!this.draft.filters.dateStart &&
			!this.draft.filters.dateEnd
		) {
			const range = defaultCustomRange();
			this.draft.filters.dateStart = range.dateStart;
			this.draft.filters.dateEnd = range.dateEnd;
		}
		if (this.dateStartInputEl) {
			this.dateStartInputEl.value = this.draft.filters.dateStart;
		}
		if (this.dateEndInputEl) {
			this.dateEndInputEl.value = this.draft.filters.dateEnd;
		}
		this.rangeEl.hidden = !custom;
		this.updateSaveState();
	}

	private rangeApplies(): boolean {
		return (
			(this.draft.target === "task" || this.draft.target === "note") &&
			this.draft.filters.datePreset === "custom"
		);
	}

	private isRangeValid(): boolean {
		return isDateRangeValid(
			this.draft.filters.dateStart,
			this.draft.filters.dateEnd,
		);
	}

	private updateSaveState(): void {
		const named = this.draft.name.trim().length > 0;
		const rangeOk = !this.rangeApplies() || this.isRangeValid();

		this.saveButton?.setDisabled(!named || !rangeOk);
		if (this.nameHintEl) {
			this.nameHintEl.hidden = !(this.nameTouched && !named);
		}
		if (this.rangeErrorEl) {
			this.rangeErrorEl.hidden = !this.rangeApplies() || rangeOk;
		}
	}

	private trySave(): void {
		if (this.saving) return;
		const named = this.draft.name.trim().length > 0;
		const rangeOk = !this.rangeApplies() || this.isRangeValid();
		if (!named || !rangeOk) {
			this.nameTouched = true;
			this.updateSaveState();
			return;
		}
		this.saving = true;
		this.close();
		this.onSave(this.draft);
	}

	private addFilterInput(
		container: HTMLElement,
		label: string,
		field: "name" | "project" | "subject",
		value: string,
	): void {
		const fieldEl = container.createDiv({ cls: "ioto-modal-filter" });
		fieldEl.createEl("label", { text: label });
		const input = fieldEl.createEl("input", { attr: { type: "text" } });
		input.value = value;
		input.addEventListener("input", () => {
			this.draft.filters[field] = input.value;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
