import json
import math
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

    eligible_columns = {
        column for column, stats in numeric_kpis.items()
        if any(isinstance(value, (int, float)) and math.isfinite(value) for value in stats.values())
    }
    max_cards = min(4, len(eligible_columns))

    prompt = f"""
You are an expert Data Analyst and Business Intelligence specialist.

Generate a STRICT JSON response.

RULES FOR KPI CARDS:
- Select between 0 and {max_cards} KPI cards, at most one per eligible measure column.
- Eligible measure columns: {sorted(eligible_columns)}.
- Use ONLY the supplied Numeric KPI Dictionary: {numeric_kpis}.
- Identifier columns are not measures, even when they appear in columns or sample data.
- Each card must specify column and statistic (sum, average, min, or max).
- Copy the exact statistic value; never invent results or derive additional arithmetic.
- Skip unavailable/null statistics. If no eligible measures exist, return kpi_cards: [].
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
    {{ "column": "...", "statistic": "sum", "label": "...", "value": 0, "description": "...", "metricType": "..." }}
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
        result = json.loads(ai_insights_text)
        cards = []
        seen_columns = set()
        for card in result.get("kpi_cards", []) or []:
            if not isinstance(card, dict):
                continue
            column, statistic = card.get("column"), card.get("statistic")
            if not isinstance(column, str) or column not in eligible_columns or column in seen_columns:
                continue
            if statistic not in ("sum", "average", "min", "max"):
                continue
            value = numeric_kpis[column].get(statistic)
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                continue
            # AI selects/explains the measure; numeric values always come from pandas.
            public_card = {key: value for key, value in card.items() if key not in ("column", "statistic")}
            public_card["value"] = value
            cards.append(public_card)
            seen_columns.add(column)
            if len(cards) == max_cards:
                break
        result["kpi_cards"] = cards
        return result
    except Exception:
        return {
            "raw_response": ai_insights_text
        }
