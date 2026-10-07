"""Content checks on actual screenshots/PDF rasters; no whole-PDF cross-OS baseline.

RGB absolute error is sampled at 30x30 normalized positions and within each of
the five colored ID patches. Thresholds account for resampling and subpixel
rounding, not arbitrary whole-page differences. Negative controls must fail.
"""
import math, pathlib, pymupdf
ASSETS=pathlib.Path(__file__).parent/'assets'

def white_raster(path):
    source=pymupdf.Pixmap(str(path))
    doc=pymupdf.open();page=doc.new_page(width=source.width,height=source.height)
    page.insert_image(page.rect,filename=str(path))
    pix=page.get_pixmap(alpha=False);doc.close();return pix

def pixel(pix,x,y):
    x=max(0,min(pix.width-1,int(x)));y=max(0,min(pix.height-1,int(y)))
    at=(y*pix.width+x)*pix.n
    return pix.samples_mv[at:at+3]

def distance(reference,actual,rect,positions):
    errors=[]
    for nx,ny in positions:
        a=pixel(reference,nx*reference.width,ny*reference.height)
        b=pixel(actual,rect.x0+nx*rect.width,rect.y0+ny*rect.height)
        errors.append(sum(abs(int(x)-int(y)) for x,y in zip(a,b))/3)
    return sum(errors)/len(errors)

GRID=[((x+.5)/30,(y+.5)/30) for y in range(30) for x in range(30)]

def check_region(actual,rect,key,manifest,reference=None):
    reference=reference or white_raster(ASSETS/(key+'.png'))
    error=distance(reference,actual,rect,GRID)
    assert error<=18, f'{key}: whole image region RGB error {error:.2f} >18'
    marks=[]
    asset=manifest['assets'][key]
    for mark in asset['marks']:
        # Compare the patch's interior color distribution, not a single source
        # glyph pixel. At 350px-high Preview, the 3200px ruler's ID patch is only
        # ~10 screen pixels wide and its tiny letters are antialiased.
        positions=[((mark['x']+mark['size']*(.1+.8*(x+.5)/8))/asset['width'],(mark['y']+mark['size']*(.1+.8*(y+.5)/8))/asset['height']) for x in range(8) for y in range(8)]
        expected=[pixel(reference,nx*reference.width,ny*reference.height) for nx,ny in positions]
        rendered=[pixel(actual,rect.x0+nx*rect.width,rect.y0+ny*rect.height) for nx,ny in positions]
        delta=sum(abs(sum(p[c] for p in expected)/len(expected)-sum(p[c] for p in rendered)/len(rendered)) for c in range(3))/3
        assert delta<=35, f'{key} {mark["name"]}: ID patch RGB error {delta:.2f} >35'
        marks.append({'name':mark['name'],'meanRgbError':delta})
    # All four outer edges: a crop/cover loses the fixed dark border.
    # Sample the center of the 8px border, rather than the outer antialiased
    # boundary (whose fractional PDF pixel rounding is not stable).
    border=[(x,y) for x in [4/asset['width'],1-4/asset['width']] for y in [.2,.4,.6,.8]]+[(x,y) for y in [4/asset['height'],1-4/asset['height']] for x in [.2,.4,.6,.8]]
    # A 390px Comparison can render the 8-source-pixel rule below one screen
    # pixel. Compare to a reference resampled to the measured region, allowing
    # one pixel of raster phase rounding; do not compare its gray antialiasing
    # to an unscaled solid-dark source pixel.
    border_doc=pymupdf.open();border_page=border_doc.new_page(width=rect.width,height=rect.height)
    border_page.insert_image(border_page.rect,filename=str(ASSETS/(key+'.png')),keep_proportion=False)
    scaled=border_page.get_pixmap(alpha=False);border_doc.close()
    errors=[]
    for nx,ny in border:
        color=pixel(scaled,nx*scaled.width,ny*scaled.height)
        errors.append(min(sum(abs(int(a)-int(b)) for a,b in zip(color,pixel(actual,rect.x0+nx*rect.width+dx,rect.y0+ny*rect.height+dy)))/3 for dx in [-1,0,1] for dy in [-1,0,1]))
    border_error=sum(errors)/len(errors)
    assert border_error<=35,f'{key}: outer border error {border_error:.2f} >35'
    return {'key':key,'meanRgbError':error,'marks':marks,'borderMeanRgbError':border_error}

