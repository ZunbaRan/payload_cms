#!/usr/bin/env python3
import base64
import io
import os
import re
from typing import List, Optional, Tuple
from openai import OpenAI
from PIL import Image

try:
    import fitz
except ImportError:
    print("需要安装: pip install pymupdf")
    raise


class DeepSeekEngine:
    name = "DeepSeek-OCR"

    def __init__(self, api_key: str, base_url: str):
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def split_pdf_to_pages(self, pdf_path: str, output_dir: str) -> List[str]:
        os.makedirs(output_dir, exist_ok=True)
        page_paths = []
        with fitz.open(pdf_path) as doc:
            for page_num in range(doc.page_count):
                single = fitz.open()
                single.insert_pdf(doc, from_page=page_num, to_page=page_num)
                path = os.path.join(output_dir, f"page_{page_num + 1}.pdf")
                single.save(path)
                single.close()
                page_paths.append(path)
        return page_paths

    def call_ocr(self, pdf_path: str) -> Tuple[str, Optional[Exception]]:
        with open(pdf_path, "rb") as f:
            pdf_b64 = base64.b64encode(f.read()).decode("utf-8")
        try:
            resp = self.client.chat.completions.create(
                model="deepseek-ai/DeepSeek-OCR",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:application/pdf;base64,{pdf_b64}"}},
                        {"type": "text", "text": "<image>\n<|grounding|>Convert the document to markdown."},
                    ],
                }],
            )
            return resp.choices[0].message.content, None
        except Exception as e:
            return "", e

    def extract_image_with_bbox(self, markdown: str) -> Tuple[List[Tuple[str, str, Tuple[int, int, int, int], str]], List[str]]:
        images = []
        others = []
        pattern = r"<\|ref\|>(image|image_caption|text|sub_title|figure|table)<\|/ref\|><\|det\|>\[\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\]<\|/det\|>"
        for m in re.finditer(pattern, markdown):
            elem_type = m.group(1)
            x1, y1, x2, y2 = map(int, m.groups()[1:])
            full_tag = m.group(0)
            if elem_type == "image":
                images.append((elem_type, full_tag, (x1, y1, x2, y2), full_tag))
            else:
                others.append(full_tag)
        return images, others

    def pdf_page_to_image(self, pdf_path: str, dpi: int = 144) -> Image.Image:
        with fitz.open(pdf_path) as doc:
            page = doc[0]
            zoom = dpi / 72.0
            matrix = fitz.Matrix(zoom, zoom)
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            return Image.open(io.BytesIO(pixmap.tobytes("png")))

    def process_pdf(self, pdf_path: str, output_dir: str, temp_dir: str = "output/temp_pages") -> str:
        os.makedirs(output_dir, exist_ok=True)
        pages = self.split_pdf_to_pages(pdf_path, temp_dir)
        all_markdown = []
        for i, page_path in enumerate(pages):
            md, err = self.call_ocr(page_path)
            if not md:
                continue
            imgs, others = self.extract_image_with_bbox(md)
            if not imgs and not others:
                all_markdown.append(md)
                continue
            page_img = self.pdf_page_to_image(page_path)
            w, h = page_img.size
            for idx, (_, elem_tag, bbox, _) in enumerate(imgs):
                x1, y1, x2, y2 = [int(v / 999 * (w if j % 2 == 0 else h)) for j, v in enumerate(bbox)]
                img_name = f"page_{i + 1}_image_{idx + 1}.png"
                img_path = os.path.join(output_dir, img_name)
                os.makedirs(os.path.dirname(img_path), exist_ok=True)
                cropped = page_img.crop((x1, y1, x2, y2))
                cropped.save(img_path)
                md = md.replace(elem_tag, f"\n\n![image]({img_name})\n\n")
            for tag in others:
                md = md.replace(tag, "")
            all_markdown.append(md)

        out_path = os.path.join(output_dir, "final_output.md")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("".join(all_markdown))
        return out_path
