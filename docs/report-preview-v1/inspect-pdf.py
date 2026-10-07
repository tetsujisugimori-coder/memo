"""Inspect Chromium's real PDF, including text geometry and image aspect ratios."""
import json
import pathlib
import re
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
        if any(token in span["text"] for token in ["大図終了", "Timeline項目", "本文と参照Figure", "長い図版説明", "図版詳細の補足"]):
            assert span["size"] >= 8.9, f"Media scaling shrank caption/Timeline prose: {span}"
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
for page_index, text in enumerate(texts):
    normalized = "".join(text.split())
    if "図3横長グラフG1" in normalized:
        assert all(f"項目{i+1}" in normalized for i in range(8)), "Chart/caption separated"
    if "図4DiagramD1" in normalized:
        assert "Diagram補足" in normalized, "Diagram/caption separated"
    if "TimelineL1" in normalized:
        # Only this item's region counts: preceding Diagram citations cannot satisfy it.
        # Zoomed media can change PDF painting order; sort by displayed position.
        positioned = "".join(doc[page_index].get_text(sort=True).split())
        item = positioned.split("TimelineL1", 1)[1].split("大図直前見出し", 1)[0]
        for token in ["2026年", "Timeline項目", "本文と参照Figure[2]", "図1図版開始F1",
                      "図版の内容", "図版詳細の補足", "共通Source:[1][1]"]:
            assert token in item, f"Ordinary Timeline item/Figure/caption/Source separated: {token}"
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

