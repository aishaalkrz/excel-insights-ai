import json
from core.config import client


def generate_ai_insights(
    file_name: str,
    active_sheet_name: str,
    available_sheets: list[str],
    active_sheet: dict
):
    columns = active_sheet["columns"]
    row_count = active_sheet["row_count"]
    numeric_kpis = active_sheet["numeric_kpis"]
    categorical_summary = active_sheet["categorical_summary"]
    summary_stats = active_sheet["summary_stats"]
    sample_data = active_sheet["sample_data"]

    prompt = f"""
You are an expert Data Analyst and Business Intelligence specialist.

Generate a STRICT JSON response.

RULES FOR KPI CARDS:
- Select EXACTLY 4 critical KPIs from this dictionary: {numeric_kpis}.
- Ensure each KPI focuses on a different aspect.
- Do not duplicate the same column name or concept.
- metricType must be one of:
["revenue", "price", "quantity", "discount", "average", "max", "min", "count", "profit", "general"].
- label must be Arabic.
- description must be Arabic.

RULES FOR SMART INSIGHTS:
- executive_summary: comprehensive 3-line Arabic analysis.
- actionable_insights: 3 distinct Arabic insights.
- recommendation: one Arabic strategic recommendation.

JSON FORMAT RULES:
- Valid JSON only.
- No Markdown.
- No text outside JSON.

Reference Data:
- File Name: {file_name}
- Active Sheet: {active_sheet_name}
- Available Sheets: {available_sheets}
- Columns: {columns}
- Row Count: {row_count}
- Numeric KPI Dictionary: {numeric_kpis}
- Categorical Summary: {categorical_summary}
- Data Summary: {summary_stats}
- Sample Data: {sample_data}

JSON STRUCTURE:
{{
  "kpi_cards": [
    {{ "label": "...", "value": 0, "description": "...", "metricType": "..." }}
  ],
  "smart_insights": {{
    "executive_summary": "...",
    "actionable_insights": ["...", "...", "..."],
    "recommendation": "..."
  }}
}}
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