import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../../lang/helpers";

export class NotePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private onChooseNote: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t("PICKER_NOTE_PLACEHOLDER"));
	}

	getItems(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChooseNote(file);
	}

	onNoSuggestion(): void {
		this.resultContainerEl.empty();
		this.resultContainerEl.createDiv({
			cls: "suggestion-empty",
			text: t("PICKER_NO_NOTES_FOUND"),
		});
	}
}
