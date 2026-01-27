import { App, Modal, Setting, ButtonComponent } from "obsidian";
import { t } from "../lang/helpers";

export class ConfirmModal extends Modal {
	title: string;
	message: string;
	onConfirm: () => void;

	constructor(
		app: App,
		title: string,
		message: string,
		onConfirm: () => void
	) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		const btnContainer = contentEl.createDiv({
			cls: "confirm-modal-buttons",
		});
		btnContainer.style.display = "flex";
		btnContainer.style.justifyContent = "flex-end";
		btnContainer.style.gap = "10px";
		btnContainer.style.marginTop = "20px";

		new ButtonComponent(btnContainer)
			.setButtonText(t("BTN_CANCEL"))
			.onClick(() => {
				this.close();
			});

		new ButtonComponent(btnContainer)
			.setButtonText(t("BTN_CONFIRM"))
			.setCta()
			.onClick(() => {
				this.onConfirm();
				this.close();
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
