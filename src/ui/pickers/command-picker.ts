import {
	App,
	Command,
	FuzzyMatch,
	FuzzySuggestModal,
	Platform,
	setIcon,
} from "obsidian";
import { t } from "../../lang/helpers";

export class CommandPickerModal extends FuzzySuggestModal<Command> {
	constructor(
		app: App,
		private onChooseCommand: (command: Command) => void,
	) {
		super(app);
		this.setPlaceholder(t("PICKER_COMMAND_PLACEHOLDER"));
	}

	getItems(): Command[] {
		const commands = this.app.commands.listCommands();
		const visible = Platform.isMobile
			? commands
			: commands.filter((command) => !command.mobileOnly);
		return visible.sort((a, b) => a.name.localeCompare(b.name));
	}

	getItemText(command: Command): string {
		return command.name;
	}

	renderSuggestion(match: FuzzyMatch<Command>, el: HTMLElement): void {
		const icon = el.createSpan({ cls: "ioto-command-picker-icon" });
		setIcon(icon, match.item.icon ?? "terminal");
		const text = el.createSpan({ cls: "ioto-command-picker-name" });
		text.setText(match.item.name);
		if (match.item.id.startsWith("app:")) {
			el.createSpan({
				cls: "ioto-command-picker-badge",
				text: t("PICKER_COMMAND_SYSTEM_BADGE"),
			});
		}
	}

	onChooseItem(command: Command): void {
		this.onChooseCommand(command);
	}

	onNoSuggestion(): void {
		this.resultContainerEl.empty();
		this.resultContainerEl.createDiv({
			cls: "suggestion-empty",
			text: t("PICKER_NO_COMMANDS_FOUND"),
		});
	}
}
