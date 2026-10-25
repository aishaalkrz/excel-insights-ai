"""F06 regressions with a mocked provider client and prohibited network access."""

import builtins
import importlib
import io
import json
import sys
import types
import unittest
from unittest.mock import Mock, patch

import pandas as pd

from services.sheet_service import process_sheet
from test_phase0_baseline import complete_in_memory


class ProviderStatusError(Exception):
    def __init__(self, status_code):
        super().__init__("Private diagnostic marker")
        self.status_code = status_code


def completion(payload):
    return types.SimpleNamespace(choices=[types.SimpleNamespace(
        message=types.SimpleNamespace(content=payload)
    )])


def valid_insights(summary="Successful mock"):
    return {"executive_summary": summary, "actionable_insights": [], "recommendation": "Mock recommendation"}


def mock_config():
    config = types.ModuleType("core.config")
    config.client = Mock()
    config.client.with_options.return_value = config.client
    return config


class AiResilienceTests(unittest.TestCase):
    def sheet(self):
        return process_sheet("Sales", pd.DataFrame({"price": [10, 20]}))

    def test_auth_rate_limit_timeout_connection_and_server_failures_are_safe(self):
        failures = [ProviderStatusError(401), ProviderStatusError(429),
                    TimeoutError("Private diagnostic marker"),
                    ConnectionError("Private diagnostic marker"),
                    ProviderStatusError(500), ProviderStatusError(503)]
        for error in failures:
            with self.subTest(error=type(error).__name__, status=getattr(error, "status_code", None)):
                config = mock_config()
                config.client.chat.completions.create.side_effect = error
                with patch.dict(sys.modules, {"core.config": config}), patch(
                    "socket.socket.connect", side_effect=AssertionError("Network prohibited")
                ):
                    module = importlib.import_module("services.ai_service")
                    with self.assertLogs("excel-insights-api", level="WARNING") as logs:
                        result = module.generate_ai_insights("small.xlsx", "Sales", ["Sales"], self.sheet())
                self.assertEqual(result, {"status": "unavailable", "smart_insights": None})
                self.assertNotIn("kpi_cards", result)  # Angular uses numeric_kpis instead.
                self.assertNotIn("Private diagnostic marker", json.dumps(result) + str(logs.output))
                config.client.with_options.assert_called_once_with(timeout=15.0, max_retries=0)
                self.assertEqual(config.client.chat.completions.create.call_count, 1)

    def test_client_initialization_failure_does_not_prevent_app_import_or_analysis(self):
        original_import = builtins.__import__

        def unavailable_config(name, *args, **kwargs):
            if name == "core.config":
                raise RuntimeError("Private diagnostic marker")
            return original_import(name, *args, **kwargs)

        with patch.dict(sys.modules), patch("builtins.__import__", side_effect=unavailable_config), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            app = importlib.import_module("main").app
            self.assertIn("/upload/", app.openapi()["paths"])
            service = importlib.import_module("services.ai_service")
            result = service.generate_ai_insights("small.xlsx", "Sales", ["Sales"], self.sheet())
            self.assertEqual(result, {"status": "unavailable", "smart_insights": None})

    def test_successful_ai_keeps_insights_and_calculated_kpi_values(self):
        config = mock_config()
        config.client.chat.completions.create.return_value = completion(json.dumps({
            "kpi_cards": [{"column": "price", "statistic": "sum", "value": 999,
                           "label": "Total", "description": "Mock", "metricType": "price"}],
            "smart_insights": valid_insights(),
        }))
        with patch.dict(sys.modules, {"core.config": config}), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            service = importlib.import_module("services.ai_service")
            result = service.generate_ai_insights("small.xlsx", "Sales", ["Sales"], self.sheet())
        self.assertEqual(result["kpi_cards"], [{
            "value": 30, "label": "Total", "description": "Mock", "metricType": "price",
        }])
        self.assertEqual(result["smart_insights"], valid_insights())
        self.assertNotIn("status", result)

    def test_unusable_response_returns_no_raw_provider_content(self):
        malformed = [
            {}, {"kpi_cards": "invalid"}, {"kpi_cards": None, "smart_insights": valid_insights()},
            {"kpi_cards": [], "smart_insights": None}, {"kpi_cards": []},
            {"kpi_cards": [], "smart_insights": "invalid"},
            {"kpi_cards": [], "smart_insights": {"executive_summary": "Missing fields"}},
            {"kpi_cards": [], "smart_insights": {**valid_insights(), "executive_summary": 1}},
            {"kpi_cards": [], "smart_insights": {**valid_insights(), "recommendation": []}},
            {"kpi_cards": [], "smart_insights": {**valid_insights(), "actionable_insights": "invalid"}},
            {"kpi_cards": [], "smart_insights": {**valid_insights(), "actionable_insights": [1]}},
            {"kpi_cards": [None], "smart_insights": valid_insights()},
            {"kpi_cards": [{"column": "price", "statistic": "sum", "value": 30}], "smart_insights": valid_insights()},
        ]
        for content in ("Private diagnostic marker", None, "[]", *(json.dumps(item) for item in malformed)):
            with self.subTest(content=content):
                config = mock_config()
                config.client.chat.completions.create.return_value = completion(content)
                with patch.dict(sys.modules, {"core.config": config}), patch(
                    "socket.socket.connect", side_effect=AssertionError("Network prohibited")
                ):
                    service = importlib.import_module("services.ai_service")
                    result = service.generate_ai_insights("small.xlsx", "Sales", ["Sales"], self.sheet())
                self.assertEqual(result, {"status": "unavailable", "smart_insights": None})
                self.assertNotIn("raw_response", result)

    def test_legitimate_empty_kpis_without_eligible_measures_remain_successful(self):
        config = mock_config()
        expected = {"kpi_cards": [], "smart_insights": valid_insights()}
        config.client.chat.completions.create.return_value = completion(json.dumps(expected))
        with patch.dict(sys.modules, {"core.config": config}), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            service = importlib.import_module("services.ai_service")
            sheet = process_sheet("IDs", pd.DataFrame({"order_id": [1, 2]}))
            result = service.generate_ai_insights("small.xlsx", "IDs", ["IDs"], sheet)
        self.assertEqual(result, expected)

    def test_empty_cards_with_eligible_measures_activate_calculated_fallback(self):
        config = mock_config()
        config.client.chat.completions.create.return_value = completion(json.dumps({
            "kpi_cards": [], "smart_insights": valid_insights(),
        }))
        with patch.dict(sys.modules, {"core.config": config}), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            service = importlib.import_module("services.ai_service")
            result = service.generate_ai_insights("small.xlsx", "Sales", ["Sales"], self.sheet())
        self.assertEqual(result, {"status": "unavailable", "smart_insights": None})


