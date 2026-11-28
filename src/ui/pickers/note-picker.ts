import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../../lang/helpers";
import { firstAlias } from "../../data/note-source";

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
		// Keep the path in the match text so filename/path searches still hit.
		const frontmatter = this.app.metadataCache.getFileCache(file)
			?.frontmatter as Record<string, unknown> | undefined;
		const alias = firstAlias(frontmatter);
		return alias ? `${alias} · ${file.path}` : file.path;
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
