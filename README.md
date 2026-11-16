# Basira AI — Excel Insights

**[Open the frontend preview](https://basira-analytics.netlify.app/)** · **[Browse the application on the development branch](https://github.com/aishaalkrz/excel-insights-ai/tree/Dev)**

The hosted frontend opens. Online spreadsheet analysis is currently unavailable because the API deployment is offline.

## Project overview

Basira AI is an Arabic-first analytics application that turns spreadsheets into interactive dashboards and written business insights. It is designed for people who work with sales, operations, or other tabular data and want to explore a spreadsheet without writing formulas or building charts by hand.

A workbook may contain several sheets with different columns. Basira analyzes each non-empty sheet separately and lets the user switch between them in the dashboard. Users can review the underlying rows, explore metrics and charts, and export the results for sharing.

## From spreadsheet to dashboard

| Step | What Basira does |
| --- | --- |
| Upload | Accepts Excel workbooks and CSV files through the Angular interface. CSV data is presented as a single sheet. |
| Profile the data | Uses pandas to identify numeric, text, and date columns and prepare records and metadata for each sheet. |
| Calculate metrics | Computes totals, averages, minimums, and maximums for numeric columns. It also produces descriptive statistics and frequency counts for suitable categorical columns. |
| Suggest visualizations | Uses column types to suggest charts, such as a line chart for a date and a numeric field or a bar chart for a category and a numeric field. |
| Explain the results | Generates an Arabic executive summary and a recommendation from the sheet's calculated statistics and categorical summaries. |
| Export | Saves the selected chart as a PNG or exports the dashboard as a PDF. |

## Interactive analysis

The dashboard combines a sheet selector, KPI cards, a data table, a chart editor, and an insights panel. When users switch sheets, the visible columns, metrics, charts, and insights update to match the selected sheet.

The chart editor supports bar, line, dot, and pie charts. Users can choose the fields to visualize and edit the chart title before exporting. For example, a sales workbook with date, product category, and revenue columns can be used to explore revenue over time or compare revenue across categories.

The table keeps source rows accessible alongside the chart and narrative. Users can inspect the values behind a pattern before sharing it.

## Architecture and technology

| Layer | Technology and responsibility |
| --- | --- |
| Frontend | Angular 22, TypeScript, and SCSS for file upload, dashboard state, reusable controls, and the Arabic interface. |
| Data visualization | D3.js for reusable charts driven by chart type, field selection, and the active sheet's data. |
| Backend | Python and FastAPI for receiving uploads and returning structured results organized by sheet. |
| Spreadsheet analysis | pandas for column profiling and statistics, with openpyxl for modern Excel workbooks. |
| AI insights | OpenAI for generating Arabic commentary from computed sheet summaries. The analysis pipeline calculates the dashboard metrics directly from the spreadsheet. |
| Export and hosting | html-to-image and jsPDF for client-side export. Netlify hosts the frontend preview. |

## My contribution

I built across the Angular frontend and the FastAPI backend. I worked on the upload flow, workbook and sheet processing, data profiling and KPI calculations, and the integration that generates Arabic business insights. On the frontend, I connected the analysis response to the dashboard, built configurable D3 charts and sheet switching, and added PNG and PDF export.

## Repository guide

The implementation described here is on the [Dev branch](https://github.com/aishaalkrz/excel-insights-ai/tree/Dev).

- [Angular frontend](https://github.com/aishaalkrz/excel-insights-ai/tree/Dev/excel-insights-ui) — Upload flow, dashboard, D3 charts, reusable UI, and export.
- [FastAPI backend](https://github.com/aishaalkrz/excel-insights-ai/tree/Dev/excel-insights-api) — File parsing, per-sheet analysis, chart suggestions, and AI insights.
