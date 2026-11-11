import { Menu, debounce, setIcon, type Debouncer } from "obsidian";
import { t } from "../../lang/helpers";
import type { PageInspectorState } from "../../dashboard/inspector-service";

export interface PageInspectorDeps {
	rename(name: string): void;
	setLayout(columns: 12 | 24, rowHeight: number): void;
	remove(): void;
}

type LabelKey = Parameters<typeof t>[0];

/**
 * Settings panel for one dashboard page. Reads everything from the passed
 * state and writes only through `deps` (never touches the repository directly).
 */
export class PageInspector {
	private root: HTMLElement;
	private signature = "";
	private state: PageInspectorState | null = null;
	private dashboardCrumbEl: HTMLElement | null = null;
	private pageCrumbEl: HTMLElement | null = null;
	private nameInput: HTMLInputElement | null = null;
	private positionEl: HTMLElement | null = null;
	private componentsEl: HTMLElement | null = null;
	private columnsSelect: HTMLSelectElement | null = null;
	private rowHeightInput: HTMLInputElement | null = null;
	private rowHeightValueEl: HTMLElement | null = null;
	private menuButtonEl: HTMLButtonElement | null = null;
	private nameDebouncer: Debouncer<[string], void> | null = null;
	/** Session-only collapse state keyed by section title key, never persisted. */
	private collapsedSections = new Set<string>();

	constructor(
		container: HTMLElement,
		private deps: PageInspectorDeps,
	) {
		this.root = container.createDiv({ cls: "ioto-inspector" });
	}

	render(state: PageInspectorState | null): void {
		if (!state) {
			this.renderEmpty();
			return;
		}
		const signature = this.signatureOf(state);
		if (signature !== this.signature) {
			const scrollTop = this.root.scrollTop;
			this.signature = signature;
			this.build(state);
			this.root.scrollTop = scrollTop;
		}
		this.syncValues(state);
		this.applyFocus(state);
	}

	destroy(): void {
		this.nameDebouncer?.cancel();
		this.nameDebouncer = null;
		this.resetRefs();
		this.root.remove();
	}

	/** `pageName` is intentionally excluded so renaming never rebuilds the input. */
	private signatureOf(state: PageInspectorState): string {
		const target = state.target;
		return [
			target.pageId,
			state.editable ? "edit" : "view",
			String(target.columns),
			String(target.rowHeight),
			String(target.total),
			String(target.componentCount),
			target.canDelete ? "delete" : "locked",
		].join("|");
	}

	private renderEmpty(): void {
		if (this.signature === "empty") return;
		this.signature = "empty";
		this.nameDebouncer?.cancel();
		this.resetRefs();
		this.root.empty();
		this.root.removeClass("is-readonly");
		this.root.createDiv({
			cls: "ioto-inspector-empty-title",
			text: t("INSPECTOR_EMPTY_TITLE"),
		});
		this.root.createDiv({
			cls: "ioto-inspector-empty-desc",
			text: t("INSPECTOR_EMPTY_DESC"),
		});
	}

	private build(state: PageInspectorState): void {
		this.nameDebouncer?.cancel();
		this.resetRefs();
		this.root.empty();
		this.root.toggleClass("is-readonly", !state.editable);

		const header = this.root.createDiv({ cls: "ioto-inspector-header" });
		const breadcrumb = header.createDiv({
			cls: "ioto-inspector-breadcrumb",
		});
		this.dashboardCrumbEl = breadcrumb.createSpan({
			cls: "ioto-inspector-crumb-plain",
			text: state.target.dashboardName,
		});
		breadcrumb.createSpan({
			cls: "ioto-inspector-crumb-sep",
			attr: { "aria-hidden": "true" },
			text: "›",
		});
		this.pageCrumbEl = breadcrumb.createSpan({
			cls: "ioto-inspector-crumb-current",
			attr: { "aria-current": "page" },
			text: state.target.pageName,
		});
		this.createMenuButton(header, state);

		if (!state.editable) {
			this.root.createDiv({
				cls: "ioto-inspector-hint",
				text: t("INSPECTOR_VIEW_MODE_HINT"),
			});
		}

		this.buildBasicSection(state);
		this.buildLayoutSection(state);
	}

