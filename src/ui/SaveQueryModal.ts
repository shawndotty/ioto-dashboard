import { App, Modal, Setting } from "obsidian";
import { t } from "../lang/helpers";

export class SaveQueryModal extends Modal {
	queryName: string = "";
	initialName: string = "";
	onSubmit: (name: string) => void;
	title: string;

	constructor(
		app: App,
		title: string,
		initialName: string = "",
		onSubmit: (name: string) => void,
	) {
		super(app);
		this.title = title;
		this.initialName = initialName;
		this.queryName = initialName;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: this.title });

		new Setting(contentEl)
			.setName(t("MODAL_SAVE_NAME_LABEL"))
			.addText((text) =>
				text
					.setPlaceholder(t("MODAL_SAVE_PLACEHOLDER"))
					.setValue(this.initialName)
					.onChange((value) => {
						this.queryName = value;
					}),
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					if (this.queryName.trim()) {
						this.onSubmit(this.queryName);
						this.close();
					}
				}),
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
