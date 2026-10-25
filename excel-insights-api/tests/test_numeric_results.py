"""F01 numeric regressions; no network or real AI client is used."""

import importlib
import io
import json
import math
import sys
import types
import unittest
from unittest.mock import Mock, patch

import pandas as pd

from services.sheet_service import process_sheet
from test_phase0_baseline import complete_in_memory
from utils.json_values import finite_json_values


class NumericResultsTests(unittest.TestCase):
    def test_all_null_and_empty_numeric_columns(self):
        for dtype in ("float64", "Float64"):
            for values in ([None, None], []):
                with self.subTest(dtype=dtype, values=values):
                    result = process_sheet("Empty", pd.DataFrame({
                        "amount": pd.Series(values, dtype=dtype),
                    }))
                    self.assertEqual(result["numeric_columns"], ["amount"])
                    self.assertEqual(result["numeric_kpis"]["amount"], {
                        "sum": None, "average": None, "min": None, "max": None,
                    })
                    summary = result["summary_stats"]["amount"]
                    self.assertEqual(summary["count"], 0)
                    self.assertTrue(all(v is None for k, v in summary.items() if k != "count"))
                    self.assertTrue(all(row["amount"] is None for row in result["records"]))
                    json.dumps(result, allow_nan=False)

    def test_partially_missing_numeric_values(self):
        result = process_sheet("Mixed", pd.DataFrame({"amount": [10.0, None, 30.0]}))
        self.assertEqual(result["numeric_kpis"]["amount"], {
            "sum": 40, "average": 20, "min": 10, "max": 30,
        })
        self.assertEqual(result["summary_stats"]["amount"]["count"], 2)
        self.assertEqual(result["summary_stats"]["amount"]["50%"], 20)
        self.assertEqual(result["records"], [{"amount": 10}, {"amount": None}, {"amount": 30}])
        self.assertEqual(result["sample_data"], result["records"])
        json.dumps(result, allow_nan=False)

    def test_valid_numeric_results_unchanged(self):
        df = pd.DataFrame({"amount": [10, 20, 30], "other": [-2.25, 0, 2.25]})
        result = process_sheet("Valid", df)
        self.assertEqual(result["numeric_kpis"], {
            "amount": {"sum": 60, "average": 20, "min": 10, "max": 30},
            "other": {"sum": 0, "average": 0, "min": -2.25, "max": 2.25},
        })
        self.assertEqual(result["summary_stats"], df.describe().to_dict())
        self.assertEqual(result["records"], df.to_dict(orient="records"))
        json.dumps(result, allow_nan=False)

    def test_infinities_are_missing_in_calculations_and_records(self):
        result = process_sheet("Infinite", pd.DataFrame({
            "amount": [10.0, math.inf, -math.inf, math.nan, 30.0],
            "other": [math.inf] * 5,
        }))
        self.assertEqual(result["numeric_kpis"]["amount"], {
            "sum": 40, "average": 20, "min": 10, "max": 30,
        })
        self.assertTrue(all(v is None for v in result["numeric_kpis"]["other"].values()))
        self.assertEqual(result["summary_stats"]["amount"]["count"], 2)
        self.assertEqual([row["amount"] for row in result["records"]], [10, None, None, None, 30])
        for chart in result["chart_suggestions"]:
            self.assertEqual(chart["data"], result["records"])
        json.dumps(result, allow_nan=False)

    def test_single_value_and_overflow_statistics(self):
        single = process_sheet("Single", pd.DataFrame({"amount": [3.0]}))
        self.assertIsNone(single["summary_stats"]["amount"]["std"])
        overflow = process_sheet("Large", pd.DataFrame({"amount": [1e308, 1e308]}))
        self.assertIsNone(overflow["numeric_kpis"]["amount"]["sum"])
        self.assertEqual(overflow["numeric_kpis"]["amount"]["max"], 1e308)
        json.dumps(overflow, allow_nan=False)

    def test_nested_serialization_keeps_valid_values(self):
        self.assertEqual(finite_json_values({
            "values": [math.nan, math.inf, -math.inf, 0, -3.5, True, None, "Infinity"],
        }), {"values": [None, None, None, 0, -3.5, True, None, "Infinity"]})


class NumericUploadTests(unittest.TestCase):
    def test_multisheet_xlsx_serializes_missing_and_nonfinite_values(self):
        ai = types.ModuleType("services.ai_service")

        def mock_insights(**kwargs):
            # Validate at call time, before the caller attaches AI output.
            json.dumps(kwargs["active_sheet"], allow_nan=False)
            return {
                "kpi_cards": [{"value": math.inf}],
                "smart_insights": {"executive_summary": "Mock only"},
            }

        ai.generate_ai_insights = Mock(side_effect=mock_insights)
        with patch.dict(sys.modules, {"services.ai_service": ai}), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            app = importlib.import_module("main").app
            stream = io.BytesIO()
            with pd.ExcelWriter(stream, engine="openpyxl") as writer:
                pd.DataFrame({"category": ["A", "B"], "amount": [None, None]}).to_excel(
                    writer, sheet_name="AllNull", index=False
                )
                pd.DataFrame({
                    "category": ["A", "B", "A", "B", "A"],
                    "amount": [10.0, None, math.inf, -math.inf, 30.0],
                }).to_excel(writer, sheet_name="Mixed", index=False)
            body = (
                b'--f01\r\nContent-Disposition: form-data; name="file"; filename="numeric.xlsx"\r\n'
                b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
                + stream.getvalue() + b"\r\n--f01--\r\n"
            )
            messages = []

            async def receive():
                return {"type": "http.request", "body": body, "more_body": False}

            async def send(message):
                messages.append(message)

            async def request():
                async with app.router.lifespan_context(app):
                    await app({
                        "type": "http", "asgi": {"version": "3.0"},
                        "http_version": "1.1", "method": "POST", "scheme": "http",
                        "path": "/upload/", "raw_path": b"/upload/", "query_string": b"",
                        "root_path": "", "server": ("testserver", 80),
                        "client": ("127.0.0.1", 1234),
                        "headers": [(b"host", b"testserver"),
                                    (b"content-type", b"multipart/form-data; boundary=f01")],
                    }, receive, send)

            complete_in_memory(request())
            self.assertEqual(next(m["status"] for m in messages if m["type"] == "http.response.start"), 200)
            raw = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
            def reject_constant(value):
                raise AssertionError(f"Invalid JSON constant: {value}")
            result = json.loads(raw, parse_constant=reject_constant)
            self.assertEqual(result["available_sheets"], ["AllNull", "Mixed"])
            self.assertTrue(all(v is None for v in result["numeric_kpis"]["amount"].values()))
            self.assertEqual(result["records"][0]["amount"], None)
            self.assertIsNone(result["ai_insights"]["kpi_cards"][0]["value"])
            mixed = result["sheets"]["Mixed"]
            self.assertEqual(mixed["numeric_kpis"]["amount"], {
                "sum": 40, "average": 20, "min": 10, "max": 30,
            })
            self.assertEqual([r["amount"] for r in mixed["records"]], [10, None, None, None, 30])
            for key in result["sheets"]["AllNull"]:
                if key != "sheet_name":
                    self.assertEqual(result[key], result["sheets"]["AllNull"][key])
            self.assertEqual(ai.generate_ai_insights.call_count, 2)


if __name__ == "__main__":
    unittest.main()
