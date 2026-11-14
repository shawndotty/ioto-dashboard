import { Menu, debounce, setIcon, type Debouncer } from "obsidian";
import { t } from "../../lang/helpers";
import type { InspectorState } from "../../dashboard/inspector-service";
import {
	clampSize,
	coerceSettingValue,
	queryTargetsFor,
	resolveSettingOptions,
	type ComponentSetting,
	type TargetPickerKind,
} from "../../dashboard/registry";
import {
	columnsForObject,
	parseColumnSelection,
	timelineColumnsForObject,
} from "../../dashboard/dataset/columns";
import {
	objectForComponentType,
	objectForQuery,
} from "../../dashboard/dataset/object";
import {
	columnMatchesAxis,
	fieldAxisFor,
} from "../../dashboard/dataset/field-roles";
import { settingsOf } from "../../dashboard/style-settings";
import type { DashboardComponentConfig } from "../../dashboard/types";
import {
	firstQueryOfTarget,
	groupByTarget,
	resolveQueryPicker,
} from "../../query/manager";
import type { QueryDefinition, QueryTarget } from "../../query/types";
import {
	queryDisplayName,
	queryFilterSummary,
	queryTargetLabel,
} from "../../ui/query-labels";

export interface ComponentInspectorDeps {
	patch(patch: Partial<DashboardComponentConfig>): void;
	stepSize(axis: "w" | "h", direction: -1 | 1): void;
	resetSize(): void;
	fitHeight?(): void;
	move(offset: -1 | 1): void;
	duplicate(): void;
	moveTo(): void;
	moveIntoContainer?(): void;
	moveOutOfContainer?(): void;
	dissolveContainer?(): void;
	remove(): void;
	openPageSettings?(): void;
	pickTarget?(picker: TargetPickerKind, key: string): void;
	describeTarget?(picker: TargetPickerKind, value: string): string;
}

type LabelKey = Parameters<typeof t>[0];

/** Placeholder shown while a color option is unset; the value is never stored. */
const COLOR_PLACEHOLDER = "#5772ff";

function readSettingValue(
	config: DashboardComponentConfig,
	setting: ComponentSetting,
): string | number | boolean | undefined {
	if ("target" in setting && setting.target === "options") {
		return config.options?.[setting.key];
	}
	return (config as unknown as Record<string, unknown>)[setting.key] as
		| string
		| number
		| boolean
		| undefined;
}

function writeSettingValue(
	patch: Partial<DashboardComponentConfig>,
	setting: ComponentSetting,
	value: string,
): void {
	if ("target" in setting && setting.target === "options") {
		patch.options = { ...(patch.options ?? {}), [setting.key]: value };
		return;
	}
	(patch as Record<string, unknown>)[setting.key] = value;
}

/**
 * Settings panel for one selected component. Reads everything from the passed
 * state and writes only through `deps` (never touches the repository directly).
 */
export class ComponentInspector {
	private root: HTMLElement;
	private signature = "";
	private state: InspectorState | null = null;
	private headerEl: HTMLElement | null = null;
	private menuButtonEl: HTMLButtonElement | null = null;
	private pageCrumbEl: HTMLAnchorElement | null = null;
	private titleCrumbEl: HTMLElement | null = null;
	private querySelect: HTMLSelectElement | null = null;
	private queryTypeSelect: HTMLSelectElement | null = null;
	private activeQueryTarget: QueryTarget | null = null;
	private queryHintEl: HTMLElement | null = null;
	/** Session-only type memory, never persisted. */
	private lastQueryByTarget = new Map<QueryTarget, string>();
	private lastComponentId: string | null = null;
	private basisSelect: HTMLSelectElement | null = null;
	private basisFallback: "file" | "section" = "file";
	private inputRefs = new Map<
		string,
		{
			input: HTMLInputElement | HTMLTextAreaElement;
			setting: ComponentSetting;
		}
	>();
	private colorRefs = new Map<
		string,
		{
			input: HTMLInputElement;
			reset: HTMLButtonElement;
			row: HTMLElement;
			setting: ComponentSetting;
		}
	>();
	private targetRefs = new Map<
		string,
		{
			valueEl: HTMLElement;
			pick: HTMLButtonElement;
			setting: Extract<ComponentSetting, { kind: "target" }>;
		}
	>();
	private titleInput: HTMLInputElement | null = null;
	private widthValueEl: HTMLElement | null = null;
	private heightValueEl: HTMLElement | null = null;
	private widthDecEl: HTMLButtonElement | null = null;
	private widthIncEl: HTMLButtonElement | null = null;
	private heightDecEl: HTMLButtonElement | null = null;
	private heightIncEl: HTMLButtonElement | null = null;
	private resetEl: HTMLButtonElement | null = null;
	private fitEl: HTMLButtonElement | null = null;
	private upEl: HTMLButtonElement | null = null;
	private downEl: HTMLButtonElement | null = null;
	private orderPositionEl: HTMLElement | null = null;
	private textDebouncers = new Set<Debouncer<[string], void>>();
	/** Session-only collapse state keyed by section title key, never persisted. */
	private collapsedSections = new Set<string>();

	constructor(
		container: HTMLElement,
		private deps: ComponentInspectorDeps,
	) {
		this.root = container.createDiv({ cls: "ioto-inspector" });
	}

