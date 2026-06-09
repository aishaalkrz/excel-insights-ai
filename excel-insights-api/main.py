from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from openai import OpenAI
import os
from dotenv import load_dotenv
from pathlib import Path


# Load environment variables from .env file
load_dotenv()


# Create FastAPI application
app = FastAPI(title="Excel Insights API")


# Allow Angular frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Initialize OpenAI client using API key from .env
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


@app.get("/")
def read_root():
    # Simple health check endpoint
    return {"message": "Excel Insights API is running successfully 🚀"}


@app.post("/upload/")
async def upload_excel(file: UploadFile = File(...)):
    try:
        # Get uploaded file extension
        ext = Path(file.filename).suffix.lower()

        # Validate supported file types
        if ext not in [".xlsx", ".xls", ".csv"]:
            raise HTTPException(
                status_code=400,
                detail="Only .xlsx, .xls, and .csv files are supported"
            )

        # Read file based on its type
        if ext == ".csv":
            df = pd.read_csv(file.file)
        elif ext == ".xlsx":
            df = pd.read_excel(file.file, engine="openpyxl")
        else:
            df = pd.read_excel(file.file, engine="xlrd")

        # Check if uploaded file is empty
        if df.empty:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty"
            )

        # Basic dataset information
        columns = df.columns.tolist()
        row_count = len(df)
        column_count = len(columns)

        # Detect column types dynamically
        numeric_columns = df.select_dtypes(include="number").columns.tolist()
        text_columns = df.select_dtypes(include="object").columns.tolist()
        date_columns = df.select_dtypes(
            include=["datetime64[ns]", "datetime64[ns, UTC]"]
        ).columns.tolist()

        # Convert date-like object columns to datetime if possible
        for col in text_columns.copy():
            converted = pd.to_datetime(df[col], errors="coerce")
            if converted.notna().sum() > row_count * 0.6:
                df[col] = converted
                date_columns.append(col)
                text_columns.remove(col)

        # First 5 rows for table preview in Angular
        sample_data = df.head(5).fillna("").to_dict(orient="records")

        # Generic numeric KPIs for any numeric column
        numeric_kpis = {}

        for col in numeric_columns:
            numeric_kpis[col] = {
                "sum": round(float(df[col].sum()), 2),
                "average": round(float(df[col].mean()), 2),
                "min": round(float(df[col].min()), 2),
                "max": round(float(df[col].max()), 2)
            }

        # Summary statistics for numeric columns
        summary_stats = {}

        if numeric_columns:
            summary_stats = (
                df[numeric_columns]
                .describe()
                .fillna(0)
                .to_dict()
            )

        # Detect categorical columns dynamically
        # A good categorical column has repeated values, not unique values in every row
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

        # Suggested chart data for frontend
        # Angular can use this directly to draw basic charts
        chart_suggestions = []

        for category_col in categorical_summary.keys():
            for numeric_col in numeric_columns[:2]:
                grouped_data = (
                    df.groupby(category_col)[numeric_col]
                    .sum()
                    .sort_values(ascending=False)
                    .head(10)
                    .reset_index()
                    .to_dict(orient="records")
                )

                chart_suggestions.append({
                    "title": f"{numeric_col} by {category_col}",
                    "type": "bar",
                    "x_axis": category_col,
                    "y_axis": numeric_col,
                    "data": grouped_data
                })

                if len(chart_suggestions) >= 3:
                    break

            if len(chart_suggestions) >= 3:
                break

        # If there is a date column and numeric column, suggest a trend chart
        if date_columns and numeric_columns:
            date_col = date_columns[0]
            numeric_col = numeric_columns[0]

            trend_df = df.copy()
            trend_df[date_col] = pd.to_datetime(trend_df[date_col], errors="coerce")
            trend_df = trend_df.dropna(subset=[date_col])

            if not trend_df.empty:
                trend_df["period"] = trend_df[date_col].dt.to_period("M").astype(str)

                trend_data = (
                    trend_df.groupby("period")[numeric_col]
                    .sum()
                    .reset_index()
                    .to_dict(orient="records")
                )

                chart_suggestions.insert(0, {
                    "title": f"{numeric_col} trend over time",
                    "type": "line",
                    "x_axis": "period",
                    "y_axis": numeric_col,
                    "data": trend_data
                })

        # Keep only 3 charts for MVP
        chart_suggestions = chart_suggestions[:3]

        # Prepare prompt for AI
        # Important: We do not assume fixed columns like Revenue or Product
        prompt = f"""
        You are a senior business intelligence analyst.

        Analyze this dataset in a generic way.
        Do not assume fixed column names like Revenue, Sales, Product, or Customer.
        Use only the detected column types, statistics, and sample data.

        Respond ONLY in Arabic.

        Dataset Overview:
        File Name: {file.filename}
        Rows: {row_count}
        Columns Count: {column_count}
        Columns: {columns}

        Numeric Columns:
        {numeric_columns}

        Text Columns:
        {text_columns}

        Date Columns:
        {date_columns}

        Numeric KPIs:
        {numeric_kpis}

        Categorical Summary:
        {categorical_summary}

        Summary Statistics:
        {summary_stats}

        Suggested Charts:
        {chart_suggestions}

        Sample Data:
        {sample_data}

        Please provide:
        1. Executive Summary, maximum 3 lines.
        2. Best KPIs for this specific dataset using actual column names.
        3. Three recommended dashboard charts using actual column names:
           - Chart title
           - Chart type
           - X-axis
           - Y-axis
        4. Three actionable insights based on the actual data.
        5. One recommendation to improve business performance.
        """

        # Send dataset summary to OpenAI
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert data analyst and dashboard designer. "
                        "Always respond in Arabic. Do not invent columns or metrics."
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.3
        )

        # Extract AI response text
        ai_insights = response.choices[0].message.content

        # Return everything Angular needs to build dashboard
        return {
            "filename": file.filename,
            "row_count": row_count,
            "column_count": column_count,
            "columns": columns,
            "numeric_columns": numeric_columns,
            "text_columns": text_columns,
            "date_columns": date_columns,
            "numeric_kpis": numeric_kpis,
            "categorical_summary": categorical_summary,
            "summary_stats": summary_stats,
            "chart_suggestions": chart_suggestions,
            "sample_data": sample_data,
            "ai_insights": ai_insights
        }

    except HTTPException:
        raise

    except Exception as e:
        return {
            "error": f"An error occurred while processing the file: {str(e)}"
        }