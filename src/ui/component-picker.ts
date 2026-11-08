import { App, Modal } from "obsidian";
import type { ComponentDefinition } from "../dashboard/registry";
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

export class ComponentPickerModal extends Modal {
	private layout: CollectionLayout;
	private bodyEl: HTMLElement | null = null;

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
		this.bodyEl = body.createDiv({ cls: "ioto-modal-collection" });
		this.renderItems();
	}

	private renderItems(): void {
		if (!this.bodyEl) return;

		const items: CollectionItem[] = this.definitions.map((definition) => ({
			id: definition.type,
			icon: "layout-dashboard",
			title: t(definition.labelKey as Parameters<typeof t>[0]),
			description: t(
				definition.descriptionKey as Parameters<typeof t>[0],
			),
			primaryLabel: t("DASHBOARD_ADD_COMPONENT"),
			onPrimary: () => {
				this.onChoose(definition);
				this.close();
			},
			actions: [],
		}));

		renderCollection(this.bodyEl, items, this.layout);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
