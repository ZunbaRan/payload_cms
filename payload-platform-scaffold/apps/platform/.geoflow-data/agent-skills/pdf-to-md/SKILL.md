---
name: pdf-to-md
description: Convert PDF documents to high-quality Markdown. Uses DeepSeek-OCR as primary engine with automatic retry (3x) and Paddle layout-parsing as fallback. Aborts after 3 consecutive page failures and returns error details. Use when the user asks to "pdf转md", "pdf转markdown", "convert pdf to markdown", "ocr pdf", "extract text from pdf", or provides a PDF file with conversion intent.
---

# PDF to Markdown

Converts PDF files to Markdown with automatic retry and engine fallback.

## Pipeline Behavior

1. **Primary engine**: DeepSeek-OCR (via OpenAI-compatible API)
2. **Fallback engine**: Paddle layout-parsing API
3. **Per-page retry**: Each page is retried up to 3 times on the current engine before falling back
4. **Abort condition**: If 3 consecutive pages fail across all engines, processing stops and the error is returned
5. **Partial output**: On abort, successfully converted pages are saved and error details appended

## Configuration

API credentials are stored in `.env` file in this skill directory. Auto-loaded on every invocation.

| Variable | Description |
|----------|-------------|
| `DEEPSEEK_API_KEY` | API key for DeepSeek-OCR |
| `DEEPSEEK_BASE_URL` | Base URL for the OpenAI-compatible API endpoint |
| `PADDLE_API_URL` | Layout-parsing API URL |
| `PADDLE_TOKEN` | Auth token for Paddle API |

Copy `.env.example` to `.env` and fill in the values before first use.

## Usage

```
/pdf-to-md <pdf-file> [--output <dir>]
```

- `<pdf-file>`: Path to the PDF file
- `--output`: Output directory. Defaults to `{pdf-dir}/output/pdf-to-md/`

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/main.py` | CLI entry point. Loads .env, dispatches through pipeline |
| `scripts/pipeline.py` | Core pipeline with retry logic and engine fallback |
| `scripts/deepseek_ocr.py` | DeepSeek-OCR engine: bbox grounding, image cropping |
| `scripts/paddle_ocr.py` | Paddle engine: layout parsing, image downloading |

## Dependencies

- `openai` (Python package)
- `pymupdf` (Python package, import as `fitz`)
- `requests` (Python package)
- `Pillow` (Python package)
- `python-dotenv` (Python package)

Install: `pip install openai pymupdf requests Pillow python-dotenv`
