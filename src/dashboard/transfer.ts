import { Notice } from "obsidian";
import type IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import {
	buildBackupBundle,
	buildDashboardBundle,
	buildPageBundle,
	buildQueryBundle,
	parseBundle,
	planImport,
	type BundleContext,
	type BundleSettings,
	type ExportResult,
	type ImportPlan,
} from "./bundle";
import { createComponentRegistry } from "./components";
import { queryTargetsFor } from "./registry";
import { findDashboardForPage } from "./types";
import {
	TransferExportModal,
	TransferImportModal,
} from "../ui/transfer-modal";

export const DEFAULT_TRANSFER_FOLDER = "0-辅助/Temp";

function stamp(now: number): string {
	const date = new Date(now);
	const pad = (value: number, size = 2): string =>
		String(value).padStart(size, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

/**
 * Thin orchestration layer between the dashboard UI and `bundle.ts`: builds
 * export envelopes, opens the transfer modals and applies planned imports.
 */
export class DashboardTransfer {
	private readonly registry = createComponentRegistry();

	constructor(private readonly plugin: IotoDashboardPlugin) {}

	private settingsSnapshot(): BundleSettings {
		return {
			roots: {
				inputFolder: this.plugin.settings.inputFolder,
				outputFolder: this.plugin.settings.outputFolder,
				taskFolder: this.plugin.settings.taskFolder,
				outcomeFolder: this.plugin.settings.outcomeFolder,
			},
			customFilters: this.plugin.settings.customFilters,
			savedQueries: this.plugin.settings.savedQueries,
		};
	}

	private context(): BundleContext | null {
		const store = this.plugin.getDashboardStore();
		if (!store) return null;
		return {
			store,
			settings: this.settingsSnapshot(),
			pluginVersion: this.plugin.manifest.version,
			now: Date.now(),
		};
	}

	private targetsFor = (componentType: string) => {
		const definition = this.registry.get(componentType);
		return definition ? queryTargetsFor(definition) : null;
	};

	private openExport(
		result: ExportResult,
		summary: string,
		fileStem: string,
	): void {
		new TransferExportModal(this.plugin.app, {
			json: result.json,
			summary,
			warnings: result.envelope.warnings,
			defaultFolder: DEFAULT_TRANSFER_FOLDER,
			filename: `${fileStem}-${stamp(Date.now())}.json`,
		}).open();
	}

	exportPage(dashboardId: string | undefined, pageId: string): void {
		const ctx = this.context();
		if (!ctx) return;
		const owner =
			dashboardId ??
			findDashboardForPage(ctx.store, pageId)?.id;
		if (!owner) return;
		const result = buildPageBundle(ctx, owner, pageId);
		if (!result) return;
		const page = ctx.store.dashboards
			.find((item) => item.id === owner)
			?.pages.find((item) => item.id === pageId);
		const pages = result.envelope.payload.pages?.length ?? 0;
		const queries = result.envelope.payload.queries.length;
		this.openExport(
			result,
			t("TRANSFER_SUMMARY_PAGE", [
				page?.name ?? pageId,
				String(pages),
				String(queries),
			]),
			"ioto-page",
		);
	}

	exportDashboard(dashboardId: string): void {
		const ctx = this.context();
		if (!ctx) return;
		const result = buildDashboardBundle(ctx, dashboardId);
		if (!result) return;
		const dashboard = ctx.store.dashboards.find(
			(item) => item.id === dashboardId,
		);
		const pages = result.envelope.payload.dashboard?.pages.length ?? 0;
		const queries = result.envelope.payload.queries.length;
		this.openExport(
			result,
			t("TRANSFER_SUMMARY_DASHBOARD", [
				dashboard?.name ?? dashboardId,
				String(pages),
				String(queries),
			]),
			"ioto-dashboard",
		);
	}

	exportQuery(queryId: string): void {
		const ctx = this.context();
		if (!ctx) return;
		const result = buildQueryBundle(ctx, queryId);
		if (!result) {
			new Notice(t("TRANSFER_EXPORT_EMPTY"));
			return;
		}
		const query = result.envelope.payload.queries[0];
		this.openExport(
			result,
			t("TRANSFER_SUMMARY_QUERY", [query?.name ?? queryId]),
			"ioto-query",
		);
	}

	exportBackup(): void {
		const ctx = this.context();
		if (!ctx) return;
		const result = buildBackupBundle(ctx);
		this.openExport(
			result,
			t("TRANSFER_SUMMARY_BACKUP", [
				String(result.envelope.payload.dashboards?.length ?? 0),
				String(result.envelope.payload.queries.length),
			]),
			"ioto-backup",
		);
	}

	importPage(
		targetDashboardId?: string,
		onDone?: (plan: ImportPlan) => void,
	): void {
		this.openImport({
			backupOnly: false,
			requireConfirm: false,
			targetDashboardId,
			onDone,
		});
	}

	importDashboard(onDone?: (plan: ImportPlan) => void): void {
		this.openImport({
			backupOnly: false,
			requireConfirm: false,
			onDone,
		});
	}

	importQuery(onDone?: (plan: ImportPlan) => void): void {
		this.openImport({
			backupOnly: false,
			requireConfirm: false,
			onDone,
		});
	}

	restoreBackup(onDone?: (plan: ImportPlan) => void): void {
		this.openImport({
			backupOnly: true,
			requireConfirm: true,
			onDone,
		});
	}

	private openImport(options: {
		backupOnly: boolean;
		requireConfirm: boolean;
		targetDashboardId?: string;
		onDone?: (plan: ImportPlan) => void;
	}): void {
		new TransferImportModal(this.plugin.app, {
			defaultFolder: DEFAULT_TRANSFER_FOLDER,
			requireConfirm: options.requireConfirm,
			plan: (text) => {
				const parsed = parseBundle(text);
				if (!parsed.ok || !parsed.envelope) {
					return { error: parsed.error?.message };
				}
				const isBackup =
					parsed.envelope.kind === "ioto-dashboard-backup";
				if (options.backupOnly !== isBackup) {
					return {
						error: options.backupOnly
							? t("TRANSFER_ERROR_NOT_BACKUP")
							: t("TRANSFER_ERROR_USE_RESTORE"),
					};
				}
				const ctx = this.context();
				if (!ctx) return { error: t("TRANSFER_ERROR_NO_STORE") };
				const plan = planImport(parsed.envelope, {
					store: ctx.store,
					settings: ctx.settings,
					targetDashboardId: options.targetDashboardId,
					targetsFor: this.targetsFor,
				});
				return { plan };
			},
			onApply: async (plan) => {
				const { store, customFilters } =
					await this.plugin.dashboardRepository.applyImport(plan);
				if (customFilters) {
					this.plugin.settings.customFilters = customFilters;
				}
				new Notice(t("TRANSFER_IMPORTED"));
				this.navigateAfterImport(plan, store.activeDashboardId);
				options.onDone?.(plan);
			},
		}).open();
	}

	private navigateAfterImport(
		plan: ImportPlan,
		activeDashboardId: string | undefined,
	): void {
		const pageId = plan.createdPageIds[0];
		if (plan.kind === "ioto-dashboard-page" && plan.targetDashboardId) {
			void this.plugin.activateCustomDashboard(plan.targetDashboardId, {
				pageId,
			});
			return;
		}
		if (plan.kind === "ioto-dashboard") {
			const dashboard = plan.dashboards[0];
			if (dashboard) {
				void this.plugin.activateCustomDashboard(dashboard.id, {
					pageId: dashboard.lastPageId ?? dashboard.pages[0]?.id,
				});
			}
			return;
		}
		if (plan.kind === "ioto-dashboard-backup" && activeDashboardId) {
			const dashboard = plan.dashboards.find(
				(item) => item.id === activeDashboardId,
			) ?? plan.dashboards[0];
			if (dashboard) {
				void this.plugin.activateCustomDashboard(dashboard.id, {
					pageId:
						dashboard.lastPageId ?? dashboard.pages[0]?.id,
				});
			}
		}
	}
}
