"""F02 date regressions: run python -m unittest discover -s tests -p 'test_date_preservation.py' -v."""

import io
import json
import unittest
from datetime import datetime

import pandas as pd

from services.sheet_service import detect_column_types, process_sheet


class DatePreservationTests(unittest.TestCase):
    def test_fully_valid_text_dates(self):
        df = pd.DataFrame({
            "date": pd.Series(["2026-01-01", "2026-01-02", "2026-01-03"], dtype=object),
            "amount": [10, 20, 30],
        })
        original = df.copy(deep=True)
        result = process_sheet("Sales", df)
        pd.testing.assert_frame_equal(df, original)
        self.assertEqual(result["date_columns"], ["date"])
        self.assertEqual([record["date"] for record in result["records"]], original["date"].tolist())
        self.assertEqual(result["chart_suggestions"][0]["xScale"], "time")
        json.dumps(result, allow_nan=False)

    def test_mixed_dates_keep_unparseable_text_in_records_and_samples(self):
        dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "Pending", None]
        df = pd.DataFrame({"date": pd.Series(dates, dtype=object), "amount": [10, 20, 30, 40, 50, 60]})
        original = df.copy(deep=True)
        result = process_sheet("Sales", df)
        pd.testing.assert_frame_equal(df, original)
        self.assertEqual(result["date_columns"], ["date"])
        self.assertEqual([r["date"] for r in result["records"]], dates[:5] + [""])
        self.assertEqual(result["sample_data"][4]["date"], "Pending")
        self.assertEqual(result["chart_suggestions"][0]["data"][4]["date"], "Pending")
        self.assertEqual(result["numeric_kpis"]["amount"]["sum"], 210)

    def test_type_inference_does_not_mutate_original_dataframe(self):
        dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "Unknown"]
        df = pd.DataFrame({"event": pd.Series(dates, dtype=object), "amount": [1, 2, 3, 4, 5]})
        original = df.copy(deep=True)
        _, numbers, text, date_cols, metadata = detect_column_types(df)
        pd.testing.assert_frame_equal(df, original)
        self.assertEqual((numbers, text, date_cols), (["amount"], [], ["event"]))
        self.assertEqual(metadata[0], {"name": "event", "type": "date"})

    def test_native_excel_datetimes(self):
        stream = io.BytesIO()
        pd.DataFrame({"date": [datetime(2026, 2, 1), datetime(2026, 2, 2)], "amount": [1, 2]}).to_excel(
            stream, index=False
        )
        stream.seek(0)
        loaded = pd.read_excel(stream)
        result = process_sheet("Excel", loaded)
        self.assertEqual(result["date_columns"], ["date"])
        self.assertEqual([r["date"] for r in result["records"]], ["2026-02-01", "2026-02-02"])

    def test_datetime_resolutions_and_timezone(self):
        for dtype in ("datetime64[us]", "datetime64[ns]", "datetime64[ns, UTC]"):
            with self.subTest(dtype=dtype):
                df = pd.DataFrame({"date": pd.Series(["2026-01-01", None], dtype=dtype), "amount": [10, 20]})
                result = process_sheet("Dates", df)
                self.assertEqual(result["date_columns"], ["date"])
                self.assertEqual([r["date"] for r in result["records"]], ["2026-01-01", ""])
                json.dumps(result, allow_nan=False)

    def test_text_dates_at_threshold_remain_text(self):
        # Exactly 60% is below the existing strict > 60% date threshold.
        values = ["2026-01-01", "2026-01-02", "2026-01-03", "Pending", "Unknown"]
        df = pd.DataFrame({"status": pd.Series(values, dtype=object), "amount": [1, 2, 3, 4, 5]})
        result = process_sheet("Mixed", df)
        self.assertEqual(result["date_columns"], [])
        self.assertEqual(result["text_columns"], ["status"])
        self.assertEqual([r["status"] for r in result["records"]], values)

    def test_non_date_numeric_and_text_fields_unchanged(self):
        df = pd.DataFrame({
            "date": pd.Series(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "Unknown"], dtype=object),
            "amount": [0.0, 10.0, None, -2.0, 3.0],
            "category": pd.Series(["A", "B", "A", "B", None], dtype=object),
        })
        result = process_sheet("Sales", df)
        self.assertEqual(result["numeric_columns"], ["amount"])
        self.assertEqual(result["text_columns"], ["category"])
        self.assertEqual(result["records"][2]["amount"], None)
        self.assertEqual(result["records"][4]["category"], "")
        self.assertEqual(result["records"][4]["date"], "Unknown")
        self.assertEqual(result["numeric_kpis"]["amount"], {
            "sum": 11, "average": 2.75, "min": -2, "max": 10,
        })
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
