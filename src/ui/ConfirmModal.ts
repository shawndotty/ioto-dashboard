import { App, Modal, ButtonComponent } from "obsidian";
import { t } from "../lang/helpers";

export interface ConfirmDetailGroup {
	title: string;
	items: { text: string; level: "info" | "warn" | "error" }[];
}

export class ConfirmModal extends Modal {
	title: string;
	message: string;
	onConfirm: () => void;
	details?: ConfirmDetailGroup[];

	constructor(
		app: App,
		title: string,
		message: string,
		onConfirm: () => void,
		details?: ConfirmDetailGroup[]
	) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
		this.details = details;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.title });
		const messageEl = contentEl.createEl("p", { text: this.message });
		messageEl.setCssStyles({ whiteSpace: "pre-line" });
		if (this.details?.length) {
			const wrap = contentEl.createDiv();
			wrap.setCssStyles({ display: "flex", flexDirection: "column", gap: "8px" });
			for (const group of this.details) {
				const box = wrap.createDiv({ cls: "ioto-transfer-warnings" });
				box.createEl("strong", { text: group.title });
				const list = box.createEl("ul");
				for (const item of group.items) {
					list.createEl("li", { cls: `is-${item.level}`, text: item.text });
				}
			}
		}

		const btnContainer = contentEl.createDiv({
			cls: "confirm-modal-buttons",
		});
		btnContainer.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" });

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