	private createMenuButton(
		header: HTMLElement,
		state: PageInspectorState,
	): void {
		const button = header.createEl("button", {
			cls: "clickable-icon",
			attr: {
				type: "button",
				"aria-label": t("INSPECTOR_MORE_ACTIONS"),
				title: t("INSPECTOR_MORE_ACTIONS"),
				"aria-haspopup": "menu",
			},
		});
		setIcon(button, "more-horizontal");
		button.onClickEvent((event) => this.openMoreMenu(event, button));
		button.disabled = !state.editable;
		this.menuButtonEl = button;
	}

	private openMoreMenu(
		event: MouseEvent,
		button: HTMLButtonElement,
	): void {
		const state = this.state;
		if (!state?.editable) return;
		const pageId = state.target.pageId;
		const canDelete = state.target.canDelete;
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(
				canDelete
					? t("PAGE_SETTINGS_DELETE")
					: t("PAGE_LAST_CANNOT_DELETE"),
			)
				.setIcon("trash-2")
				.setWarning(canDelete)
				.setDisabled(!canDelete)
				.onClick(() => {
					if (this.state?.target.pageId !== pageId) return;
					this.deps.remove();
				});
		});
		if (event.detail > 0) {
			menu.showAtMouseEvent(event);
			return;
		}
		const rect = button.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom });
	}

	private createSection(titleKey: LabelKey): HTMLElement {
		const section = this.root.createDiv({ cls: "ioto-inspector-section" });
		const key = String(titleKey);
		section.dataset.sectionKey = key;
		const head = section.createDiv({
			cls: "ioto-inspector-section-head",
		});

		const toggle = head.createEl("button", {
			cls: "ioto-inspector-section-toggle",
			attr: { type: "button", "aria-expanded": "true" },
		});
		const chevron = toggle.createSpan({
			cls: "ioto-inspector-section-chevron",
		});
		setIcon(chevron, "chevron-down");
		toggle.createSpan({
			cls: "ioto-inspector-section-title",
			text: t(titleKey),
		});

		const body = section.createDiv({ cls: "ioto-inspector-section-body" });
		if (this.collapsedSections.has(key)) this.setSectionCollapsed(section, true);
		toggle.onClickEvent(() => {
			this.setSectionCollapsed(section, !section.hasClass("is-collapsed"));
		});
		return body;
	}

	private setSectionCollapsed(section: HTMLElement, collapsed: boolean): void {
		const key = section.dataset.sectionKey;
		if (!key) return;
		section.toggleClass("is-collapsed", collapsed);
		section
			.querySelector<HTMLElement>(".ioto-inspector-section-toggle")
			?.setAttr("aria-expanded", String(!collapsed));
		if (collapsed) this.collapsedSections.add(key);
		else this.collapsedSections.delete(key);
	}

	private buildBasicSection(state: PageInspectorState): void {
		const section = this.createSection("PAGE_SETTINGS_SECTION_BASIC");

		const field = section.createDiv({ cls: "ioto-inspector-field" });
		field.createEl("label", { text: t("PAGE_SETTINGS_NAME_LABEL") });
		const input = field.createEl("input", {
			type: "text",
			attr: { placeholder: t("PAGE_NAME_PLACEHOLDER") },
		});
		input.value = state.target.pageName;
		input.disabled = !state.editable;
		const debouncer = debounce(
			(_value: string) => this.commitName(),
			300,
			true,
		);
		this.nameDebouncer = debouncer;
		input.addEventListener("input", () => debouncer(input.value));
		input.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			debouncer.cancel();
			this.commitName();
		});
		input.addEventListener("blur", () => {
			debouncer.cancel();
			this.commitName();
		});
		field.createDiv({
			cls: "ioto-inspector-hint",
			text: t("PAGE_SETTINGS_NAME_DESC"),
		});
		this.nameInput = input;

		const meta = section.createDiv({ cls: "ioto-inspector-meta" });
		this.positionEl = meta.createSpan({
			cls: "ioto-inspector-meta-item",
		});
		this.componentsEl = meta.createSpan({
			cls: "ioto-inspector-meta-item",
		});
	}

	private buildLayoutSection(state: PageInspectorState): void {
		const section = this.createSection("PAGE_SETTINGS_SECTION_LAYOUT");

		const columnsField = section.createDiv({ cls: "ioto-inspector-field" });
		columnsField.createEl("label", {
			text: t("PAGE_LAYOUT_COLUMNS"),
		});
		const columns = columnsField.createEl("select", { cls: "dropdown" });
		columns.createEl("option", {
			value: "12",
			text: t("PAGE_LAYOUT_COLUMNS_12"),
		});
		columns.createEl("option", {
			value: "24",
			text: t("PAGE_LAYOUT_COLUMNS_24"),
		});
		columns.value = String(state.target.columns);
		columns.disabled = !state.editable;
		columns.addEventListener("change", () => {
			const target = this.state?.target;
			if (!target) return;
			this.deps.setLayout(
				columns.value === "24" ? 24 : 12,
				target.rowHeight,
			);
		});
		columnsField.createDiv({
			cls: "ioto-inspector-hint",
			text: t("PAGE_SETTINGS_COLUMNS_HINT"),
		});
		this.columnsSelect = columns;

		const rowField = section.createDiv({ cls: "ioto-inspector-field" });
		rowField.createEl("label", {
			text: t("PAGE_LAYOUT_ROW_HEIGHT"),
		});
		const rangeRow = rowField.createDiv({
			cls: "ioto-inspector-range-row",
		});
		const range = rangeRow.createEl("input", {
			type: "range",
			attr: { min: "40", max: "200", step: "8" },
		});
		range.value = String(state.target.rowHeight);
		range.disabled = !state.editable;
		const value = rangeRow.createSpan({
			cls: "ioto-inspector-range-value",
			text: `${state.target.rowHeight}px`,
		});
		range.addEventListener("input", () => {
			value.setText(`${range.value}px`);
		});
		range.addEventListener("change", () => {
			const target = this.state?.target;
			if (!target) return;
			this.deps.setLayout(target.columns, Number(range.value));
		});
		rowField.createDiv({
			cls: "ioto-inspector-hint",
			text: t("PAGE_LAYOUT_ROW_HEIGHT_DESC"),
		});
		this.rowHeightInput = range;
		this.rowHeightValueEl = value;
	}

	private syncValues(state: PageInspectorState): void {
		const target = state.target;
		this.dashboardCrumbEl?.setText(target.dashboardName);
		this.pageCrumbEl?.setText(target.pageName);
		if (
			this.nameInput &&
			this.nameInput.ownerDocument.activeElement !== this.nameInput
		) {
			this.nameInput.value = target.pageName;
		}
		if (this.nameInput) this.nameInput.disabled = !state.editable;
		this.positionEl?.setText(
			t("PAGE_SETTINGS_POSITION", [
				String(target.index + 1),
				String(target.total),
			]),
		);
		this.componentsEl?.setText(
			t("PAGE_SETTINGS_COMPONENTS", [String(target.componentCount)]),
		);
		if (this.columnsSelect) {
			this.columnsSelect.value = String(target.columns);
			this.columnsSelect.disabled = !state.editable;
		}
		if (this.rowHeightInput) {
			this.rowHeightInput.value = String(target.rowHeight);
			this.rowHeightInput.disabled = !state.editable;
		}
		this.rowHeightValueEl?.setText(`${target.rowHeight}px`);
		if (this.menuButtonEl) {
			this.menuButtonEl.disabled = !state.editable;
		}
		this.state = state;
	}

	private commitName(): void {
		const input = this.nameInput;
		const target = this.state?.target;
		if (!input || !target) return;
		const name = input.value.trim();
		if (!name || name === target.pageName) return;
		this.deps.rename(name);
	}

	private applyFocus(state: PageInspectorState): void {
		if (!state.editable || !state.focus) return;
		if (state.focus === "name") {
			this.nameInput?.focus();
			this.nameInput?.select();
			return;
		}
		if (state.focus === "layout") {
			this.columnsSelect?.focus();
		}
	}

	private resetRefs(): void {
		this.state = null;
		this.dashboardCrumbEl = null;
		this.pageCrumbEl = null;
		this.nameInput = null;
		this.positionEl = null;
		this.componentsEl = null;
		this.columnsSelect = null;
		this.rowHeightInput = null;
		this.rowHeightValueEl = null;
		this.menuButtonEl = null;
	}
}
