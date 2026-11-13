import { Notice } from "obsidian";
import { t } from "../../lang/helpers";
import type { ComponentDefinition } from "../registry";

/** 只放行 http/https/mailto；无 scheme 时补 https。返回 null 表示拒绝。 */
export function normalizeExternalUrl(raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
		? value
		: `https://${value}`;
	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		return null;
	}
	return parsed.protocol === "http:" ||
		parsed.protocol === "https:" ||
		parsed.protocol === "mailto:"
		? parsed.href
		: null;
}

const BUTTON_HEX = /^#[0-9a-fA-F]{6}$/;

/** 在给定底色上返回可读性更高的文字色；非法输入回退白色。 */
export function contrastOn(hex: string): "#000000" | "#ffffff" {
	if (!BUTTON_HEX.test(hex)) return "#ffffff";
	const channel = (start: number): number => {
		const value = parseInt(hex.slice(start, start + 2), 16) / 255;
		return value <= 0.03928
			? value / 12.92
			: Math.pow((value + 0.055) / 1.055, 2.4);
	};
	const luminance =
		0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
	return luminance > 0.179 ? "#000000" : "#ffffff";
}

export const buttonComponent: ComponentDefinition = {
	type: "button",
	labelKey: "COMPONENT_BUTTON_NAME",
	descriptionKey: "COMPONENT_BUTTON_DESC",
	icon: "mouse-pointer-click",
	category: "utility",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({
		queryId: "",
		options: {
			label: "",
			actionType: "url",
			url: "",
			hideTitle: true,
			variant: "default",
			openInNewTab: true,
			surface: "plain",
		},
		w: 2,
		h: 1,
	}),
	size: { minW: 2, minH: 1, maxH: 8 },
	isEmpty: () => false,
	settings: [
		{ key: "title", kind: "text", group: "display" },
		{
			key: "label",
			kind: "text",
			group: "display",
			target: "options",
			labelKey: "SETTING_BUTTON_LABEL",
			placeholderKey: "SETTING_BUTTON_LABEL_PLACEHOLDER",
		},
		{
			key: "actionType",
			kind: "select",
			group: "display",
			target: "options",
			labelKey: "SETTING_BUTTON_ACTION",
			fallback: "url",
			options: [
				{ value: "url", labelKey: "BUTTON_ACTION_URL" },
				{ value: "note", labelKey: "BUTTON_ACTION_NOTE" },
				{ value: "command", labelKey: "BUTTON_ACTION_COMMAND" },
				{ value: "page", labelKey: "BUTTON_ACTION_PAGE" },
			],
		},
		{
			key: "url",
			kind: "text",
			group: "display",
			target: "options",
			labelKey: "SETTING_BUTTON_URL",
			hintKey: "SETTING_BUTTON_URL_HINT",
			when: (config) => config.options?.actionType === "url",
		},
		{
			key: "notePath",
			kind: "target",
			picker: "note",
			group: "display",
			target: "options",
			labelKey: "SETTING_BUTTON_NOTE",
			when: (config) => config.options?.actionType === "note",
		},
		{
			key: "commandId",
			kind: "target",
			picker: "command",
			group: "display",
			target: "options",
			labelKey: "SETTING_BUTTON_COMMAND",
			hintKey: "SETTING_BUTTON_COMMAND_HINT",
			when: (config) => config.options?.actionType === "command",
		},
		{
			key: "pageId",
			kind: "target",
			picker: "page",
			group: "display",
			target: "options",
			labelKey: "SETTING_BUTTON_PAGE",
			when: (config) => config.options?.actionType === "page",
		},
		{
			key: "openInNewTab",
			kind: "toggle",
			group: "display",
			target: "options",
			labelKey: "SETTING_BUTTON_NEW_TAB",
			fallback: true,
			when: (config) => config.options?.actionType === "note",
		},
		{
			key: "variant",
			kind: "select",
			group: "style",
			target: "options",
			labelKey: "SETTING_BUTTON_VARIANT",
			fallback: "default",
			options: [
				{ value: "default", labelKey: "BUTTON_VARIANT_DEFAULT" },
				{ value: "primary", labelKey: "BUTTON_VARIANT_PRIMARY" },
				{ value: "warning", labelKey: "BUTTON_VARIANT_WARNING" },
				{ value: "success", labelKey: "BUTTON_VARIANT_SUCCESS" },
				{ value: "danger", labelKey: "BUTTON_VARIANT_DANGER" },
				{ value: "custom", labelKey: "BUTTON_VARIANT_CUSTOM" },
			],
		},
		{
			key: "buttonColor",
			kind: "color",
			group: "style",
			target: "options",
			labelKey: "SETTING_BUTTON_COLOR",
			hintKey: "SETTING_BUTTON_COLOR_HINT",
			when: (config) => config.options?.variant === "custom",
		},
	],
	render: (el, ctx) => {
		const options = ctx.config.options ?? {};
		const actionType = String(options.actionType ?? "url");
		const variant = String(options.variant ?? "default");
		const customColor =
			variant === "custom" &&
			BUTTON_HEX.test(String(options.buttonColor ?? ""))
				? String(options.buttonColor).toLowerCase()
				: "";
		const cls = ["ioto-dashboard-button"];
		if (customColor) cls.push("is-colored");
		else if (variant === "primary") cls.push("mod-cta");
		else if (variant === "warning") cls.push("mod-warning");
		else if (variant === "success") cls.push("ioto-btn-success");
		else if (variant === "danger") cls.push("ioto-btn-danger");
		const storedLabel = String(options.label ?? "").trim();
		const fallback = (): string => {
			if (actionType === "url") {
				return String(options.url ?? "")
					.trim()
					.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
			}
			const key =
				actionType === "note"
					? "notePath"
					: actionType === "command"
						? "commandId"
						: "pageId";
			return (
				ctx.describeTarget?.(
					actionType as "note" | "command" | "page",
					String(options[key] ?? ""),
				) ?? ""
			);
		};
		const label = storedLabel || fallback();
		if (!label) {
			el.createDiv({
				cls: "ioto-dashboard-button-empty",
				text: t("BUTTON_NOT_CONFIGURED"),
			});
			return;
		}
		el.addClass("ioto-dashboard-button-body");
		const button = el.createEl("button", {
			cls: cls.join(" "),
			text: label,
			attr: { type: "button" },
		});
		if (customColor) {
			button.style.setProperty("--ioto-btn-color", customColor);
			const explicitText = BUTTON_HEX.test(
				String(options.textColor ?? ""),
			);
			if (!explicitText) {
				button.style.setProperty("--text-color", contrastOn(customColor));
			}
		}
		button.disabled = ctx.editMode;
		if (ctx.editMode) return;
		button.onClickEvent(() => {
			if (actionType === "url") {
				const url = normalizeExternalUrl(String(options.url ?? ""));
				if (!url) {
					new Notice(t("BUTTON_URL_INVALID"));
					return;
				}
				window.open(url, "_blank", "noopener,noreferrer");
				return;
			}
			if (actionType === "note") {
				const path = String(options.notePath ?? "").trim();
				if (!path) {
					new Notice(t("BUTTON_NOTE_MISSING"));
					return;
				}
				ctx.openLink?.(path, undefined, options.openInNewTab !== false);
				return;
			}
			if (actionType === "command") {
				const id = String(options.commandId ?? "").trim();
				if (!id) {
					new Notice(t("BUTTON_COMMAND_MISSING"));
					return;
				}
				if ((ctx.executeCommand?.(id) ?? false) !== true) {
					new Notice(t("BUTTON_COMMAND_FAILED"));
				}
				return;
			}
			const pageId = String(options.pageId ?? "").trim();
			if (!pageId) {
				new Notice(t("BUTTON_PAGE_MISSING"));
				return;
			}
			ctx.openPage?.(pageId);
		});
	},
};
