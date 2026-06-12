from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from openai import OpenAI
import os
from dotenv import load_dotenv
from pathlib import Path
import logging
import time
from datetime import datetime, timezone
import json

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

logger = logging.getLogger("excel-insights-api")

app = FastAPI(title="Excel Insights API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def format_file_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{round(size_bytes / 1024, 1)} KB"
    return f"{round(size_bytes / (1024 * 1024), 1)} MB"


def detect_column_types(df: pd.DataFrame):
    columns = df.columns.tolist()

    numeric_columns = df.select_dtypes(include="number").columns.tolist()
    text_columns = df.select_dtypes(include="object").columns.tolist()
    date_columns = df.select_dtypes(
        include=["datetime64[ns]", "datetime64[ns, UTC]"]
    ).columns.tolist()

    for col in text_columns.copy():
        converted = pd.to_datetime(df[col], errors="coerce")

        if converted.notna().sum() > len(df) * 0.6:
            df[col] = converted
            date_columns.append(col)
            text_columns.remove(col)

    field_metadata = []

    for col in columns:
        if col in numeric_columns:
            field_type = "number"
        elif col in date_columns:
            field_type = "date"
        else:
            field_type = "text"

        field_metadata.append({
            "name": col,
            "type": field_type
        })

    return columns, numeric_columns, text_columns, date_columns, field_metadata


def prepare_records(df: pd.DataFrame, date_columns: list[str]):
    records_df = df.copy()

    for col in date_columns:
        records_df[col] = pd.to_datetime(
            records_df[col],
            errors="coerce"
        ).dt.strftime("%Y-%m-%d")

    return records_df.fillna("").to_dict(orient="records")


def prepare_sample_data(df: pd.DataFrame, date_columns: list[str]):
    sample_df = df.head(5).copy()

    for col in date_columns:
        sample_df[col] = pd.to_datetime(
            sample_df[col],
            errors="coerce"
        ).dt.strftime("%Y-%m-%d")

    return sample_df.fillna("").to_dict(orient="records")


def generate_numeric_kpis(df: pd.DataFrame, numeric_columns: list[str]):
    numeric_kpis = {}

    for col in numeric_columns:
        numeric_kpis[col] = {
            "sum": round(float(df[col].sum()), 2),
            "average": round(float(df[col].mean()), 2),
            "min": round(float(df[col].min()), 2),
            "max": round(float(df[col].max()), 2)
        }

    return numeric_kpis


def generate_summary_stats(df: pd.DataFrame, numeric_columns: list[str]):
    if not numeric_columns:
        return {}

    return (
        df[numeric_columns]
        .describe()
        .fillna(0)
        .to_dict()
    )


def generate_categorical_summary(df: pd.DataFrame, text_columns: list[str]):
    categorical_summary = {}

    for col in text_columns:
        unique_count = df[col].nunique(dropna=True)

        if 1 < unique_count <= 20:
            categorical_summary[col] = (
                df[col]
                .value_counts()
                .head(10)
                .to_dict()
            )

    return categorical_summary


def generate_chart_suggestions(
    records: list[dict],
    text_columns: list[str],
    numeric_columns: list[str],
    date_columns: list[str],
    df: pd.DataFrame,
    sheet_name: str
):
    chart_suggestions = []

    def add_chart(chart_type: str, x_col: str, y_col: str):
        chart_suggestions.append({
            "id": f"{sheet_name}_chart_{len(chart_suggestions) + 1}",
            "sheetName": sheet_name,
            "title": f"{y_col} حسب {x_col}",
            "type": chart_type,
            "xKey": x_col,
            "yKey": y_col,
            "xScale": (
                "category" if x_col in text_columns
                else "time" if x_col in date_columns
                else "number"
            ),
            "yScale": "number",
            "xAxisLabel": x_col,
            "yAxisLabel": y_col,
            "showTooltip": True,
            "showLegend": False,
            "isAggregated": False,
            "isDerived": False,
            "dataSource": "raw_records",
            "data": records[:100]
        })

    if date_columns and numeric_columns:
        add_chart("line", date_columns[0], numeric_columns[0])

    for text_col in text_columns:
        if len(chart_suggestions) >= 3:
            break

        unique_count = df[text_col].nunique(dropna=True)

        if 2 <= unique_count <= 30 and numeric_columns:
            add_chart("bar", text_col, numeric_columns[0])

    if len(chart_suggestions) < 3 and len(numeric_columns) >= 2:
        add_chart("scatter", numeric_columns[0], numeric_columns[1])

    return chart_suggestions[:3]


def process_sheet(sheet_name: str, df: pd.DataFrame):
    current_df = df.copy()

    columns, numeric_columns, text_columns, date_columns, field_metadata = detect_column_types(current_df)

    records = prepare_records(current_df, date_columns)
    sample_data = prepare_sample_data(current_df, date_columns)

    numeric_kpis = generate_numeric_kpis(current_df, numeric_columns)
    summary_stats = generate_summary_stats(current_df, numeric_columns)
    categorical_summary = generate_categorical_summary(current_df, text_columns)

    chart_suggestions = generate_chart_suggestions(
        records=records,
        text_columns=text_columns,
        numeric_columns=numeric_columns,
        date_columns=date_columns,
        df=current_df,
        sheet_name=sheet_name
    )

    return {
        "sheet_name": sheet_name,
        "row_count": len(current_df),
        "column_count": len(columns),
        "columns": columns,
        "field_metadata": field_metadata,
        "numeric_columns": numeric_columns,
        "text_columns": text_columns,
        "date_columns": date_columns,
        "numeric_kpis": numeric_kpis,
        "categorical_summary": categorical_summary,
        "summary_stats": summary_stats,
        "chart_suggestions": chart_suggestions,
        "records": records,
        "sample_data": sample_data
    }


def generate_ai_insights(file_name: str, active_sheet_name: str, available_sheets: list[str], active_sheet: dict):
    columns = active_sheet["columns"]
    row_count = active_sheet["row_count"]
    numeric_kpis = active_sheet["numeric_kpis"]
    categorical_summary = active_sheet["categorical_summary"]
    summary_stats = active_sheet["summary_stats"]
    sample_data = active_sheet["sample_data"]

    prompt = f"""
You are an expert Data Analyst and Business Intelligence specialist.

Generate a STRICT JSON response.

Important rules:
- Do NOT invent column names.
- Use ONLY these available columns: {columns}
- Do NOT generate chart data.
- Do NOT suggest charts.
- Do NOT aggregate, group, merge, sum, average, or create derived columns for charts.
- Backend already generates chart suggestions from raw records only.
- Your job is only KPI cards and smart insights.
- Analyze only the active sheet.

ALL string values inside the JSON MUST be in Arabic.
Keep JSON keys in English.

1. "kpi_cards":
Select the top 4 most critical KPIs from this dictionary only:
{numeric_kpis}

Each KPI object must include:
- "label": Arabic KPI name.
- "value": The numeric value exactly as it appears in the dictionary.
- "description": Short Arabic description.
- "metricType": one of "revenue", "price", "quantity", "discount", "general".

2. "smart_insights":
- "executive_summary": max 3 lines.
- "actionable_insights": array of 3 insights derived from the given numbers.
- "recommendation": one clear recommendation.

Reference Data:
- File Name: {file_name}
- Active Sheet: {active_sheet_name}
- Available Sheets: {available_sheets}
- Rows Count: {row_count}
- Columns: {columns}
- Categorical Summary: {categorical_summary}
- Summary Statistics: {summary_stats}
- Sample Data: {sample_data}

Return ONLY a valid JSON object.
Do not wrap the JSON in Markdown.
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert data analyst. "
                    "You must output valid JSON only. "
                    "Always write content values in Arabic. "
                    "Never invent columns or chart data."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.2
    )

    ai_insights_text = response.choices[0].message.content

    try:
        return json.loads(ai_insights_text)
    except Exception:
        return {
            "raw_response": ai_insights_text
        }


@app.get("/")
def read_root():
    return {"message": "Excel Insights API is running successfully 🚀"}


@app.post("/upload/")
async def upload_excel(file: UploadFile = File(...)):
    start_time = time.time()
    uploaded_at = datetime.now(timezone.utc).isoformat()

    file_bytes = await file.read()
    file_size = len(file_bytes)
    file.file.seek(0)

    try:
        logger.info(
            "Upload started | filename=%s | content_type=%s",
            file.filename,
            file.content_type
        )

        ext = Path(file.filename).suffix.lower()

        if ext not in [".xlsx", ".xls", ".csv"]:
            raise HTTPException(
                status_code=400,
                detail="Only .xlsx, .xls, and .csv files are supported"
            )

        if ext == ".csv":
            df = pd.read_csv(file.file)
            sheets = {
                "CSV File": df
            }

        elif ext == ".xlsx":
            sheets = pd.read_excel(
                file.file,
                sheet_name=None,
                engine="openpyxl"
            )

        else:
            sheets = pd.read_excel(
                file.file,
                sheet_name=None,
                engine="xlrd"
            )

        available_sheets = list(sheets.keys())
        processed_sheets = {}
        active_sheet_name = None

        for sheet_name, sheet_df in sheets.items():
            if sheet_df.empty:
                continue

            processed_sheet = process_sheet(sheet_name, sheet_df)
            processed_sheets[sheet_name] = processed_sheet

            if active_sheet_name is None:
                active_sheet_name = sheet_name

        if not processed_sheets or active_sheet_name is None:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty"
            )

        active_sheet = processed_sheets[active_sheet_name]

        ai_insights = generate_ai_insights(
            file_name=file.filename,
            active_sheet_name=active_sheet_name,
            available_sheets=available_sheets,
            active_sheet=active_sheet
        )

        duration = round(time.time() - start_time, 2)

        logger.info(
            "Upload completed | filename=%s | active_sheet=%s | sheets=%s | duration=%s",
            file.filename,
            active_sheet_name,
            available_sheets,
            duration
        )

        return {
            "filename": file.filename,

            # الافتراضي: أول Sheet غير فارغة
            "active_sheet": active_sheet_name,

            # كل أسماء الشيتات
            "available_sheets": available_sheets,

            # كل بيانات الشيتات
            "sheets": processed_sheets,

            # بيانات الشيت الافتراضي مباشرة لتسهيل Angular الحالي
            "row_count": active_sheet["row_count"],
            "column_count": active_sheet["column_count"],
            "columns": active_sheet["columns"],
            "field_metadata": active_sheet["field_metadata"],
            "numeric_columns": active_sheet["numeric_columns"],
            "text_columns": active_sheet["text_columns"],
            "date_columns": active_sheet["date_columns"],
            "numeric_kpis": active_sheet["numeric_kpis"],
            "categorical_summary": active_sheet["categorical_summary"],
            "summary_stats": active_sheet["summary_stats"],
            "chart_suggestions": active_sheet["chart_suggestions"],
            "records": active_sheet["records"],
            "sample_data": active_sheet["sample_data"],

            # AI يحلل الشيت الافتراضي فقط عند الرفع
            "ai_insights": ai_insights,

            "uploaded_at": uploaded_at,
            "file_size": format_file_size(file_size),
            "file_size_bytes": file_size
        }

    except HTTPException:
        logger.exception("HTTP error while processing upload | filename=%s", file.filename)
        raise

    except Exception as e:
        logger.exception("Unexpected error while processing upload | filename=%s", file.filename)
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing the file: {str(e)}"
        )