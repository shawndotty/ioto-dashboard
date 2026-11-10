import { t } from "../lang/helpers";
import { TARGET_LABEL_KEYS } from "../query/manager";
import type { QueryDefinition, QueryTarget } from "../query/types";

type LabelKey = Parameters<typeof t>[0];

export function queryTargetLabel(target: QueryTarget): string {
	return t(TARGET_LABEL_KEYS[target]);
}

export function queryDisplayName(query: QueryDefinition): string {
	return query.nameKey ? t(query.nameKey as LabelKey) : query.name;
}
