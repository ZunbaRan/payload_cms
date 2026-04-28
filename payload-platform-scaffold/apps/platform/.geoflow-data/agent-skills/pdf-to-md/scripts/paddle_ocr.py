#!/usr/bin/env python3
import base64
import os
import requests
from typing import List, Optional, Tuple

try:
    import fitz
except ImportError:
    print("需要安装: pip install pymupdf")
    raise


class PaddleEngine:
    name = "Paddle"

    def __init__(self, api_url: str, token: str):
        self.api_url = api_url
        self.token = token

    def split_pdf_to_pages(self, pdf_path: str, output_dir: str) -> List[str]:
        os.makedirs(output_dir, exist_ok=True)
        page_paths = []
        with fitz.open(pdf_path) as doc:
            for i in range(doc.page_count):
                single = fitz.open()
                single.insert_pdf(doc, from_page=i, to_page=i)
                path = os.path.join(output_dir, f"page_{i + 1}.pdf")
                single.save(path)
                single.close()
                page_paths.append(path)
        return page_paths

    def call_api(self, file_path: str, file_type: int = 0) -> Tuple[dict, Optional[Exception]]:
        with open(file_path, "rb") as f:
            file_data = base64.b64encode(f.read()).decode("ascii")

        headers = {
            "Authorization": f"token {self.token}",
            "Content-Type": "application/json",
        }
        payload = {
            "file": file_data,
            "fileType": file_type,
            "useDocOrientationClassify": False,
            "useDocUnwarping": False,
            "useChartRecognition": False,
        }

        try:
            resp = requests.post(self.api_url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json(), None
        except Exception as e:
            return {}, e

    def call_ocr(self, file_path: str) -> Tuple[str, Optional[Exception]]:
        """统一接口：返回 (markdown, error)"""
        res, err = self.call_api(file_path, file_type=0)
        if err:
            return "", err
        result = res.get("result", {})
        md_parts = []
        images_map = {}
        for doc_res in result.get("layoutParsingResults", []):
            md_parts.append(doc_res.get("markdown", {}).get("text", ""))
            images_map.update(doc_res.get("markdown", {}).get("images", {}))
        # 把图片 URL 序列化为 JSON 附在末尾，pipeline 可解析
        import json
        meta = json.dumps({"images": images_map}, ensure_ascii=False)
        return "\n".join(md_parts) + f"\n\n<!-- paddle_images: {meta} -->", None

    def process_pdf(self, pdf_path: str, output_dir: str, temp_dir: str = "output/temp_pages") -> str:
        os.makedirs(output_dir, exist_ok=True)
        pages = self.split_pdf_to_pages(pdf_path, temp_dir)
        all_markdown = []
        for i, page_path in enumerate(pages):
            res, err = self.call_api(page_path, file_type=0)
            if err:
                print(f"[Paddle] page {i + 1} failed: {err}")
                continue
            result = res.get("result", {})
            for doc_res in result.get("layoutParsingResults", []):
                md = doc_res.get("markdown", {}).get("text", "")
                all_markdown.append(md)
                images = doc_res.get("markdown", {}).get("images", {})
                for img_path, img_url in images.items():
                    try:
                        img_bytes = requests.get(img_url, timeout=30).content
                        full_path = os.path.join(output_dir, img_path)
                        os.makedirs(os.path.dirname(full_path), exist_ok=True)
                        with open(full_path, "wb") as f:
                            f.write(img_bytes)
                    except Exception as e:
                        print(f"[Paddle] 图片下载失败 {img_url}: {e}")

        out_path = os.path.join(output_dir, "paddle_output.md")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("\n\n".join(all_markdown))
        return out_path
