export default {
	// Dashboard
	DASHBOARD_TITLE: "IOTO 儀表板",
	NAV_INPUT: "輸入 Input",
	NAV_OUTPUT: "輸出 Output",
	NAV_OUTCOME: "成果 Outcome",
	NAV_TITLE: "導航",
	TAB_NOTES: "筆記",
	TAB_TASKS: "任務",

	// Saved Queries
	NAV_USER_QUERIES: "使用者查詢",
	BTN_SAVE_QUERY: "儲存目前查詢",
	BTN_UPDATE_QUERY: "更新目前查詢",
	BTN_EDIT_QUERY: "重新命名查詢",
	BTN_DELETE_QUERY: "刪除查詢",
	BTN_CANCEL: "取消",
	BTN_CONFIRM: "確認",
	MODAL_SAVE_TITLE: "儲存查詢",
	MODAL_SAVE_NAME_LABEL: "查詢名稱",
	MODAL_SAVE_PLACEHOLDER: "輸入名稱...",
	MODAL_EDIT_TITLE: "重新命名查詢",
	CONFIRM_DELETE_TITLE: "確認刪除",
	CONFIRM_DELETE_MSG: "你確定要刪除這個查詢嗎？",
	CONFIRM_DELETE_TASK_TITLE: "刪除任務",
	CONFIRM_DELETE_TASK_MSG:
		"你確定要刪除這個任務嗎？此操作將從原文件中永久移除該行。",
	TASK_DELETED: "任務已刪除",
	ZEN_MODE_ON: "進入禪模式",
	ZEN_MODE_OFF: "退出禪模式",

	// Filters
	FILTER_TITLE: "過濾",
	FILTER_NAME_LABEL_NOTES: "筆記名稱",
	FILTER_NAME_LABEL_TASKS: "任務內容",
	FILTER_NAME_PLACEHOLDER: "搜尋...",
	FILTER_PROJECT_LABEL: "專案",
	FILTER_PROJECT_PLACEHOLDER: "專案名稱...",
	FILTER_DATE_TYPE_LABEL: "日期類型",
	FILTER_DATE_TYPE_CREATED: "建立時間",
	FILTER_DATE_TYPE_MODIFIED: "修改時間",
	FILTER_DATE_PRESET_LABEL: "日期範圍",
	FILTER_DATE_PRESET_ALL: "不限時間",
	FILTER_DATE_PRESET_LAST_3_DAYS: "最近三天",
	FILTER_DATE_PRESET_LAST_7_DAYS: "最近一週",
	FILTER_DATE_PRESET_LAST_14_DAYS: "最近兩週",
	FILTER_DATE_PRESET_LAST_30_DAYS: "最近一個月",
	FILTER_DATE_PRESET_CUSTOM: "自訂範圍",
	FILTER_DATE_START_LABEL: "開始日期",
	FILTER_DATE_END_LABEL: "結束日期",
	FILTER_STATUS_LABEL: "任務狀態",
	FILTER_FILE_STATUS_LABEL: "筆記狀態",
	FILTER_FILE_STATUS_PLACEHOLDER: "狀態...",
	FILTER_STATUS_ALL: "全部",
	FILTER_STATUS_COMPLETED: "已完成",
	FILTER_STATUS_INCOMPLETE: "未完成",
	FILTER_RESET_BTN: "重置過濾",

	// Empty States
	NO_NOTES_FOUND: "沒有找到筆記。",
	NO_TASKS_FOUND: "沒有找到任務。",

	// Settings
	SETTINGS_INPUT_FOLDER_NAME: "輸入資料夾",
	SETTINGS_INPUT_FOLDER_DESC: "輸入 (Input) 資料夾的路徑 (例如: 1-Input)",
	SETTINGS_OUTPUT_FOLDER_NAME: "輸出資料夾",
	SETTINGS_OUTPUT_FOLDER_DESC: "輸出 (Output) 資料夾的路徑 (例如: 2-Output)",
	SETTINGS_OUTCOME_FOLDER_NAME: "成果資料夾",
	SETTINGS_OUTCOME_FOLDER_DESC:
		"成果 (Outcome) 資料夾的路徑 (例如: 4-Outcome)",
	SETTINGS_TASK_FOLDER_NAME: "任務資料夾",
	SETTINGS_TASK_FOLDER_DESC: "任務 (Task) 資料夾的路徑 (例如: 3-Task)",

	// Commands & Ribbon
	RIBBON_ICON_TITLE: "開啟 IOTO 儀表板",
	COMMAND_OPEN_DASHBOARD: "開啟儀表板",
	COMMAND_TOGGLE_QUICK_SEARCH: "在儀表板中切換快速搜尋",
	PICKER_NO_FOLDERS_FOUND: `沒有找到符合條件的資料夾`,

	INPUT_FOLDER: "1-輸入",
	OUTPUT_FOLDER: "2-輸出",
	TASK_FOLDER: "3-任務",
	OUTCOME_FOLDER: "4-成果",
	CHOOSE_A_FOLDER: "選擇一個資料夾",

	// Sort
	SORT_LABEL: "排序",
	SORT_MODIFIED_DESC: "更新時間 (從新到舊)",
	SORT_MODIFIED_ASC: "更新時間 (從舊到新)",
	SORT_CREATED_DESC: "建立時間 (從新到舊)",
	SORT_CREATED_ASC: "建立時間 (從舊到新)",
	SORT_NAME_ASC: "檔名 (A 到 Z)",
	SORT_NAME_DESC: "檔名 (Z 到 A)",

	// Group
	GROUP_LABEL: "分組",
	GROUP_NONE: "無",
	GROUP_PROJECT: "專案",
	GROUP_CREATED: "建立日期",
	GROUP_MODIFIED: "修改日期",

	// Pagination
	PAGINATION_PREV: "上一頁",
	PAGINATION_NEXT: "下一頁",
	PAGINATION_PAGE: "第 {0} 頁 / 共 {1} 頁",

	// TDL Input Heading
	TDL_INPUT_HEADING: "輸入 LEARN",
	// TDL Output Heading
	TDL_OUTPUT_HEADING: "輸出 THINK",
	// TDL Outcome Heading
	TDL_OUTCOME_HEADING: "成果 DO",
};