	render(state: InspectorState | null): void {
		if (!state) {
			this.renderEmpty();
			return;
		}
		if (state.target.config.id !== this.lastComponentId) {
			this.lastComponentId = state.target.config.id;
			this.lastQueryByTarget.clear();
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
		this.cancelTextDebouncers();
		this.resetRefs();
		this.root.remove();
	}

	private signatureOf(state: InspectorState): string {
		const definition = state.target.definition;
		const config = state.target.config;
		const query = state.queries.find(
			(item) => item.id === config.queryId,
		);
		const context = { query, config };
		return [
			state.target.config.id,
			state.target.config.queryId,
			definition?.type ?? "__unknown__",
			state.editable ? "edit" : "view",
			(definition ? settingsOf(definition) : [])
				.map((setting) => {
					const shown = setting.when
						? setting.when(config, context)
							? "1"
							: "0"
						: "2";
					const deps = (setting.refreshOn ?? [])
						.map(
							(key) =>
								`${key}=${String(config.options?.[key] ?? "")}`,
						)
						.join("&");
					return `${setting.group}:${setting.kind}:${setting.key}:${shown}:${deps}`;
				})
				.join(","),
			String(state.queriesVersion),
		].join("|");
	}

	private renderEmpty(): void {
		if (this.signature === "empty") return;
		this.signature = "empty";
		this.cancelTextDebouncers();
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

	private build(state: InspectorState): void {
		this.cancelTextDebouncers();
		this.resetRefs();
		this.root.empty();
		this.root.toggleClass("is-readonly", !state.editable);

		this.headerEl = this.root.createDiv({ cls: "ioto-inspector-header" });
		this.buildBreadcrumb(this.headerEl, state);

		const definition = state.target.definition;
		if (!definition) {
			this.root.createDiv({
				cls: "ioto-inspector-message",
				text: t("INSPECTOR_UNKNOWN_COMPONENT"),
			});
			return;
		}
		this.createMenuButton(this.headerEl);
		if (!state.editable) {
			this.root.createDiv({
				cls: "ioto-inspector-hint",
				text: t("INSPECTOR_VIEW_MODE_HINT"),
			});
		}

		const query = state.queries.find(
			(item) => item.id === state.target.config.queryId,
		);
		const context = { query, config: state.target.config };
		const settings = settingsOf(definition).filter(
			(setting) =>
				!setting.when || setting.when(state.target.config, context),
		);
		const dataSettings = settings.filter(
			(setting) => setting.group === "data",
		);
		if (dataSettings.length > 0) {
			const section = this.createSection("INSPECTOR_SECTION_DATA");
			for (const setting of dataSettings) {
				this.buildSetting(section, setting, state);
			}
		}
		const axesXSettings = settings.filter(
			(setting) => setting.group === "axesX",
		);
		if (axesXSettings.length > 0) {
			const section = this.createSection("INSPECTOR_SECTION_AXIS_X");
			for (const setting of axesXSettings) {
				this.buildSetting(section, setting, state);
			}
		}
		const axesYSettings = settings.filter(
			(setting) => setting.group === "axesY",
		);
		if (axesYSettings.length > 0) {
			const section = this.createSection("INSPECTOR_SECTION_AXIS_Y");
			for (const setting of axesYSettings) {
				this.buildSetting(section, setting, state);
			}
		}
		const axesSettings = settings.filter(
			(setting) => setting.group === "axes",
		);
		if (axesSettings.length > 0) {
			const section = this.createSection("INSPECTOR_SECTION_AXIS");
			for (const setting of axesSettings) {
				this.buildSetting(section, setting, state);
			}
		}
		const displaySettings = settings.filter(
			(setting) => setting.group === "display",
		);
		if (displaySettings.length > 0) {
			const section = this.createSection("INSPECTOR_SECTION_DISPLAY");
			for (const setting of displaySettings) {
				this.buildSetting(section, setting, state);
			}
		}
		const styleSettings = settings.filter(
			(setting) => setting.group === "style",
		);
		if (styleSettings.length > 0) {
			const section = this.createSection("INSPECTOR_SECTION_STYLE");
			for (const setting of styleSettings) {
				this.buildSetting(section, setting, state);
			}
		}

		this.buildLayoutSection(state);
	}

	private createSection(
		titleKey: LabelKey,
		buildAction?: (head: HTMLElement) => void,
	): HTMLElement {
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

		// Head actions (layout reset) must stay siblings of the toggle button.
		buildAction?.(head);

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

	private buildSetting(
		section: HTMLElement,
		setting: ComponentSetting,
		state: InspectorState,
	): void {
		const field = section.createDiv({ cls: "ioto-inspector-field" });
		this.renderSettingControl(field, setting, state);
		if (setting.hintKey) {
			field.createDiv({
				cls: "ioto-inspector-hint",
				text: t(setting.hintKey as LabelKey),
			});
		}
	}

	private renderSettingControl(
		field: HTMLElement,
		setting: ComponentSetting,
		state: InspectorState,
	): void {
		switch (setting.kind) {
			case "query": {
				this.buildQuerySetting(field, setting, state);
				return;
			}
			case "basis": {
				field.createEl("label", { text: t("INSPECTOR_BASIS_LABEL") });
				const select = field.createEl("select", { cls: "dropdown" });
				select.createEl("option", {
					value: "file",
					text: t("KPI_BASIS_FILE"),
				});
				select.createEl("option", {
					value: "section",
					text: t("KPI_BASIS_SECTION"),
				});
				select.value =
					state.target.config.basis ?? setting.fallback;
				select.disabled = !state.editable;
				this.basisFallback = setting.fallback;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				select.addEventListener("change", () => {
					const patch = coerceSettingValue(
						setting,
						select.value,
						queryIds,
					);
					if (Object.keys(patch).length > 0) this.deps.patch(patch);
				});
				this.basisSelect = select;
				return;
			}
			case "number": {
				field.createEl("label", {
					text: t(
						(setting.labelKey ??
							"INSPECTOR_LIMIT_LABEL") as LabelKey,
					),
				});
				const input = field.createEl("input", {
					type: "number",
					attr: {
						min: String(setting.min),
						max: String(setting.max),
						step: String(setting.step ?? 1),
					},
				});
				const stored = this.storedSettingValue(state, setting);
				input.value = String(
					typeof stored === "number" ? stored : setting.fallback,
				);
				input.disabled = !state.editable;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				const commit = (): void => {
					const patch = coerceSettingValue(
						setting,
						input.value,
						queryIds,
					);
					if (setting.target === "options") {
						// A cleared row deletes the key, which restores the default.
						this.deps.patch(patch);
						return;
					}
					const value = (
						patch as Record<string, unknown>
					)[setting.key];
					if (typeof value !== "number") {
						input.value = String(
							typeof stored === "number"
								? stored
								: setting.fallback,
						);
						return;
					}
					input.value = String(value);
					this.deps.patch(patch);
				};
				input.addEventListener("change", commit);
				input.addEventListener("keydown", (event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					commit();
				});
				this.inputRefs.set(setting.key, { input, setting });
				return;
			}
			case "text": {
				field.createEl("label", {
					text: t(
						(setting.labelKey ??
							"INSPECTOR_TITLE_LABEL") as LabelKey,
					),
				});
				const input = field.createEl("input", {
					type: "text",
					attr: {
						placeholder: t(
							(setting.placeholderKey ??
								"INSPECTOR_TITLE_PLACEHOLDER") as LabelKey,
						),
					},
				});
				const stored = this.storedSettingValue(state, setting);
				input.value = typeof stored === "string" ? stored : "";
				input.disabled = !state.editable;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				const debouncer = debounce(
					(value: string) => {
						this.deps.patch(
							coerceSettingValue(setting, value, queryIds),
						);
					},
					300,
					true,
				);
				this.textDebouncers.add(debouncer);
				input.addEventListener("input", () => debouncer(input.value));
				input.addEventListener("keydown", (event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					debouncer.cancel();
					this.deps.patch(
						coerceSettingValue(setting, input.value, queryIds),
					);
				});
				if (setting.key === "title") this.titleInput = input;
				this.inputRefs.set(setting.key, { input, setting });
				return;
			}
			case "textarea": {
				field.createEl("label", {
					text: t(
						(setting.labelKey ??
							"INSPECTOR_TITLE_LABEL") as LabelKey,
					),
				});
				const area = field.createEl("textarea", {
					cls: "ioto-inspector-textarea",
					attr: {
						rows: "6",
						placeholder: t(
							(setting.placeholderKey ??
								"INSPECTOR_TITLE_PLACEHOLDER") as LabelKey,
						),
					},
				});
				const stored = this.storedSettingValue(state, setting);
				area.value = typeof stored === "string" ? stored : "";
				area.disabled = !state.editable;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				// textarea's change fires on blur: no rebuild while typing.
				const commit = (): void => {
					const patch = coerceSettingValue(
						setting,
						area.value,
						queryIds,
					);
					if (Object.keys(patch).length > 0) this.deps.patch(patch);
				};
				area.addEventListener("change", commit);
				area.addEventListener("keydown", (event) => {
					if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
						return;
					}
					event.preventDefault();
					commit();
				});
				this.inputRefs.set(setting.key, { input: area, setting });
				return;
			}
			case "field": {
				field.createEl("label", { text: t(setting.labelKey as LabelKey) });
				const select = field.createEl("select", { cls: "dropdown" });
				const options = this.fieldOptions(state, setting);
				const stored = this.storedSettingValue(state, setting);
				const desired =
					typeof stored === "string" ? stored : setting.fallback;
				const current = options.some(
					(option) => option.value === desired,
				)
					? desired
					: (options[0]?.value ?? setting.fallback);
				for (const option of options) {
					select.createEl("option", {
						value: option.value,
						text: t(option.labelKey as LabelKey),
					});
				}
				select.value = current;
				select.disabled = !state.editable;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				// 存量列可能不存在于新查询对象下：打开检查器时回写合法列。
				if (state.editable && typeof stored === "string" && stored !== current) {
					const patch = coerceSettingValue(
						setting,
						current,
						queryIds,
						undefined,
						state.target.config,
					);
					if (Object.keys(patch).length > 0) this.deps.patch(patch);
				}
				select.addEventListener("change", () => {
					const patch = coerceSettingValue(
						setting,
						select.value,
						queryIds,
						undefined,
						state.target.config,
					);
					if (Object.keys(patch).length === 0) return;
					this.deps.patch(this.withDependentFallbacks(state, patch));
				});
				return;
			}
			case "select": {
				field.createEl("label", { text: t(setting.labelKey as LabelKey) });
				const select = field.createEl("select", { cls: "dropdown" });
				const query = state.queries.find(
					(item) => item.id === state.target.config.queryId,
				);
				const options = resolveSettingOptions(setting, {
					query,
					config: state.target.config,
				});
				const stored = this.storedSettingValue(state, setting);
				const desired =
					typeof stored === "string" ? stored : setting.fallback;
				const current = options.some(
					(option) => option.value === desired,
				)
					? desired
					: (options[0]?.value ?? setting.fallback);
				for (const option of options) {
					select.createEl("option", {
						value: option.value,
						text: t(option.labelKey as LabelKey),
					});
				}
				select.value = current;
				select.disabled = !state.editable;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				// 存量非法值（例如换过查询对象）写回首个合法选项，避免「显示与存储不一致」。
				if (state.editable && typeof stored === "string" && stored !== current) {
					const patch = coerceSettingValue(
						setting,
						current,
						queryIds,
						query,
						state.target.config,
					);
					if (Object.keys(patch).length > 0) this.deps.patch(patch);
				}
				select.addEventListener("change", () => {
					const patch = coerceSettingValue(
						setting,
						select.value,
						queryIds,
						query,
						state.target.config,
					);
					if (Object.keys(patch).length === 0) return;
					this.deps.patch(this.withDependentFallbacks(state, patch));
				});
				return;
			}
			case "toggle": {
				field.addClass("is-inline");
				const row = field.createEl("label", {
					cls: "ioto-inspector-toggle",
				});
				row.createSpan({
					cls: "ioto-inspector-toggle-label",
					text: t(setting.labelKey as LabelKey),
				});
				const input = row.createEl("input", { type: "checkbox" });
				const stored = this.storedSettingValue(state, setting);
				input.checked =
					typeof stored === "boolean" ? stored : setting.fallback;
				input.disabled = !state.editable;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				input.addEventListener("change", () => {
					const patch = coerceSettingValue(
						setting,
						input.checked,
						queryIds,
					);
					if (Object.keys(patch).length > 0) this.deps.patch(patch);
				});
				return;
			}
			case "color": {
				const row = field.createDiv({ cls: "ioto-inspector-color-row" });
				row.createEl("label", {
					cls: "ioto-inspector-color-label",
					text: t(setting.labelKey as LabelKey),
				});
				const reset = row.createEl("button", {
					cls: "clickable-icon ioto-inspector-reset",
					attr: {
						type: "button",
						"aria-label": t("SETTING_STYLE_RESET_COLOR"),
						title: t("SETTING_STYLE_RESET_COLOR"),
					},
					text: "↺",
				});
				const input = row.createEl("input", {
					type: "color",
					attr: { "aria-label": t(setting.labelKey as LabelKey) },
				});
				// Unset colours show a placeholder swatch and hide the reset button.
				const apply = (stored: unknown): void => {
					const hasValue = typeof stored === "string";
					input.value = hasValue ? stored : COLOR_PLACEHOLDER;
					row.toggleClass("is-unset", !hasValue);
					reset.hidden = !hasValue;
				};
				apply(this.storedSettingValue(state, setting));
				input.disabled = !state.editable;
				reset.disabled = !state.editable;
				const queryIds = new Set(
					state.queries.map((query) => query.id),
				);
				input.addEventListener("change", () => {
					const patch = coerceSettingValue(
						setting,
						input.value,
						queryIds,
					);
					if (Object.keys(patch).length > 0) this.deps.patch(patch);
					apply(input.value);
				});
				reset.onClickEvent(() => {
					// `undefined` removes the options key, restoring the theme.
					this.deps.patch({
						options: { [setting.key]: undefined },
					} as unknown as Partial<DashboardComponentConfig>);
					apply(undefined);
				});
				this.colorRefs.set(setting.key, {
					input,
					reset,
					row,
					setting,
				});
				return;
			}
			case "target": {
				field.createEl("label", {
					text: t(setting.labelKey as LabelKey),
				});
				const row = field.createDiv({
					cls: "ioto-inspector-row ioto-inspector-target-row",
				});
				const valueEl = row.createDiv({
					cls: "ioto-inspector-target-value",
				});
				const pick = row.createEl("button", {
					cls: "ioto-inspector-target-pick",
					text: t("INSPECTOR_TARGET_PICK"),
					attr: { type: "button" },
				});
				pick.disabled = !state.editable;
				pick.onClickEvent(() =>
					this.deps.pickTarget?.(setting.picker, setting.key),
				);
				this.targetRefs.set(setting.key, { valueEl, pick, setting });
				return;
			}
			case "columns": {
				field.createEl("label", { text: t(setting.labelKey as LabelKey) });
				const query = state.queries.find(
					(item) => item.id === state.target.config.queryId,
				);
				const columns = columnsForObject(objectForQuery(query));
				if (columns.length === 0) return;
				const primary = columns[0]?.key ?? "";
				const stored = parseColumnSelection(
					this.storedSettingValue(state, setting),
				);
				const selected = new Set(
					stored ?? columns.map((column) => column.key),
				);
				const queryIds = new Set(
					state.queries.map((item) => item.id),
				);
				const list = field.createDiv({ cls: "ioto-inspector-columns" });
				const boxes: { key: string; input: HTMLInputElement }[] = [];
				for (const column of columns) {
					const row = list.createEl("label", {
						cls: "ioto-inspector-column",
					});
					const input = row.createEl("input", { type: "checkbox" });
					const fixed = column.key === primary;
					input.checked = fixed || selected.has(column.key);
					input.disabled = !state.editable || fixed;
					row.createSpan({ text: t(column.labelKey as LabelKey) });
					boxes.push({ key: column.key, input });
				}
				const commit = (): void => {
					const values = boxes
						.filter((box) => box.input.checked)
						.map((box) => box.key);
					this.deps.patch(
						coerceSettingValue(
							setting,
							values.length === columns.length ? [] : values,
							queryIds,
						),
					);
				};
				for (const box of boxes) {
					box.input.addEventListener("change", commit);
				}
				return;
			}
		}
	}

	private fieldOptions(
		state: InspectorState,
		setting: Extract<ComponentSetting, { kind: "field" }>,
	): Array<{ value: string; labelKey: string }> {
		const query = state.queries.find(
			(item) => item.id === state.target.config.queryId,
		);
		return this.fieldOptionsFor(
			query,
			state.target.definition?.type,
			setting,
		);
	}

	private fieldOptionsFor(
		query: QueryDefinition | undefined,
		type: string | undefined,
		setting: Extract<ComponentSetting, { kind: "field" }>,
	): Array<{ value: string; labelKey: string }> {
		// Bars, pies and donuts aggregate task/note queries per project; scatter
		// charts read per-record rows. Line charts read time-series columns.
		const object =
			type === "line-chart"
				? objectForQuery(query)
				: objectForComponentType(type, query);
		const columns =
			type === "line-chart"
				? timelineColumnsForObject(object)
				: columnsForObject(object);
		const axis = fieldAxisFor({
			role: setting.role,
			axisType: setting.axisType,
		});
		return columns
			.filter((column) => columnMatchesAxis(column, axis))
			.map((column) => ({
				value: column.key,
				labelKey: column.labelKey,
			}));
	}

	private buildQuerySetting(
		field: HTMLElement,
		setting: ComponentSetting,
		state: InspectorState,
	): void {
		const definition = state.target.definition;
		const allowed = definition ? queryTargetsFor(definition) : [];
		const model = resolveQueryPicker(
			allowed,
			state.queries,
			state.target.config.queryId,
			this.activeQueryTarget,
		);
		const { groups } = model;
		const queryIds = new Set(state.queries.map((query) => query.id));
		let activeTarget = model.activeTarget;
		this.activeQueryTarget = activeTarget;

		field.createEl("label", { text: t("INSPECTOR_QUERY_LABEL") });
		const row = field.createDiv({ cls: "ioto-inspector-query-row" });

		let typeSelect: HTMLSelectElement | null = null;
		if (model.needsTypeSelect) {
			typeSelect = row.createEl("select", {
				cls: "dropdown ioto-inspector-query-type",
				attr: { "aria-label": t("INSPECTOR_QUERY_TYPE_LABEL") },
			});
			for (const target of model.targets) {
				const option = typeSelect.createEl("option", {
					value: target,
					text: `${queryTargetLabel(target)} (${groups[target].length})`,
				});
				option.selected = target === activeTarget;
				if (
					groups[target].length === 0 ||
					(model.legacy &&
						target !== activeTarget &&
						!allowed.includes(target))
				) {
					option.disabled = true;
				}
			}
			typeSelect.value = activeTarget;
			typeSelect.disabled = !state.editable;
		}

		const select = row.createEl("select", {
			cls: "dropdown ioto-inspector-query-value",
		});
		this.populateQueryOptions(
			select,
			activeTarget,
			groups,
			state,
			model.missing ? state.target.config.queryId : null,
		);
		select.disabled = !state.editable;

		typeSelect?.addEventListener("change", () => {
			const nextTarget = typeSelect.value as QueryTarget;
			const previousTarget = this.activeQueryTarget ?? activeTarget;
			if (groups[nextTarget].length === 0) {
				typeSelect.value = previousTarget;
				return;
			}
			const rememberedId = this.lastQueryByTarget.get(nextTarget);
			const next =
				groups[nextTarget].find((query) => query.id === rememberedId) ??
				firstQueryOfTarget(state.queries, nextTarget);
			if (!next) {
				typeSelect.value = previousTarget;
				return;
			}
			const patch = coerceSettingValue(setting, next.id, queryIds);
			if (Object.keys(patch).length === 0) {
				typeSelect.value = previousTarget;
				return;
			}
			activeTarget = nextTarget;
			this.activeQueryTarget = nextTarget;
			this.populateQueryOptions(select, nextTarget, groups, state, null);
			select.value = next.id;
			this.deps.patch(this.withDependentFallbacks(state, patch));
		});

		select.addEventListener("change", () => {
			const patch = coerceSettingValue(setting, select.value, queryIds);
			if (Object.keys(patch).length === 0) return;
			this.lastQueryByTarget.set(
				this.activeQueryTarget ?? activeTarget,
				select.value,
			);
			this.deps.patch(this.withDependentFallbacks(state, patch));
		});

		this.querySelect = select;
		this.queryTypeSelect = typeSelect;

		const hintKey = model.legacy
			? "INSPECTOR_QUERY_INCOMPATIBLE"
			: model.missing
				? "INSPECTOR_QUERY_MISSING"
				: null;
		if (hintKey) {
			const hint = field.createDiv({
				cls: "ioto-inspector-hint ioto-inspector-query-hint",
				attr: { role: "status" },
			});
			hint.setText(
				model.legacy
					? t("INSPECTOR_QUERY_INCOMPATIBLE", [
							queryTargetLabel(
								model.current?.target ?? activeTarget,
							),
						])
					: t("INSPECTOR_QUERY_MISSING"),
			);
			this.queryHintEl = hint;
		} else {
			const current = state.queries.find((query) => query.id === select.value);
			const summary = current ? queryFilterSummary(current) : "";
			if (summary) {
				field.createDiv({
					cls: "ioto-inspector-hint ioto-inspector-query-summary",
					text: summary,
				});
			}
		}
	}

	/**
	 * Keeps dependent rows valid in the same patch: switching query, range or
	 * Y field can leave a stored select/field value the new context cannot offer.
	 * One merged patch avoids consecutive re-renders; unset values and hidden
	 * rows are skipped so defaults never get written into the config.
	 */
	private withDependentFallbacks(
		state: InspectorState,
		patch: Partial<DashboardComponentConfig>,
	): Partial<DashboardComponentConfig> {
		const definition = state.target.definition;
		if (!definition) return patch;
		const config = state.target.config;
		const merged = {
			...config,
			...patch,
			options: { ...(config.options ?? {}), ...(patch.options ?? {}) },
		} as DashboardComponentConfig;
		const query = state.queries.find((item) => item.id === merged.queryId);
		const context = { query, config: merged };
		const result: Partial<DashboardComponentConfig> = { ...patch };
		for (const setting of settingsOf(definition)) {
			if (setting.when && !setting.when(merged, context)) continue;
			if (setting.kind !== "select" && setting.kind !== "field") continue;
			const stored = readSettingValue(merged, setting);
			if (typeof stored !== "string") continue;
			const options =
				setting.kind === "select"
					? resolveSettingOptions(setting, context)
					: this.fieldOptionsFor(query, definition.type, setting);
			if (options.some((option) => option.value === stored)) continue;
			const preferred =
				setting.kind === "select" && setting.key === "measure"
					? (definition.measureDefault ?? setting.fallback)
					: setting.fallback;
			const fallback = options.some((option) => option.value === preferred)
				? preferred
				: options[0]?.value;
			if (fallback) writeSettingValue(result, setting, fallback);
		}
		return result;
	}

	private populateQueryOptions(
		select: HTMLSelectElement,
		target: QueryTarget,
		groups: Record<QueryTarget, QueryDefinition[]>,
		state: InspectorState,
		missingId: string | null,
	): void {
		select.empty();
		if (missingId) {
			select.createEl("option", { value: missingId, text: missingId });
		}
		for (const query of groups[target]) {
			const label = queryDisplayName(query);
			select.createEl("option", {
				value: query.id,
				text: label,
				attr: { title: label },
			});
		}
		const desired = missingId ?? state.target.config.queryId;
		if (Array.from(select.options).some((option) => option.value === desired)) {
			select.value = desired;
		}
	}

	private buildLayoutSection(state: InspectorState): void {
		const section = this.createSection("INSPECTOR_SECTION_LAYOUT", (head) => {
			const reset = head.createEl("button", {
				cls: "clickable-icon ioto-inspector-reset",
				attr: {
					type: "button",
					"aria-label": t("DASHBOARD_RESET_SIZE"),
					title: t("DASHBOARD_RESET_SIZE"),
				},
				text: "↺",
			});
			reset.onClickEvent(() => this.deps.resetSize());
			this.resetEl = reset;
		});

		const width = this.buildSizeRow(
			section,
			t("DASHBOARD_WIDTH"),
			"w",
		);
		this.widthDecEl = width.dec;
		this.widthValueEl = width.value;
		this.widthIncEl = width.inc;

		const height = this.buildSizeRow(
			section,
			t("DASHBOARD_HEIGHT"),
			"h",
		);
		this.heightDecEl = height.dec;
		this.heightValueEl = height.value;
		this.heightIncEl = height.inc;

		if (state.target.config.type === "container" && state.target.depth === 0) {
			const row = section.createDiv({ cls: "ioto-inspector-row" });
			const fit = row.createEl("button", {
				cls: "ioto-inspector-fit",
				text: t("DASHBOARD_FIT_CONTENT_HEIGHT"),
				attr: { type: "button" },
			});
			fit.onClickEvent(() => this.deps.fitHeight?.());
			this.fitEl = fit;
		}

		const order = section.createDiv({ cls: "ioto-inspector-row" });
		order.createSpan({
			cls: "ioto-inspector-row-label",
			text: t("INSPECTOR_ORDER_LABEL"),
		});
		const orderButtons = order.createDiv({
			cls: "ioto-inspector-order-buttons",
		});
		this.upEl = this.createStepButton(
			orderButtons,
			"↑",
			t("DASHBOARD_MOVE_UP"),
			() => this.deps.move(-1),
		);
		this.downEl = this.createStepButton(
			orderButtons,
			"↓",
			t("DASHBOARD_MOVE_DOWN"),
			() => this.deps.move(1),
		);
		this.orderPositionEl = order.createSpan({
			cls: "ioto-inspector-order-position",
		});
	}

	private buildSizeRow(
		section: HTMLElement,
		label: string,
		axis: "w" | "h",
	): {
		dec: HTMLButtonElement;
		value: HTMLElement;
		inc: HTMLButtonElement;
	} {
		const row = section.createDiv({ cls: "ioto-inspector-row" });
		row.createSpan({ cls: "ioto-inspector-row-label", text: label });
		const stepper = row.createDiv({ cls: "ioto-inspector-stepper" });
		const dec = this.createStepButton(
			stepper,
			"−",
			`${t("DASHBOARD_DECREASE")} ${label}`,
			() => this.deps.stepSize(axis, -1),
		);
		const value = stepper.createSpan({ cls: "ioto-inspector-value" });
		const inc = this.createStepButton(
			stepper,
			"+",
			`${t("DASHBOARD_INCREASE")} ${label}`,
			() => this.deps.stepSize(axis, 1),
		);
		return { dec, value, inc };
	}

	private createStepButton(
		container: HTMLElement,
		label: string,
		ariaLabel: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = container.createEl("button", {
			cls: "ioto-inspector-step",
			attr: {
				type: "button",
				"aria-label": ariaLabel,
				title: ariaLabel,
			},
			text: label,
		});
		button.onClickEvent(onClick);
		return button;
	}

	private createMenuButton(header: HTMLElement): void {
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
		this.menuButtonEl = button;
	}

	private openMoreMenu(
		event: MouseEvent,
		button: HTMLButtonElement,
	): void {
		const state = this.state;
		if (!state?.editable || !state.target.definition) return;
		const componentId = state.target.config.id;
		const target = state.target;
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(t("DASHBOARD_DUPLICATE_COMPONENT"))
				.setIcon("copy")
				.onClick(() => {
					if (this.state?.target.config.id !== componentId) return;
					this.deps.duplicate();
				});
		});
		// Children cannot change pages on their own; the container moves as a whole.
		if (target.depth === 0) {
			menu.addItem((item) => {
				item.setTitle(t("DASHBOARD_MOVE_COMPONENT"))
					.setIcon("arrow-right-left")
					.onClick(() => {
						if (this.state?.target.config.id !== componentId) return;
						this.deps.moveTo();
					});
			});
		}
		if (
			target.depth === 0 &&
			target.hasContainers &&
			target.config.type !== "container"
		) {
			menu.addItem((item) => {
				item.setTitle(t("DASHBOARD_MOVE_INTO_CONTAINER"))
					.setIcon("panel-top-open")
					.onClick(() => {
						if (this.state?.target.config.id !== componentId) return;
						this.deps.moveIntoContainer?.();
					});
			});
		}
		if (target.parentId !== null) {
			menu.addItem((item) => {
				item.setTitle(t("DASHBOARD_MOVE_OUT_OF_CONTAINER"))
					.setIcon("panel-top-close")
					.onClick(() => {
						if (this.state?.target.config.id !== componentId) return;
						this.deps.moveOutOfContainer?.();
					});
			});
		}
		if (target.config.type === "container") {
			menu.addItem((item) => {
				item.setTitle(t("DASHBOARD_DISSOLVE_CONTAINER"))
					.setIcon("ungroup")
					.onClick(() => {
						if (this.state?.target.config.id !== componentId) return;
						this.deps.dissolveContainer?.();
					});
			});
		}
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle(t("DASHBOARD_CONFIG_REMOVE"))
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					if (this.state?.target.config.id !== componentId) return;
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

	private syncValues(state: InspectorState): void {
		const { config, bounds, defaults } = state.target;
		if (this.pageCrumbEl) {
			this.pageCrumbEl.setText(state.target.pageName);
			const enabled = state.editable && !!this.deps.openPageSettings;
			this.pageCrumbEl.toggleClass("is-disabled", !enabled);
			this.pageCrumbEl.setAttr("aria-disabled", String(!enabled));
			this.pageCrumbEl.tabIndex = enabled ? 0 : -1;
		}
		this.titleCrumbEl?.setText(this.titleText(state));
		if (this.querySelect) {
			const current = state.queries.find(
				(query) => query.id === config.queryId,
			);
			const nextTarget = current?.target ?? this.activeQueryTarget;
			if (nextTarget && nextTarget !== this.activeQueryTarget) {
				this.activeQueryTarget = nextTarget;
				this.populateQueryOptions(
					this.querySelect,
					nextTarget,
					groupByTarget(state.queries),
					state,
					current ? null : config.queryId,
				);
			}
			this.querySelect.value = config.queryId;
			this.querySelect.disabled = !state.editable;
		}
		if (this.queryTypeSelect) {
			const target = this.activeQueryTarget;
			if (
				target &&
				!Array.from(this.queryTypeSelect.options).some(
					(option) => option.value === target,
				)
			) {
				const option = this.queryTypeSelect.createEl("option", {
					value: target,
					text: `${queryTargetLabel(target)} (${groupByTarget(state.queries)[target].length})`,
				});
				option.disabled = true;
			}
			this.queryTypeSelect.value = target ?? "";
			this.queryTypeSelect.disabled = !state.editable;
		}
		if (this.basisSelect) {
			this.basisSelect.value = config.basis ?? this.basisFallback;
			this.basisSelect.disabled = !state.editable;
		}
		for (const [, entry] of this.inputRefs) {
			const { input, setting } = entry;
			if (input.ownerDocument.activeElement !== input) {
				const stored = this.storedSettingValue(state, setting);
				if (setting.kind === "number") {
					input.value = String(
						typeof stored === "number"
							? stored
							: setting.fallback,
					);
				} else if (
					setting.kind === "text" ||
					setting.kind === "textarea"
				) {
					input.value = typeof stored === "string" ? stored : "";
				}
			}
			input.disabled = !state.editable;
		}
		for (const [, entry] of this.colorRefs) {
			const { input, reset, row, setting } = entry;
			const stored = this.storedSettingValue(state, setting);
			const hasValue = typeof stored === "string";
			if (hasValue && input.ownerDocument.activeElement !== input) {
				input.value = stored;
			}
			if (!hasValue) input.value = COLOR_PLACEHOLDER;
			row.toggleClass("is-unset", !hasValue);
			reset.hidden = !hasValue;
			input.disabled = !state.editable;
			reset.disabled = !state.editable;
		}
		for (const [, entry] of this.targetRefs) {
			const stored = this.storedSettingValue(state, entry.setting);
			const value = typeof stored === "string" ? stored : "";
			const label = value
				? (this.deps.describeTarget?.(entry.setting.picker, value) ??
					value)
				: t("INSPECTOR_TARGET_EMPTY");
			entry.valueEl.setText(label);
			entry.valueEl.toggleClass("is-empty", !value);
			entry.pick.disabled = !state.editable;
		}

		const size = clampSize(config.w, config.h, bounds);
		const widthText = `${t("DASHBOARD_WIDTH")}: ${size.w} (${bounds.minW}–${bounds.maxW})`;
		this.widthValueEl?.setText(String(size.w));
		if (this.widthValueEl) {
			this.widthValueEl.setAttr("title", widthText);
			this.widthValueEl.setAttr("aria-label", widthText);
		}
		const heightText = `${t("DASHBOARD_HEIGHT")}: ${size.h} (${bounds.minH}–${bounds.maxH})`;
		this.heightValueEl?.setText(String(size.h));
		if (this.heightValueEl) {
			this.heightValueEl.setAttr("title", heightText);
			this.heightValueEl.setAttr("aria-label", heightText);
		}
		this.orderPositionEl?.setText(
			`${state.target.index + 1} / ${state.target.total}`,
		);
		if (this.widthDecEl) {
			this.widthDecEl.disabled = !state.editable || size.w <= bounds.minW;
		}
		if (this.widthIncEl) {
			this.widthIncEl.disabled = !state.editable || size.w >= bounds.maxW;
		}
		if (this.heightDecEl) {
			this.heightDecEl.disabled = !state.editable || size.h <= bounds.minH;
		}
		if (this.heightIncEl) {
			this.heightIncEl.disabled = !state.editable || size.h >= bounds.maxH;
		}
		if (this.resetEl) {
			this.resetEl.disabled =
				!state.editable ||
				(size.w === defaults.w && size.h === defaults.h);
		}
		if (this.fitEl) {
			this.fitEl.disabled =
				!state.editable ||
				(state.target.config.children?.length ?? 0) === 0;
		}
		if (this.upEl) {
			this.upEl.disabled = !state.editable || state.target.index <= 0;
		}
		if (this.downEl) {
			this.downEl.disabled =
				!state.editable ||
				state.target.index >= state.target.total - 1;
		}
		this.state = state;
		if (this.menuButtonEl) {
			this.menuButtonEl.disabled = !state.editable;
		}
	}

	private storedSettingValue(
		state: InspectorState,
		setting: ComponentSetting,
	): string | number | boolean | undefined {
		return readSettingValue(state.target.config, setting);
	}

	private buildBreadcrumb(
		header: HTMLElement,
		state: InspectorState,
	): void {
		const breadcrumb = header.createDiv({
			cls: "ioto-inspector-breadcrumb",
		});
		const page = breadcrumb.createEl("a", {
			cls: "ioto-inspector-crumb",
			attr: {
				role: "link",
				tabindex: "0",
				title: t("INSPECTOR_OPEN_PAGE_SETTINGS"),
			},
			text: state.target.pageName,
		});
		const openPage = (): void => {
			if (!this.state?.editable || !this.deps.openPageSettings) return;
			this.deps.openPageSettings();
		};
		page.onClickEvent(openPage);
		page.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			openPage();
		});
		breadcrumb.createSpan({
			cls: "ioto-inspector-crumb-sep",
			attr: { "aria-hidden": "true" },
			text: "›",
		});
		const title = breadcrumb.createSpan({
			cls: "ioto-inspector-crumb-current",
		});
		this.pageCrumbEl = page;
		this.titleCrumbEl = title;
	}

	private titleText(state: InspectorState): string {
		const { config, definition } = state.target;
		return config.title
			? config.title
			: definition
				? t(definition.labelKey as LabelKey)
				: config.type;
	}

	private applyFocus(state: InspectorState): void {
		const focus = state.focus;
		if (!focus || !state.editable) return;
		if (focus === "title" && this.titleInput) {
			this.titleInput.focus();
			this.titleInput.select();
			return;
		}
		if (this.querySelect) {
			const section = this.querySelect.closest<HTMLElement>(
				".ioto-inspector-section",
			);
			if (section?.hasClass("is-collapsed")) {
				this.setSectionCollapsed(section, false);
			}
			this.querySelect.focus();
			return;
		}
		const first = this.root.querySelector<HTMLElement>(
			".ioto-inspector-section:not(.is-collapsed) select, " +
				".ioto-inspector-section:not(.is-collapsed) input",
		);
		first?.focus();
	}

	private cancelTextDebouncers(): void {
		for (const debouncer of this.textDebouncers) debouncer.cancel();
		this.textDebouncers.clear();
	}

	private resetRefs(): void {
		this.basisFallback = "file";
		this.state = null;
		this.headerEl = null;
		this.menuButtonEl = null;
		this.pageCrumbEl = null;
		this.titleCrumbEl = null;
		this.querySelect = null;
		this.queryTypeSelect = null;
		this.activeQueryTarget = null;
		this.queryHintEl = null;
		this.basisSelect = null;
		this.inputRefs.clear();
		this.colorRefs.clear();
		this.targetRefs.clear();
		this.titleInput = null;
		this.widthValueEl = null;
		this.heightValueEl = null;
		this.widthDecEl = null;
		this.widthIncEl = null;
		this.heightDecEl = null;
		this.heightIncEl = null;
		this.resetEl = null;
		this.fitEl = null;
		this.upEl = null;
		this.downEl = null;
		this.orderPositionEl = null;
	}
}
