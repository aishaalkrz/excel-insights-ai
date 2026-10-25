"""Focused baseline regressions: python -m unittest discover -s tests -v."""

import importlib
import io
import json
import sys
import types
import unittest
from unittest.mock import Mock, patch

import pandas as pd

from services.sheet_service import detect_column_types, process_sheet


def complete_in_memory(coroutine):
    """Run an entirely in-memory ASGI operation without sandbox socket setup.

    Small multipart files are processed synchronously by the upload handler.
    Fail explicitly if it ever starts requiring asynchronous I/O.
    """
    try:
        coroutine.send(None)
    except StopIteration as result:
        return result.value
    else:
        coroutine.close()
        raise AssertionError("In-memory smoke check unexpectedly suspended for I/O")


class ColumnClassificationTests(unittest.TestCase):
    def test_datetime_resolutions_and_missing_values(self):
        for dtype in ("datetime64[us]", "datetime64[ns]", "datetime64[ns, UTC]"):
            with self.subTest(dtype=dtype):
                df = pd.DataFrame({
                    "date": pd.Series(["2026-01-01", None], dtype=dtype),
                    "amount": [10.0, None],
                    "category": pd.Series(["Widget", None], dtype=object),
                })
                _, numeric, text, dates, metadata = detect_column_types(df)
                self.assertEqual(numeric, ["amount"])
                self.assertEqual(text, ["category"])
                self.assertEqual(dates, ["date"])
                self.assertEqual(
                    {field["name"]: field["type"] for field in metadata},
                    {"date": "date", "amount": "number", "category": "text"},
                )
                self.assertTrue(pd.isna(df.loc[1, "date"]))
                records = process_sheet("Sales", df)["records"]
                self.assertEqual(records[0]["date"], "2026-01-01")
                self.assertEqual(records[1], {"date": "", "amount": None, "category": ""})

    def test_text_dates_keep_existing_conversion_threshold(self):
        df = pd.DataFrame({
            "date": pd.Series(["2026-01-01", "2026-01-02", "2026-01-03", None], dtype=object),
            "amount": [1, 2, 3, 4],
            "category": pd.Series(["Widget", "Gadget", "Widget", None], dtype=object),
        })
        _, numeric, text, dates, _ = detect_column_types(df)
        self.assertEqual((numeric, text, dates), (["amount"], ["category"], ["date"]))
        self.assertTrue(pd.isna(df.loc[3, "date"]))

    def test_xlsx_microsecond_dates(self):
        stream = io.BytesIO()
        pd.DataFrame({
            "date": pd.Series(["2026-01-01", "2026-01-02"], dtype="datetime64[us]"),
            "amount": [10, 20],
            "category": ["Widget", "Gadget"],
        }).to_excel(stream, index=False)
        stream.seek(0)
        df = pd.read_excel(stream)
        self.assertEqual(str(df["date"].dtype), "datetime64[us]")
        _, numeric, text, dates, _ = detect_column_types(df)
        self.assertEqual((numeric, text, dates), (["amount"], ["category"], ["date"]))


class UploadSmokeTests(unittest.TestCase):
    def test_mocked_multisheet_xlsx_upload(self):
        ai = types.ModuleType("services.ai_service")
        ai.generate_ai_insights = Mock(return_value={
            "kpi_cards": [],
            "smart_insights": {
                "executive_summary": "Mock response",
                "actionable_insights": [],
                "recommendation": "Mock recommendation",
            },
        })
        # Replace the AI module before app import: no OpenAI client or .env read.
        # Also reject network connections in case a future path bypasses the mock.
        with patch.dict(sys.modules, {"services.ai_service": ai}), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            app = importlib.import_module("main").app
            stream = io.BytesIO()
            with pd.ExcelWriter(stream, engine="openpyxl") as writer:
                pd.DataFrame({
                    "category": ["Widget", "Gadget", "Widget"],
                    "amount": [10, 20, 30],
                    "date": pd.Series(["2026-01-01", "2026-01-02", "2026-01-03"], dtype="datetime64[us]"),
                }).to_excel(writer, sheet_name="Sales", index=False)
                pd.DataFrame({"item": ["Widget", "Gadget"], "quantity": [2, 4]}).to_excel(
                    writer, sheet_name="Inventory", index=False
                )
            file_bytes = stream.getvalue()
            body = (
                b'--phase0\r\nContent-Disposition: form-data; name="file"; filename="smoke.xlsx"\r\n'
                b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
                + file_bytes + b"\r\n--phase0--\r\n"
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
                                    (b"content-type", b"multipart/form-data; boundary=phase0")],
                    }, receive, send)

            complete_in_memory(request())
            self.assertEqual(next(m["status"] for m in messages if m["type"] == "http.response.start"), 200)
            result = json.loads(b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body"))
            self.assertEqual(result["available_sheets"], ["Sales", "Inventory"])
            self.assertEqual(result["active_sheet"], "Sales")
            self.assertEqual(set(result["sheets"]), {"Sales", "Inventory"})
            sales = result["sheets"]["Sales"]
            self.assertEqual((sales["row_count"], sales["column_count"]), (3, 3))
            self.assertEqual(sales["date_columns"], ["date"])
            self.assertEqual(sales["numeric_columns"], ["amount"])
            self.assertEqual(sales["text_columns"], ["category"])
            self.assertEqual(sales["numeric_kpis"]["amount"], {"sum": 60, "average": 20, "min": 10, "max": 30})
            self.assertEqual(sales["summary_stats"]["amount"]["count"], 3)
            self.assertEqual(sales["categorical_summary"]["category"], {"Widget": 2, "Gadget": 1})
            self.assertEqual(sales["records"][0]["date"], "2026-01-01")
            self.assertEqual(result["sheets"]["Inventory"]["numeric_kpis"]["quantity"]["sum"], 6)
            for key in sales:
                if key != "sheet_name":
                    self.assertEqual(result[key], sales[key], key)
            self.assertEqual(result["file_size_bytes"], len(file_bytes))
            self.assertTrue(result["uploaded_at"])
            self.assertEqual(ai.generate_ai_insights.call_count, 2)
            json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
