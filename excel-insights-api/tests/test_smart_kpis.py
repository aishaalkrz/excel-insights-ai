"""Focused F03 identifier and AI KPI regressions; AI client is always mocked."""

import importlib
import json
import sys
import types
import unittest
from unittest.mock import Mock, patch

import pandas as pd

from services.sheet_service import detect_numeric_identifiers, process_sheet


class IdentifierDetectionTests(unittest.TestCase):
    def test_order_id_and_price_preserve_display_contract(self):
        df = pd.DataFrame({"order_id": [1001, 1002, 1003], "Price": [12.5, 15.0, 20.0]})
        result = process_sheet("Orders", df)
        self.assertEqual(result["numeric_columns"], ["order_id", "Price"])
        self.assertEqual(result["columns"], list(df.columns))
        self.assertEqual(result["records"], df.to_dict(orient="records"))
        self.assertEqual(result["sample_data"], result["records"])
        self.assertEqual(result["field_metadata"], [
            {"name": "order_id", "type": "number", "is_identifier": True},
            {"name": "Price", "type": "number"},
        ])
        self.assertEqual(set(result["numeric_kpis"]), {"Price"})
        self.assertEqual(set(result["summary_stats"]), {"Price"})
        self.assertEqual(result["numeric_kpis"]["Price"]["sum"], 47.5)
        self.assertEqual(result["chart_suggestions"], [])

    def test_explicit_english_names_and_repeated_ids(self):
        for name in ("id", "order_id", "customer_id", "Order ID", "CustomerId", "OrderID", "invoice_number"):
            with self.subTest(name=name):
                df = pd.DataFrame({name: [1, 1, 2]})
                self.assertEqual(detect_numeric_identifiers(df, [name]), [name])

    def test_arabic_names(self):
        for name in ("رقم الطلب", "معرف العميل", "رقم_الطلب", "مُعرّف العميل"):
            with self.subTest(name=name):
                result = process_sheet("Arabic", pd.DataFrame({name: [1, 2], "السعر": [10, 20]}))
                self.assertEqual(set(result["numeric_kpis"]), {"السعر"})
                self.assertEqual(result["field_metadata"][0]["type"], "number")
                self.assertTrue(result["field_metadata"][0]["is_identifier"])

    def test_unique_sequential_measures_are_not_identifiers(self):
        df = pd.DataFrame({"Price": [10, 20, 30], "Quantity": [1, 2, 3], "Revenue": [100, 200, 300]})
        result = process_sheet("Measures", df)
        self.assertEqual(detect_numeric_identifiers(df, list(df.columns)), [])
        self.assertEqual(set(result["numeric_kpis"]), set(df.columns))
        self.assertEqual(result["summary_stats"], df.describe().to_dict())

    def test_ambiguous_names_and_conflicting_values_remain_measures(self):
        for name, values in (("number", [1, 2]), ("رقم", [1, 2]), ("id_count", [1, 2]),
                             ("discount", [1, 2]), ("order_id", [1.5, 2.5]), ("customer_id", [-1, 2])):
            with self.subTest(name=name, values=values):
                result = process_sheet("Ambiguous", pd.DataFrame({name: values}))
                self.assertIn(name, result["numeric_kpis"])

    def test_missing_and_all_missing_identifiers(self):
        for dtype in ("float64", "Int64"):
            for values in ([1, None, 3], [None, None, None]):
                with self.subTest(dtype=dtype, values=values):
                    df = pd.DataFrame({"customer_id": pd.Series(values, dtype=dtype), "price": [10, 20, 30]})
                    result = process_sheet("Missing", df)
                    self.assertNotIn("customer_id", result["numeric_kpis"])
                    self.assertEqual(result["records"][1]["customer_id"], None)
                    json.dumps(result, allow_nan=False)

    def test_identifier_only_data_has_no_automatic_measures_or_charts(self):
        result = process_sheet("IDs", pd.DataFrame({"order_id": [1, 2], "customer_id": [3, 4]}))
        self.assertEqual(result["numeric_columns"], ["order_id", "customer_id"])
        self.assertEqual(result["numeric_kpis"], {})
        self.assertEqual(result["summary_stats"], {})
        self.assertEqual(result["chart_suggestions"], [])
        self.assertEqual(len(result["records"]), 2)

    def test_mixed_identifiers_dates_categories_and_measures(self):
        df = pd.DataFrame({
            "order_id": [101, 102, 103, 104, None],
            "date": pd.Series(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "Pending"], dtype=object),
            "category": ["A", "B", "A", "B", "A"],
            "price": [0.0, -5.0, None, float("inf"), 20.0],
            "quantity": [1, 2, 3, 4, 5],
        })
        original = df.copy(deep=True)
        result = process_sheet("Mixed", df)
        pd.testing.assert_frame_equal(df, original)
        self.assertEqual(result["numeric_columns"], ["order_id", "price", "quantity"])
        self.assertEqual(set(result["numeric_kpis"]), {"price", "quantity"})
        self.assertEqual(result["numeric_kpis"]["price"], {"sum": 15, "average": 5, "min": -5, "max": 20})
        self.assertEqual(result["records"][3]["price"], None)
        self.assertEqual(result["records"][4]["date"], "Pending")
        self.assertEqual(result["date_columns"], ["date"])
        self.assertTrue(result["chart_suggestions"])
        for chart in result["chart_suggestions"]:
            self.assertNotEqual(chart["xKey"], "order_id")
            self.assertNotEqual(chart["yKey"], "order_id")
            self.assertIn("order_id", chart["data"][0])
        json.dumps(result, allow_nan=False)


