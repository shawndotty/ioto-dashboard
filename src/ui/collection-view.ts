import { Setting, setIcon } from "obsidian";

export interface CollectionAction {
	icon: string;
	label: string;
	onClick(): void;
	danger?: boolean;
	/** 仅禁用图标点击；tooltip 仍可读。 */
	disabled?: boolean;
	/** 覆盖 tooltip（如“至少保留一个仪表盘”）。 */
	tooltip?: string;
}

export interface CollectionItem {
	id: string;
	icon?: string;
	title: string;
	description?: string;
	meta?: string;
	primaryLabel?: string;
	onPrimary?(): void;
	/** 指针便利：点击行/卡片主体打开；语义入口仍由首枚图标承担。 */
	onActivate?(): void;
	actions: CollectionAction[];
}

export type CollectionLayout = "list" | "card";

/** Must match the `.is-newly-created::after` animation length in styles.css. */
export const REVEAL_HIGHLIGHT_MS = 900;

export function revealCollectionItem(
	container: HTMLElement | null,
	id: string,
	duration = REVEAL_HIGHLIGHT_MS,
): void {
	const el = container?.querySelector<HTMLElement>(
		`[data-id="${CSS.escape(id)}"]`,
	);
	if (!el) return;
	el.scrollIntoView({ block: "nearest" });
	el.addClass("is-newly-created");
	el.setAttribute("tabindex", "-1");
	el.focus({ preventScroll: true });
	window.setTimeout(() => el.removeClass("is-newly-created"), duration);
}

export function renderCollection(
	el: HTMLElement,
	items: CollectionItem[],
	layout: CollectionLayout,
): void {
	el.empty();
	if (layout === "card") {
		renderCards(el, items);
	} else {
		renderList(el, items);
	}
}

function descriptionOf(item: CollectionItem): string {
	return item.description ?? item.meta ?? "";
}

function renderList(el: HTMLElement, items: CollectionItem[]): void {
	for (const item of items) {
		const setting = new Setting(el)
			.setName(item.title)
			.setDesc(descriptionOf(item));
		setting.settingEl.dataset.id = item.id;

		if (item.onActivate) {
			setting.settingEl.addClass("is-activatable");
			setting.settingEl.addEventListener("click", (event) => {
				if ((event.target as HTMLElement).closest("button")) return;
				item.onActivate?.();
			});
		}

		if (item.primaryLabel && item.onPrimary) {
			setting.addButton((button) =>
				button
					.setButtonText(item.primaryLabel ?? "")
					.setCta()
					.onClick(() => item.onPrimary?.()),
			);
		}

		for (const action of item.actions) {
			setting.addExtraButton((button) => {
				button
					.setIcon(action.icon)
					.setTooltip(action.tooltip ?? action.label)
					.setDisabled(action.disabled ?? false)
					.onClick(() => action.onClick());
				if (action.danger) {
					button.extraSettingsEl.addClass("ioto-collection-action--danger");
				}
			});
		}
	}
}

function renderCards(el: HTMLElement, items: CollectionItem[]): void {
	const grid = el.createDiv({ cls: "ioto-modal-cards" });

	for (const item of items) {
		const card = grid.createDiv({ cls: "ioto-modal-card" });
		card.dataset.id = item.id;

		if (item.onActivate) {
			card.addClass("is-activatable");
			card.addEventListener("click", (event) => {
				if ((event.target as HTMLElement).closest("button")) return;
				item.onActivate?.();
			});
		}

		const header = card.createDiv({ cls: "ioto-modal-card__header" });
		if (item.icon) {
			const iconEl = header.createDiv({ cls: "ioto-modal-card__icon" });
			setIcon(iconEl, item.icon);
		}
		header.createEl("span", {
			cls: "ioto-modal-card__title",
			text: item.title,
		});
		if (item.meta) {
			header.createEl("span", {
				cls: "ioto-modal-card__meta",
				text: item.meta,
			});
		}

		if (item.description) {
			card.createEl("p", {
				cls: "ioto-modal-card__desc",
				text: item.description,
			});
		}

		const actions = card.createDiv({ cls: "ioto-modal-card__actions" });

		if (item.primaryLabel && item.onPrimary) {
			const primary = actions.createEl("button", {
				cls: "mod-cta",
				text: item.primaryLabel,
			});
			primary.addEventListener("click", () => item.onPrimary?.());
		}

		for (const action of item.actions) {
			const label = action.tooltip ?? action.label;
			const button = actions.createEl("button", {
				cls: "clickable-icon",
				attr: {
					type: "button",
					"aria-label": label,
					title: label,
				},
			});
			button.disabled = action.disabled ?? false;
			if (action.danger) button.addClass("ioto-collection-action--danger");
			setIcon(button, action.icon);
			button.addEventListener("click", () => action.onClick());
		}
	}
}