# Unique text, source URLs and image geometry identify each group rather than
# allowing an unrelated occurrence of the same citation number to satisfy it.
pagination = root / "pagination"
if (pagination / "cases.json").exists():
    cases = json.loads((pagination / "cases.json").read_text(encoding="utf-8"))
    assert len(cases) == 6
    results = []
    for case in cases:
        pdf = pymupdf.open(pagination / (case["name"] + ".pdf"))
        page_texts = ["".join(p.get_text(clip=pymupdf.Rect(0, 0, p.rect.width, 790), sort=True).split()) for p in pdf]
        combined = "".join(page_texts)
        alignment = case["alignment"]
        full_caption = "".join(case["caption"].split())
        assert combined.count(full_caption) == 2, "Both complete Figure descriptions retained"
        for paragraph in case["paragraphs"]:
            assert combined.count("".join(paragraph.split())) == 1, "Complete Timeline prose retained"
        ordinary_pages = [i for i, t in enumerate(page_texts) if "ORDINARY-CHAPTER" in t]
        assert len(ordinary_pages) == 1
        ordinary = page_texts[ordinary_pages[0]].split("ORDINARY-CHAPTER", 1)[1]
        for token in ["ORDINARY-DATE", "ORDINARY-TITLE", "ORDINARY-BODY[2]", "図2ORDINARY-FIGURE-CAPTION",
                      "https://example.org/ordinary-figure", "共通Source:[1][2]"]:
            assert token in ordinary, f"Ordinary item orphaned/split: {token}"
        long_start = next(i for i, t in enumerate(page_texts) if "LONG-TIMELINE-" + alignment in t)
        long_end = next(i for i, t in enumerate(page_texts) if "BODY-END-" + alignment in t)
        assert long_end > long_start, "Long Timeline must flow, without tiny text"
        for token in ["LONG-DATE-" + alignment, "LONG-ITEM-" + alignment, "BODY-BEGIN-" + alignment]:
            assert token in page_texts[long_start], "Long Timeline heading/date/title orphaned"
        image_pages = []
        caption_start_pages = []
        source_pages = []
        caption_end_pages = []
        for index, page in enumerate(pdf):
            text = page_texts[index]
            if "FIGURE-BEGIN-" + alignment in text:
                assert page.get_images(), "Figure image separated from caption beginning"
                caption_start_pages.append(index + 1)
            if "FIGURE-END-" + alignment in text:
                caption_end_pages.append(index + 1)
            if "MEDIA-" + alignment in text:
                region = text.split("MEDIA-" + alignment, 1)[1]
                assert "https://example.org/figure-" + alignment in region
                assert "共通Source:[1]" in region, "Identified Figure Source panel split/lost"
                source_pages.append(index + 1)
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        x0, y0, x1, y1 = span["bbox"]
                        assert x0 >= 55 and x1 <= page.rect.width - 55, "Pagination text outside 20mm margins"
                        if y0 < 790:
                            assert y0 >= 54 and y1 <= page.rect.height - 53
                        # Existing citation markers use .8em (9pt Source -> 7.2pt).
                        # Keep that contract while checking prose/captions at >=9pt.
                        minimum = 7.1 if re.fullmatch(r"(?:\[\d+\])+", span["text"].strip()) else 8.9
                        assert span["size"] >= minimum, f"Text shrunk: {span}"
            for img in page.get_images(full=True):
                for rect in page.get_image_rects(img[0]):
                    assert abs(rect.width / rect.height - img[2] / img[3]) < .02
                    assert rect.y0 >= 55 and rect.y1 <= page.rect.height - 55, "Pagination image split/clipped"
                    if img[2] == 600 and img[3] == 1800:
                        image_pages.append(index + 1)
            page.get_pixmap().save(pagination / f"{case['name']}-page-{index+1:02}.png")
        assert len(image_pages) == 2 and len(source_pages) == 2, "Both top-level and nested media/Sources present"
        assert len(caption_end_pages) == 2
        for end, source in zip(caption_end_pages, source_pages):
            assert end <= source <= end + 1, "Long description must be followed directly by its identified Source panel"
        assert image_pages == caption_start_pages, "Identified large images stay with their own caption beginning"
        nested_end = page_texts[source_pages[1] - 1].split("MEDIA-" + alignment, 1)[1]
        assert "共通Source:[1][2]" in nested_end, "Long item's own Source stays with referenced Figure Source"
        links = [link.get("uri", "") for page in pdf for link in page.get_links()]
        for url in ["https://example.org/figure-" + alignment, "https://example.org/ordinary-figure",
                    "https://example.org/source-figure", "https://example.org/source-item"]:
            assert url in links, f"External URL annotation missing: {url}"
        assert "REPORT-END" in combined
        results.append({"name":case["name"],"pages":len(pdf),"ordinaryPage":ordinary_pages[0]+1,
                        "longBodyPages":[long_start+1,long_end+1],"images":image_pages,"captionEnds":caption_end_pages,"figureSources":source_pages})
    (pagination / "inspection.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("Pagination PDFs PASS: six PDFs, identified ordinary/long items, full prose, media/Source, 9pt minimum, URL annotations")


# Caption-review cases exercise actual PDFs separately from the mixed report.
review = root / "caption-regressions"
if (review / "cases.json").exists():
    cases = json.loads((review / "cases.json").read_text(encoding="utf-8"))
    assert len(cases) == 10, "All Comparison/pie/single Figure cases must run"
    for case in cases:
        pdf = pymupdf.open(review / (case["name"] + ".pdf"))
        page_texts = ["".join(page.get_text().split()) for page in pdf]
        combined = "".join(page_texts)
        expected = "".join(case["caption"].split())
        assert any(expected in text for text in page_texts), f"Missing/split visible caption: {case['name']}"
        # Font fallback may split Japanese and ASCII into separate spans.
        # Count visible parent labels in joined text, excluding (a)/(b) labels.
        parents = re.findall(r"図\d+(?![\d(])", combined)
        assert parents == ["図1"], f"Extra/missing parent number: {case['name']} {parents}"
        if case["kind"] == "comparison":
            together = [(page,text) for page,text in zip(pdf,page_texts) if expected in text and all(f"図1({chr(97+side)})" in text for side in case["sides"])]
            assert together, f"Comparison captions separated: {case['name']}"
            page, text = together[0]
            image_rects = {tuple(rect) for image in page.get_images(full=True) for rect in page.get_image_rects(image[0])}
            assert len(image_rects) == 2, f"Comparison media separated from captions: {case['name']}"
            offsets = [combined.rindex(f"図1({chr(97+side)})") for side in case["sides"]] + [len(combined)]
            for order, index in enumerate(case["sides"]):
                section = combined[offsets[order]:offsets[order+1]]
                description = "".join(case["individual"][index].split())
                if description: assert description in section, f"Individual caption lost its side: {case['name']} side {index}"
                for field in [f"個別資料{index+1}",f"日付{index+1}",f"権利{index+1}",f"補足{index+1}",f"[{order+1}]"]:
                    assert field in section, f"Side information missing: {case['name']} {field}"
            if case["parent"]: assert combined.count("".join(case["parent"].split())) == 1, "Parent caption duplicated"
            links = [link.get("uri", "") for page in pdf for link in page.get_links()]
            for side in case["sides"]:
                for suffix in [f"individual-{side+1}", "common-left" if side == 0 else "common-right"]:
                    assert "https://example.org/" + suffix in links, "Image and shared Source links retained"
        elif case["kind"] == "pie":
            for item, value in zip(["A", "B"],case["values"]):
                assert f"項目{item}:{value}件" in combined, f"Selected pie values changed: {case['name']}"
        for index,page in enumerate(pdf):
            page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False).save(review / f"{case['name']}-page-{index+1}.png")
    print(f"Caption review real PDFs PASS: {len(cases)} cases; side captions/Sources, visible pie series, values and parent numbers")