class UploadResilienceTests(unittest.TestCase):
    def upload(self, provider_results):
        frames = {
            "Sales": pd.DataFrame({"order_id": [1, 2, 3], "category": ["A", "B", "A"],
                                   "price": [0, -5, 20], "quantity": [1, 2, 3]}),
            "Inventory": pd.DataFrame({"category": ["A", "B"], "price": [10, 20], "quantity": [3, 4]}),
        }
        stream = io.BytesIO()
        with pd.ExcelWriter(stream, engine="openpyxl") as writer:
            for name, frame in frames.items():
                frame.to_excel(writer, sheet_name=name, index=False)
        body = (
            b'--f06\r\nContent-Disposition: form-data; name="file"; filename="small.xlsx"\r\n'
            b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
            + stream.getvalue() + b"\r\n--f06--\r\n"
        )
        config = mock_config()
        config.client.chat.completions.create.side_effect = provider_results
        with patch.dict(sys.modules, {"core.config": config}), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            app = importlib.import_module("main").app
            messages = []

            async def receive():
                return {"type": "http.request", "body": body, "more_body": False}

            async def send(message):
                messages.append(message)

            async def request():
                async with app.router.lifespan_context(app):
                    await app({
                        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                        "method": "POST", "scheme": "http", "path": "/upload/", "raw_path": b"/upload/",
                        "query_string": b"", "root_path": "", "server": ("testserver", 80),
                        "client": ("127.0.0.1", 1234),
                        "headers": [(b"host", b"testserver"),
                                    (b"content-type", b"multipart/form-data; boundary=f06")],
                    }, receive, send)

            complete_in_memory(request())
            self.assertEqual(next(m["status"] for m in messages if m["type"] == "http.response.start"), 200)
            raw = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
            self.assertNotIn(b"Private diagnostic marker", raw)
            result = json.loads(raw)
            self.assertEqual(result["available_sheets"], list(frames))
            for name, frame in frames.items():
                actual = result["sheets"][name]
                expected = process_sheet(name, frame)
                self.assertEqual({key: actual[key] for key in expected}, expected)
                self.assertTrue(actual["chart_suggestions"])
            for key in ("numeric_kpis", "summary_stats", "chart_suggestions", "records", "ai_insights"):
                self.assertEqual(result[key], result["sheets"]["Sales"][key])
            self.assertEqual(config.client.chat.completions.create.call_count, 2)
            return result

    def test_multisheet_analysis_succeeds_when_all_ai_requests_fail(self):
        result = self.upload([ProviderStatusError(401), TimeoutError("Private diagnostic marker")])
        for sheet in result["sheets"].values():
            self.assertEqual(sheet["ai_insights"], {"status": "unavailable", "smart_insights": None})
        self.assertEqual(result["numeric_kpis"]["price"]["sum"], 15)
        self.assertNotIn("order_id", result["numeric_kpis"])

    def test_a_failed_sheet_does_not_discard_another_sheets_successful_insights(self):
        result = self.upload([
            completion(json.dumps({"kpi_cards": [{"column": "price", "statistic": "sum", "value": 999,
                                                 "label": "Mock", "description": "Mock", "metricType": "price"}],
                                   "smart_insights": valid_insights()})),
            ProviderStatusError(429),
        ])
        self.assertEqual(result["sheets"]["Sales"]["ai_insights"]["kpi_cards"][0]["value"], 15)
        self.assertEqual(result["sheets"]["Inventory"]["ai_insights"]["status"], "unavailable")


