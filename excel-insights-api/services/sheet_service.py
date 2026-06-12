import pandas as pd


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

    return df[numeric_columns].describe().fillna(0).to_dict()


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