def negative_controls(manifest):
    # Prove the thresholds reject wrong identity and a centered 10% crop.
    ref=white_raster(ASSETS/'landscape.png');wrong=white_raster(ASSETS/'photo.png')
    failures=[]
    for name,pix,rect in [('swapped',wrong,pymupdf.Rect(0,0,wrong.width,wrong.height)),('cropped',ref,pymupdf.Rect(ref.width*.05,ref.height*.05,ref.width*.95,ref.height*.95))]:
        try:check_region(pix,rect,'landscape',manifest)
        except AssertionError:failures.append(name)
    assert failures==['swapped','cropped'],'Image thresholds failed negative controls'
    return failures

def inspect_images(root,case,doc,manifest):
    observations=case['imageViews']['1280'] if doc is not None else []
    pdf_images=[(index,info) for index,page in enumerate(doc) for info in page.get_image_info()] if doc is not None else []
    assert len(pdf_images)==len(observations), 'PDF image occurrence count differs (missing, duplicated or split)'
    checks=[]
    for occurrence,((index,info),expected) in enumerate(zip(pdf_images,observations)):
        key=expected['key'];rect=pymupdf.Rect(info['bbox']);page=doc[index]
        assert page.rect.contains(rect), 'Image body outside paper'
        aspect=expected['width']/expected['height']
        assert abs(rect.width/rect.height-aspect)<.01,'PDF image aspect changed'
        pix=page.get_pixmap(matrix=pymupdf.Matrix(3,3),alpha=False)
        try:result=check_region(pix,rect*3,key,manifest)
        except AssertionError as error:raise AssertionError(f'PDF page {index+1}, occurrence {occurrence}: {error}') from error
        result.update(page=index+1,occurrence=occurrence,bbox=list(rect),number=expected.get('number'),caption=expected.get('caption'),comparison=expected.get('comparison'))
        # A single complete image rectangle on one page is required. Captions may
        # continue on the next page only for oversized blocks; record, don't hide it.
        caption=expected.get('caption') or ''
        compact=lambda s:''.join(s.split())
        caption_pages=[i+1 for i,p in enumerate(doc) if compact(caption) and compact(caption) in compact(p.get_text())]
        result['captionPages']=caption_pages
        if case['id']=='I01':assert index+1 in caption_pages,'Short I01 caption separated from its complete image'
        checks.append(result)
    preview_checks=[]
    for width,images in case['imageViews'].items():
        for i,image in enumerate(images):
            pix=white_raster(root/f'{case["id"]}-image-{width}-{i}.png')
            left,top,right,bottom=image.get('border',[1,1,1,1])
            try:check=check_region(pix,pymupdf.Rect(left,top,pix.width-right,pix.height-bottom),image['key'],manifest)
            except AssertionError as error:raise AssertionError(f'Preview {width}px, occurrence {i}: {error}') from error
            check.update(viewport=int(width),occurrence=i);preview_checks.append(check)
    conversions=[]
    for key,asset in manifest['assets'].items():
        file=root/f'{case["id"]}-assets'/(key+'.png')
        if not file.exists():continue
        pix=white_raster(file);scale=min(1,1800/max(asset['width'],asset['height']))
        assert pix.width==math.floor(asset['width']*scale+.5) and pix.height==math.floor(asset['height']*scale+.5),'Attachment conversion dimensions differ'
        conversions.append(check_region(pix,pymupdf.Rect(0,0,pix.width,pix.height),key,manifest))
    return {'pdf':checks,'preview':preview_checks,'conversion':conversions,'negativeControls':negative_controls(manifest)}
