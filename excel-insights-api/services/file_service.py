from pathlib import Path
from fastapi import HTTPException
import pandas as pd


def read_uploaded_file(file):
    ext = Path(file.filename).suffix.lower()

    if ext not in [".xlsx", ".xls", ".csv"]:
        raise HTTPException(
            status_code=400,
            detail="Only .xlsx, .xls, and .csv files are supported"
        )

    if ext == ".csv":
        df = pd.read_csv(file.file)
        return {
            "CSV File": df
        }

    if ext == ".xlsx":
        return pd.read_excel(
            file.file,
            sheet_name=None,
            engine="openpyxl"
        )

    return pd.read_excel(
        file.file,
        sheet_name=None,
        engine="xlrd"
    )