class UploadErrorTests(unittest.TestCase):
    def request(self, app, filename="invalid.txt"):
        body = (
            f'--errors\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            'Content-Type: application/octet-stream\r\n\r\ninvalid content\r\n--errors--\r\n'
        ).encode() if filename else b"--errors--\r\n"
        messages = []

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            messages.append(message)

        complete_in_memory(app({
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "POST", "scheme": "http", "path": "/upload/", "raw_path": b"/upload/",
            "query_string": b"", "root_path": "", "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "headers": [(b"host", b"testserver"), (b"content-type", b"multipart/form-data; boundary=errors")],
        }, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        payload = json.loads(b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body"))
        return status, payload

    def test_unsupported_file_remains_400_and_does_not_call_ai(self):
        with patch.dict(sys.modules), patch("socket.socket.connect", side_effect=AssertionError("Network prohibited")):
            app = importlib.import_module("main").app
            upload = importlib.import_module("routers.upload")
            with patch.object(upload, "generate_ai_insights") as ai, self.assertLogs("excel-insights-api", level="ERROR"):
                status, payload = self.request(app)
            self.assertEqual(status, 400)
            self.assertEqual(payload, {"detail": "Only .xlsx, .xls, and .csv files are supported"})
            ai.assert_not_called()

    def test_unexpected_reading_and_analysis_errors_return_generic_500_with_server_logs(self):
        for target in ("read_uploaded_file", "process_sheet"):
            with self.subTest(target=target), patch.dict(sys.modules), patch(
                "socket.socket.connect", side_effect=AssertionError("Network prohibited")
            ):
                app = importlib.import_module("main").app
                upload = importlib.import_module("routers.upload")
                with patch.object(upload, "read_uploaded_file", return_value={"Sheet": pd.DataFrame({"price": [1]})}), patch.object(
                    upload, target, side_effect=RuntimeError("Private diagnostic marker")
                ), patch.object(upload, "generate_ai_insights") as ai, self.assertLogs("excel-insights-api", level="ERROR") as logs:
                    status, payload = self.request(app, "small.xlsx")
                self.assertEqual(status, 500)
                self.assertEqual(payload, {"detail": "An error occurred while processing the file. Please try again."})
                self.assertNotIn("Private diagnostic marker", json.dumps(payload))
                self.assertIn("Private diagnostic marker", str(logs.output))
                ai.assert_not_called()

    def test_intentional_http_exception_and_missing_file_validation_are_preserved(self):
        from fastapi import HTTPException

        with patch.dict(sys.modules), patch("socket.socket.connect", side_effect=AssertionError("Network prohibited")):
            app = importlib.import_module("main").app
            upload = importlib.import_module("routers.upload")
            with patch.object(upload, "read_uploaded_file", side_effect=HTTPException(400, "Invalid spreadsheet")), self.assertLogs(
                "excel-insights-api", level="ERROR"
            ):
                self.assertEqual(self.request(app, "small.xlsx"), (400, {"detail": "Invalid spreadsheet"}))
            status, payload = self.request(app, filename=None)
            self.assertEqual(status, 422)
            self.assertIsInstance(payload["detail"], list)

    def test_empty_workbook_remains_400(self):
        with patch.dict(sys.modules), patch("socket.socket.connect", side_effect=AssertionError("Network prohibited")):
            app = importlib.import_module("main").app
            upload = importlib.import_module("routers.upload")
            with patch.object(upload, "read_uploaded_file", return_value={"Empty": pd.DataFrame()}), patch.object(
                upload, "generate_ai_insights"
            ) as ai, self.assertLogs("excel-insights-api", level="ERROR"):
                self.assertEqual(self.request(app, "small.xlsx"), (400, {"detail": "The uploaded file is empty"}))
                ai.assert_not_called()


if __name__ == "__main__":
    unittest.main()