# Spacing stress cases: long prose/Timeline/captions must remain readable and complete.
spacing = root / "spacing"
if (spacing / "cases.json").exists():
    spacing_results = []
    for case in json.loads((spacing / "cases.json").read_text(encoding="utf-8")):
        pdf = pymupdf.open(spacing / (case["name"] + ".pdf"))
        compact_text = "".join("".join(page.get_text().split()) for page in pdf)
        for token in case["tokens"]:
            assert "".join(token.split()) in compact_text, f"Spacing PDF text missing: {case['name']} {token}"
        if case["name"] == "groups":
            for i in range(24):
                if i != 1:
                    assert f"出来事{i+1}" in compact_text, f"Timeline item missing: {i+1}"
            assert compact_text.count("図1検証Figure") == 2, "Timeline keeps canonical figure number"
        if case["name"] in ("prose", "long-groups"):
            for i in range(36):
                assert f"段落{i+1}" in compact_text, f"Long prose paragraph missing: {i+1}"
        minimum = 100
        for index, page in enumerate(pdf):
            spans = [s for b in page.get_text("dict")["blocks"] if "lines" in b for line in b["lines"] for s in line["spans"]]
            for s in spans:
                x0, y0, x1, y1 = s["bbox"]
                assert x0 >= 55 and x1 <= page.rect.width-55, f"Spacing text clipped horizontally: {case['name']} {s}"
                if y0 < 790:
                    assert y0 >= 54 and y1 <= page.rect.height-53, f"Spacing text clipped vertically: {case['name']} {s}"
                if case["name"] == "long-groups" and ("長説明" in s["text"] or "全文を" in s["text"] or "段落" in s["text"]):
                    minimum = min(minimum, s["size"])
                    assert s["size"] >= 8.9, f"Long text was shrunk: {s}"
            page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False).save(spacing / f"{case['name']}-page-{index+1:02}.png")
        if case["name"] == "long-groups":
            assert len(pdf) >= 4, "Long text must flow across pages"
        spacing_results.append({"name":case["name"],"pages":len(pdf),"minimumLongTextPt":minimum if minimum<100 else None})
    (spacing / "inspection.json").write_text(json.dumps(spacing_results,indent=2),encoding="utf-8")
    print(f"Spacing real PDFs PASS: {len(spacing_results)} reports; complete long text and Timeline, original font size, page bounds")
