"""Validate required artifact structure; not a substitute for visual review."""
import json, pathlib, struct, sys, zipfile, zlib
root=pathlib.Path(sys.argv[1]); trace=sys.argv[2]
ids=['R01','R02','R03','R04','R05','R06','L01','L02','L03','L04','I01']
for case in ids:
    for width in [1280,390]:
        b=(root/f'{case}-preview-{width}.png').read_bytes()
        assert b[:8]==b'\x89PNG\r\n\x1a\n'
        pos=8; names=[]; data=b''
        while pos<len(b):
            size=struct.unpack('>I',b[pos:pos+4])[0]; kind=b[pos+4:pos+8]; payload=b[pos+8:pos+8+size]; crc=b[pos+8+size:pos+12+size]
            assert len(crc)==4 and zlib.crc32(kind+payload)&0xffffffff==struct.unpack('>I',crc)[0]
            names.append(kind)
            if kind==b'IHDR':assert all(struct.unpack('>II',payload[:8]))
            if kind==b'IDAT':data+=payload
            pos+=12+size
        assert names[0]==b'IHDR' and names[-1]==b'IEND' and zlib.decompress(data)
if trace=='on':
    files=sorted(root.glob('context-*.zip'))
    assert len(files)==21, 'All 11 original and 10 import contexts required'
    for file in files:
        with zipfile.ZipFile(file) as z:
            assert z.testzip() is None
            events=[]
            for name in z.namelist():
                if name.endswith('.trace'):
                    events.extend(json.loads(line) for line in z.read(name).splitlines() if line)
            assert any(e.get('type')=='context-options' for e in events)
            assert any(e.get('type')=='before' for e in events), 'Trace contains no browser actions'
print('Artifact structure PASS')
