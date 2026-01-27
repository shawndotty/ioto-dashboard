# IOTO Dashboard

IOTO Dashboard is an Obsidian plugin designed to visualize and manage your IOTO (Input, Output, Task, Outcome) workflow. It provides a centralized dashboard to track your notes and tasks across different stages of your knowledge management process.

[中文文档](README_zh-CN.md)

## Features

- **Workflow Navigation**: Easily switch between Input, Output, and Outcome stages.
- **Dual Views**:
    - **Notes View**: Browse files in your specific workflow folders with metadata (Project, Date).
    - **Tasks View**: Aggregate tasks from a dedicated task folder, filtered by category-specific headings.
- **Advanced Filtering**:
    - Filter by Name/Content.
    - **Project Filter**: Autocomplete support for existing projects in your vault.
    - **Date Filter**: Filter by Created or Modified date with range support.
    - **Task Status**: Filter tasks by Completed/Incomplete status.
- **Multi-language Support**: Available in English, Simplified Chinese, and Traditional Chinese.

## Configuration

Go to **Settings > IOTO Dashboard** to configure your folder paths:

- **Input Folder**: Default `1-Input`
- **Output Folder**: Default `2-Output`
- **Outcome Folder**: Default `4-Outcome`
- **Task Folder**: Default `3-Task` (The folder where your daily/weekly task notes are stored)

## Usage

1. Click the **Dashboard** icon in the ribbon.
2. Or use the command palette (Ctrl/Cmd + P) and search for **"IOTO Dashboard: Open Dashboard"**.

## Task Aggregation Logic

The plugin scans files in your **Task Folder** and looks for specific headings to categorize tasks:

- **Input Category**: Looks for tasks under the header `输入 LEARN` (case-insensitive).
- **Output Category**: Looks for tasks under the header `输出 THINK`.
- **Outcome Category**: Looks for tasks under the header `成果 DO`.

## Development

This plugin was developed to streamline the IOTO workflow implementation in Obsidian.

### Installation

1. Clone this repo.
2. `npm i` to install dependencies.
3. `npm run build` to build the plugin.
