#!/usr/bin/env python3
import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env from skill directory
skill_dir = Path(__file__).parent.parent
load_dotenv(skill_dir / ".env")

sys.path.insert(0, str(skill_dir / "scripts"))

from deepseek_ocr import DeepSeekEngine
from paddle_ocr import PaddleEngine


def main():
    parser = argparse.ArgumentParser(description="Convert PDF to Markdown (DeepSeek first, Paddle fallback)")
    parser.add_argument("pdf", help="Path to PDF file")
    parser.add_argument("--output", help="Output directory")
    args = parser.parse_args()

    pdf_path = args.pdf
    if not os.path.exists(pdf_path):
        print(f"Error: file not found: {pdf_path}")
        sys.exit(1)

    if args.output:
        output_dir = args.output
    else:
        pdf_dir = os.path.dirname(os.path.abspath(pdf_path))
        output_dir = os.path.join(pdf_dir, "output", "pdf-to-md")

    temp_dir = os.path.join(output_dir, "temp_pages")

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "")
    paddle_api_url = os.environ.get("PADDLE_API_URL", "")
    paddle_token = os.environ.get("PADDLE_TOKEN", "")

    engines = []
    if api_key and base_url:
        engines.append(DeepSeekEngine(api_key=api_key, base_url=base_url))
    if paddle_api_url and paddle_token:
        engines.append(PaddleEngine(api_url=paddle_api_url, token=paddle_token))

    if not engines:
        print("Error: at least one engine must be configured in .env (DEEPSEEK_* or PADDLE_*)")
        sys.exit(1)

    from pipeline import PDFPipeline
    result = PDFPipeline(engines).process_pdf(pdf_path, output_dir, temp_dir)
    print(f"\nOutput: {result}")


if __name__ == "__main__":
    main()
