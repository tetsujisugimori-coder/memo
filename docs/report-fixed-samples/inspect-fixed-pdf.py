"""Real PDF text/link/geometry checks and all-page PNGs. Visual review is separate."""
import hashlib, json, pathlib, sys
import pymupdf
root=pathlib.Path(sys.argv[1])
results=json.loads((root/'results.json').read_text(encoding='utf-8'))
compact=lambda text: ''.join(text.split())
failed=False
for case in results['cases']:
    docs=[]
    first=root/(case['id']+'-first.pdf')
    if not first.exists():
        continue
    try:
        docs=[pymupdf.open(first),pymupdf.open(root/(case['id']+'-repeat.pdf'))]
        # PDF extraction places the footer before or after content depending on
        # the page. Exclude it by geometry before matching flowing paragraphs.
        def body_text(page):
            return '\n'.join(''.join(span['text'] for span in line['spans'])
                for block in page.get_text('dict')['blocks'] if block['type']==0
                for line in block['lines'] if line['bbox'][1]<790)
        text=['\n'.join(body_text(p) for p in doc) for doc in docs]
        assert text[0]==text[1], 'First/repeat PDF text differs'
        assert len(docs[0])==len(docs[1]), 'First/repeat page count differs'
        doc=docs[0]; case['pages']=len(doc)
        case['pdfChecks']=[]
        links=[link.get('uri','') for p in doc for link in p.get_links()]
        for expected in case['fixture']['expectedTexts']:
            assert compact(expected) in compact(text[0]), 'Missing prose '+expected[:50]
        for rows in case.get('tableCells',[]):
            for row in rows[1:]:
                for cell in row:
                    if cell:
                        # Unique cell IDs prevent a missing/duplicated row from passing.
                        import re
                        assert len(re.findall(re.escape(compact(cell))+r'(?![0-9])',compact(text[0])))==1, 'Missing/duplicate cell '+cell
        for url in case['fixture']['sourceUrls']:
            assert url in links, 'Missing Source link '+url
        if case['fixture']['boundaryUrl']:
            assert case['fixture']['boundaryUrl'] in links, 'Missing boundary URL annotation'
        # Visible Preview text is an additional oracle; fixture numbers are handwritten.
        from collections import Counter
        for caption,count in Counter(case['captions']).items():
            assert compact(text[0]).count(compact(caption))==count, 'Missing/duplicate caption '+caption
        if case['id']=='R05':
            assert 'R05編集操作で追加した確認文' in compact(text[0]), 'UI edit missing from PDF'
        for index,page in enumerate(doc):
            raster=page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False)
            raster.save(root/f"{case['id']}-page-{index+1:02}.png")
            repeated=docs[1][index].get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False)
            assert hashlib.sha256(raster.samples).digest()==hashlib.sha256(repeated.samples).digest(), f'First/repeat rendered page differs: {index+1}'
        for index,page in enumerate(doc):
            assert abs(page.rect.width-595.28)<1 and abs(page.rect.height-841.89)<1, 'Not A4 portrait'
            assert page.get_text().strip() not in ['',str(index+1)], 'Unnecessary blank page'
            for image in page.get_image_info():
                box=pymupdf.Rect(image['bbox'])
                assert box.x0>=-1 and box.y0>=-1 and box.x1<=page.rect.width+1 and box.y1<=page.rect.height+1, f'Image outside page {index+1}'
                assert abs(box.width/box.height-image['width']/image['height'])<0.01, f'Image aspect ratio changed: {index+1}'
            for block in page.get_text('dict')['blocks']:
                if block['type']!=0: continue
                for line in block['lines']:
                    box=pymupdf.Rect(line['bbox'])
                    assert box.x0>=-1 and box.y0>=-1 and box.x1<=page.rect.width+1 and box.y1<=page.rect.height+1, f'Text outside page {index+1}: {line}'
            footer=[w[4] for w in page.get_text('words') if w[1]>790]
            assert ''.join(footer)==str(index+1), f'Page number not continuous: {index+1}'
        case['pdf']='PASS';case['pdfChecks']=['A4縦','全ページ画像生成','本文・画像位置が用紙内','画像縦横比','連続ページ番号','空白ページなし','Sourceリンク注釈','初回/再出力テキスト・ページ数・全ページ画素一致','全caption保持']
    except Exception as error:
        failed=True;case['pdf']='FAIL';case['pdfFailure']=str(error)
    finally:
        for doc in locals().get('docs',[]): doc.close()
(root/'pdf-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{k:v for k,v in c.items() if k in ['id','pdf','pages','pdfFailure']} for c in results['cases']],ensure_ascii=False,indent=2))
sys.exit(1 if failed else 0)
