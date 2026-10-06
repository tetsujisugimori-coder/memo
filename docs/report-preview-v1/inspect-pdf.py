"""Inspect Chromium's real PDF, including text geometry and image aspect ratios."""
import json
import pathlib
import sys
import pymupdf

root = pathlib.Path(sys.argv[1])
doc = pymupdf.open(root / "mixed-report.pdf")
metrics = json.loads((root / "metrics.json").read_text(encoding="utf-8"))
texts = [page.get_text() for page in doc]
all_text = "\n".join(texts)
compact = "".join(all_text.split())
assert len(doc) >= 4, len(doc)
for token in ["混在レポート:検証/資料", "日本語本文", "本文開始", "図版の内容", "図版詳細の補足", "図版終了F1", "変更前", "変更後", "比較終了C1", "表開始T1", "表終了T1", "横長グラフG1", "DiagramD1", "TimelineL1", "大図終了BIG1", "本文終了END", "出典資料一", "出典資料二", "未登録", "語句", "未作成メモ"]:
    assert token in compact, f"Missing selectable/searchable text: {token}"
for i in range(55):
    assert str(1000 + i) in compact, f"Missing table value {i}"
for i in range(8):
    assert f"項目{i+1}" in compact, f"Missing Chart label {i}"
    assert str(210+i) in compact and str(310+i) in compact, f"Missing Chart values {i}"
assert "系列甲" in compact and "系列乙" in compact, "Missing Chart legends"
assert "☐" in compact and "☑" in compact, "Checklist states missing"
assert metrics["longUrl"] in compact, "Long URL must be readable in full"
for ui in ["編集に戻る", "PDFとして保存", "画像ブロック操作メニュー", "画像をクリップボードへコピー"]:
    assert ui not in compact, f"App UI leaked: {ui}"
# Captions/numbering come from the same Report DOM, including repeated Timeline Figure.
for entry in metrics["reportNumbers"]:
    caption = "".join(entry["caption"].split())
    assert any(caption in "".join(text.split()) for text in texts), f"Missing or split report number/caption: {caption}"
for label, content in [("図1", "図版開始F1"), ("図2", "比較終了C1"), ("表1", "表開始T1"), ("図3", "横長グラフG1"), ("図4", "DiagramD1"), ("図5", "大図終了BIG1")]:
    assert compact.count(label + content) == (2 if label == "図1" else 1), f"Duplicate/missing report caption {label}"
assert "図2(a)変更前" in compact and "図2(b)変更後" in compact
links = [link.get("uri", "") for page in doc for link in page.get_links()]
assert metrics["longUrl"] in links, "Source URL annotation missing"
assert "https://example.org/source-two" in links
pages = []
image_boxes = []
for index, page in enumerate(doc):
    assert abs(page.rect.width - 595.28) < 1 and abs(page.rect.height - 841.89) < 1, "A4 portrait"
    spans = [span for block in page.get_text("dict")["blocks"] if "lines" in block for line in block["lines"] for span in line["spans"]]
    footer = [span for span in spans if span["bbox"][1] > 790]
    assert "".join(span["text"] for span in footer).strip() == str(index+1), f"Page-number-only footer {index+1}: {footer}"
    for span in spans:
        x0,y0,x1,y1 = span["bbox"]
        assert x0 >= 55 and x1 <= page.rect.width - 55, f"Text outside horizontal 20mm margins: {span}"
        if span not in footer:
            assert y0 >= 54 and y1 <= page.rect.height - 53, f"Text outside vertical page area: {span}"
    for img in page.get_images(full=True):
        for rect in page.get_image_rects(img[0]):
            ratio = img[2] / img[3]
            assert abs(rect.width / rect.height - ratio) < .02, "Image aspect ratio changed"
            assert rect.y0 >= 55 and rect.y1 <= page.rect.height - 55, "Image clipped/split"
            image_boxes.append({"page":index+1,"width":img[2],"height":img[3],"rect":list(rect)})
    pages.append({"page":index+1,"text":texts[index],"links":[{"uri":link.get("uri"),"rect":list(link["from"])} for link in page.get_links()]})
for token, image_height in [("図1図版開始F1", None), ("図2比較終了C1", None), ("図5大図終了BIG1", metrics["metrics"]["bigNatural"])]:
    matching = [index+1 for index,text in enumerate(texts) if token in "".join(text.split())]
    assert matching, f"Caption missing: {token}"
    for number in matching:
        assert any(box["page"] == number and (image_height is None or box["height"] == image_height) for box in image_boxes), f"Image/caption separated: {token}"
for text in texts:
    normalized = "".join(text.split())
    if "図3横長グラフG1" in normalized:
        assert all(f"項目{i+1}" in normalized for i in range(8)), "Chart/caption separated"
    if "図4DiagramD1" in normalized:
        assert "Diagram補足" in normalized, "Diagram/caption separated"
    if "TimelineL1" in normalized:
        assert normalized.count("[1]") >= 2, "Timeline Source separated from referenced Figure"
    if "表1表開始T1" in normalized:
        assert "行1" in normalized and "1000" in normalized, "Table caption orphaned before first row"
assert any(i["height"] == metrics["metrics"]["bigNatural"] and i["rect"][3]-i["rect"][1] <= 729 for i in image_boxes), "Oversized image was not fitted"
assert any("図版直前見出しH1" in "".join(text.split()) and "図版開始F1" in "".join(text.split()) for text in texts), "Heading separated from Figure"
assert any("大図直前見出しHBIG1" in "".join(text.split()) and "大図終了BIG1" in "".join(text.split()) for text in texts), "Heading separated from oversized Figure"
assert sum("日本語説明" in text for text in texts) >= 2, "Table header not repeated"
for row in range(55):
    assert any(f"行{row+1}" in "".join(text.split()) and str(1000+row) in text for text in texts), f"Row split {row}"
(root / "inspection.json").write_text(json.dumps({"pages":pages,"images":image_boxes},ensure_ascii=False,indent=2),encoding="utf-8")
for index,page in enumerate(doc):
    page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False).save(root / f"page-{index+1:02}.png")
print(f"Real PDF PASS: {len(doc)} A4 pages; Japanese text, page numbers, URL links, repeated Table headers, complete images")
