#!/usr/bin/env python3
"""PDF-to-MD pipeline with retry and engine fallback."""
import os
from typing import Any, List, Tuple


class PDFPipeline:
    """
    Processes a PDF through a chain of OCR engines.
    DeepSeek-OCR is primary, Paddle is fallback.
    Per-page retry up to 3 times. Aborts after 3 consecutive page failures.
    """

    MAX_RETRIES = 3
    CONSECUTIVE_FAIL_LIMIT = 3

    def __init__(self, engines: List[Any]):
        self.engines = engines

    def _split_pages(self, pdf_path: str, temp_dir: str) -> List[str]:
        return self.engines[0].split_pdf_to_pages(pdf_path, temp_dir)

    def process_pdf(self, pdf_path: str, output_dir: str, temp_dir: str = "output/temp_pages") -> str:
        os.makedirs(output_dir, exist_ok=True)
        pages = self._split_pages(pdf_path, temp_dir)
        total = len(pages)
        print(f"[Pipeline] {total} pages, engines: {[e.name for e in self.engines]}")

        all_markdown = []
        consecutive_fails = 0
        last_error = ""

        for i, page_path in enumerate(pages):
            page_num = i + 1
            md = None
            error_msg = ""

            # Try each engine, with retry
            for engine in self.engines:
                for attempt in range(1, self.MAX_RETRIES + 1):
                    print(f"[Pipeline] page {page_num} -> {engine.name} (attempt {attempt}/{self.MAX_RETRIES})")
                    content, err = engine.call_ocr(page_path) if hasattr(engine, "call_ocr") else engine.call_api(page_path, file_type=0)
                    if err is None:
                        md = content
                        error_msg = ""
                        break
                    error_msg = str(err)
                    print(f"[Pipeline]   failed: {error_msg[:120]}")

                if md:
                    break  # success, move to next page

            if not md:
                consecutive_fails += 1
                last_error = error_msg
                print(f"[Pipeline] page {page_num} FAILED after {self.MAX_RETRIES} retries on all engines")
                if consecutive_fails >= self.CONSECUTIVE_FAIL_LIMIT:
                    msg = (
                        f"Abort: {self.CONSECUTIVE_FAIL_LIMIT} consecutive pages failed. "
                        f"Last error: {last_error}"
                    )
                    # Write whatever we have so far
                    out_path = os.path.join(output_dir, "final_output.md")
                    with open(out_path, "w", encoding="utf-8") as f:
                        if all_markdown:
                            f.write("".join(all_markdown))
                            f.write(f"\n\n---\n\n{msg}\n")
                        else:
                            f.write(f"# Conversion Failed\n\n{msg}\n")
                    print(f"[Pipeline] {msg}")
                    return out_path
                continue

            # Process bounding boxes for DeepSeek results
            if hasattr(self.engines[0], "extract_image_with_bbox") and "<|ref|>" in md:
                imgs, others = self.engines[0].extract_image_with_bbox(md)
                if imgs or others:
                    page_img = self.engines[0].pdf_page_to_image(page_path)
                    w, h = page_img.size
                    for idx, (_, elem_tag, bbox, _) in enumerate(imgs):
                        x1, y1, x2, y2 = [int(v / 999 * (w if j % 2 == 0 else h)) for j, v in enumerate(bbox)]
                        img_name = f"page_{page_num}_image_{idx + 1}.png"
                        img_path = os.path.join(output_dir, img_name)
                        os.makedirs(os.path.dirname(img_path), exist_ok=True)
                        cropped = page_img.crop((x1, y1, x2, y2))
                        cropped.save(img_path)
                        md = md.replace(elem_tag, f"\n\n![image]({img_name})\n\n")
                    for tag in others:
                        md = md.replace(tag, "")

            # Handle Paddle image metadata
            if "<!-- paddle_images:" in md:
                import json, re
                m = re.search(r"<!-- paddle_images:\s*(.+?)\s*-->", md, re.DOTALL)
                if m:
                    img_meta = json.loads(m.group(1))
                    for img_path, img_url in img_meta.get("images", {}).items():
                        try:
                            import requests
                            img_bytes = requests.get(img_url, timeout=30).content
                            full_path = os.path.join(output_dir, img_path)
                            os.makedirs(os.path.dirname(full_path), exist_ok=True)
                            with open(full_path, "wb") as f:
                                f.write(img_bytes)
                        except Exception as e:
                            print(f"[Pipeline] Paddle image download failed {img_path}: {e}")
                    md = md[:m.start()] + md[m.end():]

            consecutive_fails = 0
            all_markdown.append(md)
            print(f"[Pipeline] page {page_num} OK")

        out_path = os.path.join(output_dir, "final_output.md")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("".join(all_markdown))
        print(f"[Pipeline] Done: {len(all_markdown)}/{total} pages converted")
        return out_path
