"""F05: compact suggestions must identify their limits; full records stay available."""
import unittest

import pandas as pd

from services.sheet_service import process_sheet


class ChartPreviewMetadataTests(unittest.TestCase):
    def test_large_sheet_preserves_all_records_and_marks_suggestion_preview(self):
        result = process_sheet("Sales", pd.DataFrame({
            "category": ["A"] * 149 + ["B"],
            "amount": [1] * 149 + [10000],
            "quantity": list(range(150)),
        }))
        self.assertEqual(len(result["records"]), 150)
        self.assertEqual(result["records"][-1]["amount"], 10000)
        self.assertEqual(result["numeric_kpis"]["amount"]["sum"], 10149)
        for chart in result["chart_suggestions"]:
            self.assertEqual(len(chart["data"]), 100)
            self.assertEqual(chart["sourceRecordCount"], 150)
            self.assertTrue(chart["isSampled"])
            self.assertFalse(chart["isAggregated"])

    def test_small_suggestion_is_complete(self):
        result = process_sheet("Sales", pd.DataFrame({"category": ["A", "B"], "amount": [0, -1]}))
        self.assertFalse(result["chart_suggestions"][0]["isSampled"])
        self.assertEqual(result["chart_suggestions"][0]["sourceRecordCount"], 2)


if __name__ == "__main__":
    unittest.main()