class AiKpiTests(unittest.TestCase):
    def call_mocked_ai(self, sheet, cards):
        config = types.ModuleType("core.config")
        config.client = Mock()
        config.client.with_options.return_value = config.client
        config.client.chat.completions.create.return_value = types.SimpleNamespace(choices=[
            types.SimpleNamespace(message=types.SimpleNamespace(content=json.dumps({
                "kpi_cards": [{"label": "Mock", "description": "Mock", "metricType": "general", **card}
                              for card in cards],
                "smart_insights": {"executive_summary": "Mock only", "actionable_insights": [], "recommendation": "Mock only"},
            })))
        ])
        with patch.dict(sys.modules, {"core.config": config}), patch(
            "socket.socket.connect", side_effect=AssertionError("Network prohibited")
        ):
            module = importlib.import_module("services.ai_service")
            result = module.generate_ai_insights("sample.xlsx", "Orders", ["Orders"], sheet)
        prompt = config.client.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        return result, prompt

    def test_one_measure_prompt_and_values_are_bound_to_calculated_statistics(self):
        sheet = process_sheet("Orders", pd.DataFrame({"order_id": [1001, 1002], "price": [10, 20]}))
        result, prompt = self.call_mocked_ai(sheet, [
            {"column": "order_id", "statistic": "sum", "value": 2003, "label": "ID"},
            {"column": "price", "statistic": "sum", "value": 999999, "label": "Price", "description": "Mock", "metricType": "price"},
            {"column": "price", "statistic": "average", "value": 15, "label": "Duplicate"},
        ])
        self.assertIn("between 0 and 1 KPI cards", prompt)
        self.assertNotIn("EXACTLY 4", prompt)
        self.assertEqual(result["kpi_cards"], [
            {"value": 30, "label": "Price", "description": "Mock", "metricType": "price"},
        ])

    def test_identifier_only_and_unavailable_measures_return_empty_kpi_cards(self):
        for df in (pd.DataFrame({"order_id": [1, 2]}), pd.DataFrame({"price": [float("nan"), float("nan")]})):
            with self.subTest(columns=list(df.columns)):
                result, prompt = self.call_mocked_ai(process_sheet("Empty", df), [
                    {"column": "order_id", "statistic": "sum", "value": 3},
                    {"column": "price", "statistic": "sum", "value": 0},
                ])
                self.assertIn("between 0 and 0 KPI cards", prompt)
                self.assertEqual(result["kpi_cards"], [])

    def test_zero_and_negative_ai_statistics_remain_valid(self):
        sheet = process_sheet("Values", pd.DataFrame({"price": [-5, 5], "discount": [-2, -4]}))
        result, _ = self.call_mocked_ai(sheet, [
            {"column": "price", "statistic": "sum", "value": 100},
            {"column": "discount", "statistic": "min", "value": 100},
        ])
        self.assertEqual([card["value"] for card in result["kpi_cards"]], [0, -4])


if __name__ == "__main__":
    unittest.main()
