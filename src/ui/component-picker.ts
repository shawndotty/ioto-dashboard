import { App, Modal, Setting } from "obsidian";
import type { ComponentDefinition } from "../dashboard/registry";
import { t } from "../lang/helpers";

export class ComponentPickerModal extends Modal {
	constructor(
		app: App,
		private definitions: ComponentDefinition[],
		private onChoose: (definition: ComponentDefinition) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("COMPONENT_PICKER_TITLE") });
		if (this.definitions.length === 0) {
			contentEl.createEl("p", { text: t("DASHBOARD_EMPTY_RESULT") });
			return;
		}
		for (const definition of this.definitions) {
			new Setting(contentEl)
				.setName(t(definition.labelKey as Parameters<typeof t>[0]))
				.setDesc(
					t(definition.descriptionKey as Parameters<typeof t>[0]),
				)
				.addButton((button) =>
					button
						.setButtonText(t("DASHBOARD_ADD_COMPONENT"))
						.setCta()
						.onClick(() => {
							this.onChoose(definition);
							this.close();
						}),
				);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
