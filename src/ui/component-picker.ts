import { App, Modal } from "obsidian";
import type { ComponentCategory, ComponentDefinition } from "../dashboard/registry";
import { t } from "../lang/helpers";
import {
	type CollectionItem,
	type CollectionLayout,
	renderCollection,
} from "./collection-view";
import { applyModalShell, createLayoutToggle } from "./modal-shell";

export interface ComponentPickerPreferences {
	layout: CollectionLayout;
	onLayoutChange(layout: CollectionLayout): void;
}

const CATEGORY_ORDER: ComponentCategory[] = [
	"overview",
	"analysis",
	"navigation",
	"utility",
];

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
	overview: "COMPONENT_CATEGORY_OVERVIEW",
	analysis: "COMPONENT_CATEGORY_ANALYSIS",
	navigation: "COMPONENT_CATEGORY_NAVIGATION",
	utility: "COMPONENT_CATEGORY_UTILITY",
};

export class ComponentPickerModal extends Modal {
	private layout: CollectionLayout;
	private bodyEl: HTMLElement | null = null;
	private query = "";

	constructor(
		app: App,
		private definitions: ComponentDefinition[],
		private onChoose: (definition: ComponentDefinition) => void,
		private preferences?: ComponentPickerPreferences,
	) {
		super(app);
		this.layout = preferences?.layout ?? "card";
	}

	onOpen(): void {
		applyModalShell(this, {
			kind: "component-picker",
			restore: true,
			title: t("COMPONENT_PICKER_TITLE"),
		});

		if (this.preferences) {
			createLayoutToggle(this, this.layout, (layout) => {
				this.layout = layout;
				this.preferences?.onLayoutChange(layout);
				this.renderItems();
			});
		}

		if (this.definitions.length === 0) {
			this.contentEl.createEl("p", { text: t("DASHBOARD_EMPTY_RESULT") });
			return;
		}

		const body = this.contentEl.createDiv({ cls: "ioto-modal-body" });
		const search = body.createEl("input", {
			cls: "ioto-picker-search",
			attr: {
				type: "search",
				placeholder: t("COMPONENT_PICKER_SEARCH"),
				"aria-label": t("COMPONENT_PICKER_SEARCH"),
			},
		});
		search.addEventListener("input", () => {
			this.query = search.value.trim().toLowerCase();
			this.renderItems();
		});
		this.bodyEl = body.createDiv({ cls: "ioto-modal-collection" });
		this.renderItems();
	}

	private labelOf(definition: ComponentDefinition): string {
		return t(definition.labelKey as Parameters<typeof t>[0]);
	}

	private descriptionOf(definition: ComponentDefinition): string {
		return t(definition.descriptionKey as Parameters<typeof t>[0]);
	}

	private matches(definition: ComponentDefinition): boolean {
		if (this.query.length === 0) return true;
		return (
			this.labelOf(definition).toLowerCase().includes(this.query) ||
			this.descriptionOf(definition).toLowerCase().includes(this.query)
		);
	}

	private renderItems(): void {
		const body = this.bodyEl;
		if (!body) return;
		body.empty();

		const visible = this.definitions.filter((definition) =>
			this.matches(definition),
		);
		if (visible.length === 0) {
			body.createEl("p", { text: t("DASHBOARD_EMPTY_RESULT") });
			return;
		}

		const groups = new Map<ComponentCategory, ComponentDefinition[]>();
		for (const definition of visible) {
			const category = definition.category ?? "overview";
			const list = groups.get(category) ?? [];
			list.push(definition);
			groups.set(category, list);
		}

		for (const category of CATEGORY_ORDER) {
			const definitions = groups.get(category);
			if (!definitions || definitions.length === 0) continue;
			body.createDiv({
				cls: "ioto-picker-group-title",
				text: t(CATEGORY_LABELS[category] as Parameters<typeof t>[0]),
			});
			const container = body.createDiv({ cls: "ioto-picker-group" });
			const items: CollectionItem[] = definitions.map((definition) => ({
				id: definition.type,
				icon: definition.icon ?? "component",
				title: this.labelOf(definition),
				description: this.descriptionOf(definition),
				primaryLabel: `${t("DASHBOARD_ADD_COMPONENT")} · ${this.labelOf(definition)}`,
				primaryIcon: "plus",
				onPrimary: () => {
					this.onChoose(definition);
					this.close();
				},
				actions: [],
			}));
			renderCollection(container, items, this.layout);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
