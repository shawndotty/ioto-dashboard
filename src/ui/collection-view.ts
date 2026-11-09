import { Setting, setIcon } from "obsidian";

export interface CollectionAction {
	icon: string;
	label: string;
	onClick(): void;
	danger?: boolean;
}

export interface CollectionItem {
	id: string;
	icon?: string;
	title: string;
	description?: string;
	meta?: string;
	primaryLabel?: string;
	onPrimary?(): void;
	actions: CollectionAction[];
}

export type CollectionLayout = "list" | "card";

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

		if (item.primaryLabel && item.onPrimary) {
			setting.addButton((button) =>
				button
					.setButtonText(item.primaryLabel ?? "")
					.setCta()
					.onClick(() => item.onPrimary?.()),
			);
		}

		for (const action of item.actions) {
			setting.addExtraButton((button) =>
				button
					.setIcon(action.icon)
					.setTooltip(action.label)
					.onClick(() => action.onClick()),
			);
		}
	}
}

function renderCards(el: HTMLElement, items: CollectionItem[]): void {
	const grid = el.createDiv({ cls: "ioto-modal-cards" });

	for (const item of items) {
		const card = grid.createDiv({ cls: "ioto-modal-card" });
		card.dataset.id = item.id;

		const header = card.createDiv({ cls: "ioto-modal-card__header" });
		if (item.icon) {
			const iconEl = header.createDiv({ cls: "ioto-modal-card__icon" });
			setIcon(iconEl, item.icon);
		}
		header.createEl("strong", {
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
			const button = actions.createEl("button", {
				cls: "clickable-icon",
				attr: {
					type: "button",
					"aria-label": action.label,
					title: action.label,
				},
			});
			if (action.danger) button.addClass("mod-warning");
			setIcon(button, action.icon);
			button.addEventListener("click", () => action.onClick());
		}
	}
}
