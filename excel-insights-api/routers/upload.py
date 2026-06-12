import time
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File, HTTPException

from core.logger import logger
from services.file_service import read_uploaded_file
from services.sheet_service import process_sheet
from services.ai_service import generate_ai_insights
from utils.formatters import format_file_size

router = APIRouter()


@router.post("/upload/")
async def upload_excel(file: UploadFile = File(...)):
    start_time = time.time()
    uploaded_at = datetime.now(timezone.utc).isoformat()

    file_bytes = await file.read()
    file_size = len(file_bytes)
    file.file.seek(0)

    try:
        logger.info(
            "Upload started | filename=%s | content_type=%s",
            file.filename,
            file.content_type
        )

        sheets = read_uploaded_file(file)

        available_sheets = list(sheets.keys())
        processed_sheets = {}
        active_sheet_name = None

        for sheet_name, sheet_df in sheets.items():
            if sheet_df.empty:
                continue

            processed_sheet = process_sheet(sheet_name, sheet_df)

            processed_sheet["ai_insights"] = generate_ai_insights(
                file_name=file.filename,
                active_sheet_name=sheet_name,
                available_sheets=available_sheets,
                active_sheet=processed_sheet
            )

            processed_sheets[sheet_name] = processed_sheet

            if active_sheet_name is None:
                active_sheet_name = sheet_name

        if not processed_sheets or active_sheet_name is None:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty"
            )

        active_sheet = processed_sheets[active_sheet_name]
        ai_insights = active_sheet["ai_insights"]

        duration = round(time.time() - start_time, 2)

        logger.info(
            "Upload completed | filename=%s | active_sheet=%s | sheets=%s | duration=%s",
            file.filename,
            active_sheet_name,
            available_sheets,
            duration
        )

        return {
            "filename": file.filename,
            "active_sheet": active_sheet_name,
            "available_sheets": available_sheets,
            "sheets": processed_sheets,

            "row_count": active_sheet["row_count"],
            "column_count": active_sheet["column_count"],
            "columns": active_sheet["columns"],
            "field_metadata": active_sheet["field_metadata"],
            "numeric_columns": active_sheet["numeric_columns"],
            "text_columns": active_sheet["text_columns"],
            "date_columns": active_sheet["date_columns"],
            "numeric_kpis": active_sheet["numeric_kpis"],
            "categorical_summary": active_sheet["categorical_summary"],
            "summary_stats": active_sheet["summary_stats"],
            "chart_suggestions": active_sheet["chart_suggestions"],
            "records": active_sheet["records"],
            "sample_data": active_sheet["sample_data"],
            "ai_insights": ai_insights,

            "uploaded_at": uploaded_at,
            "file_size": format_file_size(file_size),
            "file_size_bytes": file_size
        }

    except HTTPException:
        logger.exception(
            "HTTP error while processing upload | filename=%s",
            file.filename
        )
        raise

    except Exception as e:
        logger.exception(
            "Unexpected error while processing upload | filename=%s",
            file.filename
        )
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing the file: {str(e)}"
        )