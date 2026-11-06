import { App } from "obsidian";

export interface IotoSettings {
	// Folder paths
	inputFolder?: string;
	outputFolder?: string;
	taskFolder?: string;
	outcomeFolder?: string;
	extraFolder?: string;
	IOTOFrameworkPath?: string;

	// TDL Settings
	defaultTDLDateFormat?: string;
	defaultTDLHeadingLevel?: number;
	addLinkToCurrentTDL?: boolean;

	// Input Settings
	inputNoteNamePrefix?: string;
	inputNoteNamePostfix?: string;
	newInputNoteFollowUpAction?: number;
	addNewInputNoteToTDL?: boolean;

	// Output Settings
	outputNoteNamePrefix?: string;
	outputNoteNamePostfix?: string;
	newOutputNoteFollowUpAction?: number;
	addNewOutputNoteToTDL?: boolean;

	// Outcome Settings
	outcomeNoteNamePrefix?: string;
	outcomeNoteNamePostfix?: string;
	newOutcomeNoteFollowUpAction?: number;
	addNewOutcomeNoteToTDL?: boolean;

	// User Template
	useUserTemplate?: boolean;
	userTemplatePrefix?: string;

	LTDListInputSectionHeading: string;
	LTDListOutputSectionHeading: string;
	LTDListOutcomeSectionHeading: string;

	// AI task execution sections
	aiTaskSectionHeadings?: string;
	aiGoalSectionHeadings?: string;
	aiReviewSectionHeadings?: string;

	// Other dynamic keys
	[key: string]: unknown;
}

interface IotoSettingsPlugin {
	settings: IotoSettings;
	saveSettings: () => Promise<void>;
}

export class IotoSettingsService {
	constructor(private app: App) {}

	/**
	 * Get the IOTO Settings plugin instance if available
	 */
	private getPlugin(): IotoSettingsPlugin | undefined {
		const plugin =
			this.app.plugins?.plugins?.["ioto-settings"];
		if (
			typeof plugin === "object" &&
			plugin !== null &&
			"settings" in plugin
		) {
			return plugin as IotoSettingsPlugin;
		}
		return undefined;
	}

	/**
	 * Check if IOTO Settings plugin is installed and enabled
	 */
	public isAvailable(): boolean {
		return !!this.getPlugin();
	}

	/**
	 * Get the current settings from IOTO Settings plugin
	 */
	public getSettings(): IotoSettings | null {
		const plugin = this.getPlugin();
		if (!plugin) return null;
		return plugin.settings || {};
	}
}
