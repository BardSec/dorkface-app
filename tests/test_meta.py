"""Metadata reader (src/meta_core.js), run through node on sample files built here with the stdlib."""
import base64
import io
import json
import struct
import subprocess
import zipfile
import zlib
from pathlib import Path

import pytest

from conftest import NODE

RUNNER = Path(__file__).parent / "js" / "run_meta.js"


def run(files, **extra):
    if NODE is None:
        pytest.skip("node not installed")
    req = {"files": [[name, base64.b64encode(data).decode()] for name, data in files], **extra}
    r = subprocess.run([NODE, str(RUNNER)], input=json.dumps(req), capture_output=True, text=True,
                       timeout=60, check=True)
    return json.loads(r.stdout)


def one(name, data):
    return run([(name, data)])["results"][0]


def fields(result):
    return {(f["label"], f["value"], f["kind"]) for f in result["fields"]}


def values(result, kind):
    return {f["value"] for f in result["fields"] if f["kind"] == kind}


# --- sample file builders -----------------------------------------------------------

def pdf(objects, trailer=b"", header=b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"):
    """objects: list of (number, body bytes). Bodies may include their own stream ... endstream."""
    out = header
    for num, body in objects:
        out += b"%d 0 obj\n" % num + body + b"\nendobj\n"
    if trailer:
        out += b"xref\n0 1\n0000000000 65535 f \ntrailer\n" + trailer
    return out + b"\nstartxref\n0\n%%EOF\n"


def stream(dict_body, data):
    return b"<< " + dict_body + b" /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"


def utf16_hex(s):
    return b"<FEFF" + s.encode("utf-16-be").hex().upper().encode() + b">"


XMP = """<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"
  xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"
  xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
  xmp:CreatorTool="Microsoft® Word for Microsoft 365" pdfx:MSIP_Label_abc_SiteId="11111111-2222-3333-4444-555555555555">
 <dc:creator><rdf:Seq><rdf:li>Jane Smith</rdf:li><rdf:li>Ren&#xE9; Ng</rdf:li></rdf:Seq></dc:creator>
 <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Contact jane.smith@example.org &amp; team</rdf:li></rdf:Alt></dc:description>
 <pdf:Producer>Adobe PDF Library 15.0</pdf:Producer>
 <pdfx:MSIP_Label_abc_Name>Internal</pdfx:MSIP_Label_abc_Name>
 <pdfx:MSIP_Label_abc_ActionId>should-be-hidden</pdfx:MSIP_Label_abc_ActionId>
 <xmpMM:History xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"><rdf:Seq>
  <rdf:li rdf:parseType="Resource"><stEvt:softwareAgent>Adobe InDesign 15.0 (Windows)</stEvt:softwareAgent></rdf:li>
 </rdf:Seq></xmpMM:History>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>""".encode("utf-8")


def classic_pdf():
    info = (b"<< /Title (C:\\\\Users\\\\jsmith\\\\Documents\\\\FY24 Budget \\(draft\\).docx)"
            b" /Author " + utf16_hex("José Álvarez") +
            b" /Creator (Microsoft\\256 Word for Microsoft 365)"
            b" /Producer (Acrobat Distiller 9.0 \\(Windows\\))"
            b" /CreationDate (D:20210304102201-05'00') /ModDate (D:2021)"
            b" /Company (Example Corp) /SourceModified (D:20210304)"
            b" /Template (\\\\\\\\fs01\\\\templates\\\\letter.dotx) /Trapped /False >>")
    return pdf([
        (1, b"<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>"),
        (2, b"<< /Type /Pages /Kids [] /Count 0 >>"),
        (3, info),
        (4, stream(b"/Type /Metadata /Subtype /XML", XMP)),
        (5, stream(b"/Filter /FlateDecode", zlib.compress(b"BT (3 0 obj << /Author (Fake) >>) Tj ET"))),
    ], b"<< /Size 6 /Root 1 0 R /Info 3 0 R >>")


def objstm_pdf():
    """PDF 1.5 style: Info inside a compressed object stream, XMP compressed with trailing junk,
    no classic trailer (the cross-reference stream dictionary points at Info and Root)."""
    body3 = b"<< /Author (Compressed Author) /Producer (LibreOffice 7.5) /Creator <FEFF0057006F00720064> >>"
    body6 = b"<< /Foo 1 >>"
    objs = body3 + b" " + body6
    header = b"3 0 6 %d " % (len(body3) + 1)
    content = header + objs
    return pdf([
        (1, b"<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>"),
        (2, b"<< /Type /Pages /Kids [] /Count 0 >>"),
        (4, stream(b"/Type /Metadata /Subtype /XML /Filter /FlateDecode", zlib.compress(XMP) + b"\x00junk")),
        (5, stream(b"/Type /ObjStm /N 2 /First %d /Filter /FlateDecode" % len(header), zlib.compress(content))),
        (7, stream(b"/Type /XRef /Root 1 0 R /Info 3 0 R /Size 8 /W [1 2 1]", b"")),
    ], header=b"%PDF-1.7\n")


def zip_bytes(files, method=zipfile.ZIP_DEFLATED):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(zipfile.ZipInfo(name), data, compress_type=zipfile.ZIP_STORED if name == "mimetype" else method)
    return buf.getvalue()


CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Q3 plan</dc:title><dc:creator>jsmith</dc:creator><cp:lastModifiedBy>Smith, Jane &amp; Co</cp:lastModifiedBy>
<cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2023-01-02T03:04:05Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2023-02-03T04:05:06Z</dcterms:modified>
<cp:lastPrinted>2023-02-01T00:00:00Z</cp:lastPrinted></cp:coreProperties>"""

APP = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Template>Normal.dotm</Template><TotalTime>42</TotalTime><Application>{app}</Application>
<Company>Example Corp</Company><Manager>Pat Boss</Manager><AppVersion>16.0000</AppVersion></Properties>"""

CUSTOM = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="MSIP_Label_abc_SiteId"><vt:lpwstr>aaaa-bbbb</vt:lpwstr></property>
<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Project"><vt:lpwstr>Phoenix</vt:lpwstr></property>
</Properties>"""


def docx(method=zipfile.ZIP_DEFLATED):
    return zip_bytes({
        "[Content_Types].xml": "<Types/>",
        "word/document.xml": '<w:document xmlns:w="w"><w:body><w:p>'
                             '<w:ins w:id="1" w:author="Bob Reviewer" w:date="2023-01-01T00:00:00Z"><w:r/></w:ins>'
                             '<w:del w:id="2" w:author="Bob Reviewer"><w:r/></w:del></w:p></w:body></w:document>',
        "docProps/core.xml": CORE,
        "docProps/app.xml": APP.format(app="Microsoft Office Word"),
        "docProps/custom.xml": CUSTOM,
        "word/comments.xml": '<w:comments xmlns:w="w"><w:comment w:id="0" w:author="Carol Commenter" w:initials="CC"/>'
                             '<w:comment w:id="1" w:author="Carol Commenter"/></w:comments>',
        "word/people.xml": '<w15:people xmlns:w15="w15"><w15:person w15:author="Carol Commenter">'
                           '<w15:presenceInfo w15:providerId="AD" w15:userId="S::carol@example.org::0000"/>'
                           '</w15:person></w15:people>',
        "word/_rels/settings.xml.rels": '<Relationships xmlns="r"><Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" '
            'Target="file:///\\\\fs01\\Templates\\Letterhead.dotx" TargetMode="External"/></Relationships>',
        "word/_rels/document.xml.rels": '<Relationships xmlns="r"><Relationship Id="rId9" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            'Target="https://www.example.org/" TargetMode="External"/></Relationships>',
    }, method)


def xlsx():
    return zip_bytes({
        "xl/workbook.xml": '<workbook xmlns:mc="mc"><mc:AlternateContent><mc:Choice Requires="x15">'
                           '<x15ac:absPath url="C:\\Users\\jdoe\\Desktop\\" xmlns:x15ac="x15ac"/></mc:Choice>'
                           '</mc:AlternateContent><sheets><sheet name="A" sheetId="1"/>'
                           '<sheet name="Secret" sheetId="2" state="hidden"/></sheets></workbook>',
        "xl/comments1.xml": "<comments><authors><author>Dana Doe</author></authors></comments>",
        "xl/persons/person.xml": '<personList><person displayName="Dana Doe" userId="dana@example.org" providerId="AD"/></personList>',
        "xl/externalLinks/_rels/externalLink1.xml.rels": '<Relationships><Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" '
            'Target="file:///\\\\finance-srv\\share\\Budget.xlsx" TargetMode="External"/></Relationships>',
        "docProps/app.xml": APP.format(app="Microsoft Excel"),
    })


def pptx():
    return zip_bytes({
        "ppt/presentation.xml": "<p:presentation/>",
        "ppt/commentAuthors.xml": '<p:cmAuthorLst xmlns:p="p"><p:cmAuthor id="1" name="Eve Presenter" initials="EP"/></p:cmAuthorLst>',
        "docProps/app.xml": APP.format(app="Microsoft Office PowerPoint"),
    })


def odt():
    meta = """<office:document-meta xmlns:office="o" xmlns:meta="m" xmlns:dc="d" xmlns:xlink="x"><office:meta>
<meta:initial-creator>Olga Original</meta:initial-creator><dc:creator>Max Modifier</dc:creator>
<meta:printed-by>Pia Printer</meta:printed-by><meta:generator>LibreOffice/7.5.2.2$Linux_X86_64</meta:generator>
<meta:creation-date>2022-05-06T07:08:09</meta:creation-date><meta:editing-cycles>3</meta:editing-cycles>
<meta:template xlink:href="/home/olga/Templates/memo.ott" xlink:title="memo"/>
<meta:user-defined meta:name="Client">ACME</meta:user-defined></office:meta></office:document-meta>"""
    return zip_bytes({"mimetype": "application/vnd.oasis.opendocument.text", "meta.xml": meta, "content.xml": "<x/>"})


def tiff(le=False):
    """EXIF block: IFD0 (Make, Model, Software, Artist, ExifIFD, GPS), Exif IFD, GPS IFD."""
    e = "<" if le else ">"
    entries = {}  # ifd name -> list of (tag, type, count, payload bytes)
    asc = lambda s: s.encode() + b"\0"
    rational = lambda *pairs: b"".join(struct.pack(e + "II", a, b) for a, b in pairs)
    entries["ifd0"] = [(0x010F, 2, asc("Apple")), (0x0110, 2, asc("iPhone 12")), (0x0131, 2, asc("16.1")),
                       (0x013B, 2, asc("Frank Photo")), (0x8769, 4, None), (0x8825, 4, None)]
    entries["exif"] = [(0x9003, 2, asc("2023:05:01 12:00:00")), (0xA431, 2, asc("SN123"))]
    entries["gps"] = [(1, 2, b"N\0"), (2, 5, rational((35, 1), (45, 1), (1800, 100))),
                      (3, 2, b"W\0"), (4, 5, rational((83, 1), (58, 1), (30, 1)))]
    # Layout: header(8) | ifd0 | exif | gps | data
    sizes = {k: 2 + 12 * len(v) + 4 for k, v in entries.items()}
    offs = {"ifd0": 8}
    offs["exif"] = offs["ifd0"] + sizes["ifd0"]
    offs["gps"] = offs["exif"] + sizes["exif"]
    data_off = offs["gps"] + sizes["gps"]
    data = b""
    blocks = {}
    for name in ("ifd0", "exif", "gps"):
        b = struct.pack(e + "H", len(entries[name]))
        for tag, typ, payload in entries[name]:
            if payload is None:
                count, value = 1, struct.pack(e + "I", offs["exif" if tag == 0x8769 else "gps"])
            else:
                size = {2: 1, 5: 8}[typ]
                count = len(payload) // size
                if len(payload) <= 4:
                    value = payload.ljust(4, b"\0")
                else:
                    value = struct.pack(e + "I", data_off + len(data))
                    data += payload
            b += struct.pack(e + "HHI", tag, typ, count) + value
        blocks[name] = b + b"\0\0\0\0"
    head = (b"II" if le else b"MM") + struct.pack(e + "HI", 42, 8)
    return head + blocks["ifd0"] + blocks["exif"] + blocks["gps"] + data


def jpeg(le=False):
    def seg(marker, payload):
        return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload
    xmp = b'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="r">' \
          b'<rdf:Description xmlns:dc="d"><dc:creator><rdf:Seq><rdf:li>Grace Hopper</rdf:li></rdf:Seq></dc:creator>' \
          b'</rdf:Description></rdf:RDF></x:xmpmeta>'
    return (b"\xff\xd8" + seg(0xE0, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0") + seg(0xE1, b"Exif\0\0" + tiff(le)) +
            seg(0xE1, xmp) + seg(0xFE, b"Scanned at \\\\scan01\\inbox") + seg(0xDB, b"\0" * 65) +
            b"\xff\xda\0\x08\x01\x01\0\0?\0" + b"\x12\x34\xff\xd8\xff\xe1" + b"\xff\xd9")


def png():
    def chunk(t, data):
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) +
            chunk(b"tEXt", b"Author\0Hal Designer") + chunk(b"tEXt", b"Software\0GIMP 2.10") +
            chunk(b"iTXt", b"Description\0\0\0en\0\0" + "Café notes from /Users/hal/Desktop/x.png".encode()) +
            chunk(b"eXIf", tiff(le=True)) + chunk(b"IEND", b""))


# --- PDF -------------------------------------------------------------------------------

def test_pdf_info_dictionary():
    r = one("budget.pdf", classic_pdf())
    assert r["type"] == "pdf" and r["error"] is None
    f = fields(r)
    assert ("Title", "C:\\Users\\jsmith\\Documents\\FY24 Budget (draft).docx", "other") in f
    assert ("Author", "José Álvarez", "person") in f
    assert ("Created with", "Microsoft® Word for Microsoft 365", "software") in f
    assert ("PDF producer", "Acrobat Distiller 9.0 (Windows)", "software") in f
    assert ("Created", "2021-03-04 10:22:01 -05:00", "date") in f
    assert ("Modified", "2021", "date") in f
    assert ("Company", "Example Corp", "org") in f
    assert ("PDF version", "1.4", "other") in f
    assert ("Custom: Template", "\\\\fs01\\templates\\letter.dotx", "other") in f
    assert not any(x[0] == "Custom: Trapped" for x in f)


def test_pdf_derived_paths_users_servers():
    r = one("budget.pdf", classic_pdf())
    assert "jsmith" in values(r, "person")
    assert "fs01" in values(r, "server")
    assert "C:\\Users\\jsmith\\Documents\\FY24 Budget (draft).docx" in values(r, "path")
    assert "jane.smith@example.org" in values(r, "email")


def test_pdf_xmp():
    r = one("budget.pdf", classic_pdf())
    f = fields(r)
    assert {"Jane Smith", "René Ng"} <= values(r, "person")
    assert ("Created with (XMP)", "Microsoft® Word for Microsoft 365", "software") in f
    assert ("PDF producer (XMP)", "Adobe PDF Library 15.0", "software") in f
    assert ("Edited with (XMP history)", "Adobe InDesign 15.0 (Windows)", "software") in f
    assert ("Microsoft 365 tenant ID", "11111111-2222-3333-4444-555555555555", "org") in f
    assert ("Sensitivity label", "Internal", "other") in f
    assert not any("should-be-hidden" in x[1] for x in f)
    assert ("Description (XMP)", "Contact jane.smith@example.org & team", "other") in f


def test_pdf_ignores_objects_inside_content_streams():
    r = one("budget.pdf", classic_pdf())
    assert "Fake" not in values(r, "person")


def test_pdf_compressed_object_stream_and_xref_stream():
    r = one("modern.pdf", objstm_pdf())
    f = fields(r)
    assert r["error"] is None, r
    assert ("Author", "Compressed Author", "person") in f
    assert ("PDF producer", "LibreOffice 7.5", "software") in f
    assert ("Created with", "Word", "software") in f
    assert "Jane Smith" in values(r, "person")  # XMP decompressed despite trailing junk
    assert ("PDF version", "1.7", "other") in f


def test_pdf_incremental_update_last_definition_wins():
    data = pdf([(1, b"<< /Type /Catalog >>"), (3, b"<< /Author (Old Author) >>")], b"<< /Root 1 0 R /Info 3 0 R >>")
    data += b"3 0 obj\n<< /Author (New Author) >>\nendobj\ntrailer\n<< /Root 1 0 R /Info 3 0 R /Prev 0 >>\n%%EOF\n"
    r = one("updated.pdf", data)
    assert "New Author" in values(r, "person") and "Old Author" not in values(r, "person")


def test_pdf_encrypted():
    data = pdf([(1, b"<< /Type /Catalog >>"), (3, b"<< /Author <8A9FF3C2> >>"), (9, b"<< /Filter /Standard /V 2 >>")],
               b"<< /Root 1 0 R /Info 3 0 R /Encrypt 9 0 R >>")
    r = one("locked.pdf", data)
    assert any("encrypted" in n for n in r["notes"])
    assert not values(r, "person")


def test_pdf_dates():
    out = run([], dates=["D:20210304102201-05'00'", "D:20210304102201Z", "D:2021030410", "D:2021", "garbage"])["dates"]
    assert out == ["2021-03-04 10:22:01 -05:00", "2021-03-04 10:22:01 UTC", "2021-03-04 10:00:00", "2021", "garbage"]


def test_pdf_string_escapes():
    data = pdf([(1, b"<< /Type /Catalog >>"),
                (3, b"<< /Title (a\\(b\\)c \\\\d (nested (parens)) \\101\\102 line\\\nbreak) /Subject <48 69 2>"
                    b" /Keywords (\xef\xbb\xbfUTF-8 caf\xc3\xa9) >>")], b"<< /Root 1 0 R /Info 3 0 R >>")
    f = fields(one("esc.pdf", data))
    assert ("Title", "a(b)c \\d (nested (parens)) AB linebreak", "other") in f
    assert ("Subject", "Hi ", "other") in f or ("Subject", "Hi", "other") in f
    assert ("Keywords", "UTF-8 café", "other") in f


# --- Office / OpenDocument ---------------------------------------------------------------

@pytest.mark.parametrize("method", [zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED])
def test_docx(method):
    r = one("plan.docx", docx(method))
    assert r["type"] == "docx" and r["typeLabel"] == "Word" and r["error"] is None
    f = fields(r)
    assert ("Author", "jsmith", "person") in f
    assert ("Last modified by", "Smith, Jane & Co", "person") in f
    assert ("Application", "Microsoft Office Word 16.0000", "software") in f
    assert ("Company", "Example Corp", "org") in f
    assert ("Manager", "Pat Boss", "person") in f
    assert ("Template", "Normal.dotm", "other") in f
    assert ("Editing time (minutes)", "42", "other") in f
    assert ("Revision", "7", "other") in f
    assert ("Created", "2023-01-02T03:04:05Z", "date") in f
    assert ("Last printed", "2023-02-01T00:00:00Z", "date") in f
    assert ("Microsoft 365 tenant ID", "aaaa-bbbb", "org") in f
    assert ("Custom: Project", "Phoenix", "other") in f
    assert ("Comment author", "Carol Commenter", "person") in f
    assert ("Comments", "2", "other") in f
    assert ("Tracked change by", "Bob Reviewer", "person") in f
    assert ("Tracked changes", "2", "other") in f
    assert ("Attached template", "file:///\\\\fs01\\Templates\\Letterhead.dotx", "path") in f
    assert "fs01" in values(r, "server")
    assert "carol@example.org" in values(r, "email")
    assert not any("www.example.org" in v for v in values(r, "path"))  # hyperlinks aren't reported


def test_xlsx():
    r = one("budget.xlsx", xlsx())
    f = fields(r)
    assert r["type"] == "xlsx"
    assert ("Saved from folder", "C:\\Users\\jdoe\\Desktop\\", "path") in f
    assert "jdoe" in values(r, "person")
    assert ("Hidden sheets", "1", "other") in f
    assert ("Comment author", "Dana Doe", "person") in f
    assert ("Linked workbook", "file:///\\\\finance-srv\\share\\Budget.xlsx", "path") in f
    assert "finance-srv" in values(r, "server")
    assert "dana@example.org" in values(r, "email")
    assert ("Application", "Microsoft Excel 16.0000", "software") in f


def test_pptx():
    r = one("deck.pptx", pptx())
    assert r["type"] == "pptx"
    assert ("Comment author", "Eve Presenter", "person") in fields(r)


def test_odt():
    r = one("memo.odt", odt())
    f = fields(r)
    assert r["type"] == "odt"
    assert ("Author", "Olga Original", "person") in f
    assert ("Last modified by", "Max Modifier", "person") in f
    assert ("Last printed by", "Pia Printer", "person") in f
    assert ("Application", "LibreOffice/7.5.2.2$Linux_X86_64", "software") in f
    assert ("Template", "/home/olga/Templates/memo.ott", "path") in f
    assert "olga" in values(r, "person")
    assert ("Custom: Client", "ACME", "other") in f


def test_plain_zip_is_not_office():
    r = one("x.zip", zip_bytes({"readme.txt": "hi"}))
    assert r["type"] == "zip" and r["notes"] and not r["fields"]


# --- images ------------------------------------------------------------------------------

@pytest.mark.parametrize("le", [False, True])
def test_jpeg_exif_gps_xmp(le):
    r = one("photo.jpg", jpeg(le))
    f = fields(r)
    assert r["type"] == "jpeg" and r["error"] is None
    assert ("Camera", "Apple iPhone 12", "device") in f
    assert ("Software", "16.1", "software") in f
    assert ("Artist", "Frank Photo", "person") in f
    assert ("Taken", "2023:05:01 12:00:00", "date") in f
    assert ("Camera serial number", "SN123", "device") in f
    assert ("GPS position", "35.755000, -83.975000", "location") in f
    assert ("Author (XMP)", "Grace Hopper", "person") in f
    assert "scan01" in values(r, "server")


def test_png_text_and_exif():
    r = one("logo.png", png())
    f = fields(r)
    assert r["type"] == "png"
    assert ("Author", "Hal Designer", "person") in f
    assert ("Software", "GIMP 2.10", "software") in f
    assert ("Description", "Café notes from /Users/hal/Desktop/x.png", "other") in f
    assert "hal" in values(r, "person")
    assert ("GPS position", "35.755000, -83.975000", "location") in f


# --- bad input -----------------------------------------------------------------------------

@pytest.mark.parametrize("name,data", [
    ("empty.pdf", b""),
    ("random.bin", bytes(range(256)) * 10),
    ("truncated.docx", b"PK\x03\x04" + b"\0" * 100),
    ("legacy.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600),
    ("cut.pdf", classic_pdf()[:300]),
    ("deep.pdf", b"%PDF-1.4\n1 0 obj\n" + b"[" * 20000 + b"\nendobj\ntrailer << /Info 1 0 R >>"),
    ("bad-exif.jpg", b"\xff\xd8\xff\xe1\x00\x10Exif\0\0MM\0\x2a\xff\xff\xff\xff\xff\xd9"),
    ("bad-png.png", b"\x89PNG\r\n\x1a\n\xff\xff\xff\xfftEXt"),
    ("bad-zip.xlsx", zip_bytes({"xl/workbook.xml": "<x/>"})[:-30]),
])
def test_bad_files_never_crash(name, data):
    r = one(name, data)
    assert r["name"] == name
    assert r["error"] or r["notes"] or r["fields"] is not None


def test_specific_messages():
    out = run([("empty.pdf", b""), ("legacy.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600),
               ("x.txt", b"hello")])["results"]
    assert "empty" in out[0]["error"]
    assert "Older Office" in out[1]["notes"][0]
    assert "reads PDF" in out[2]["notes"][0]


def test_hostile_values_are_returned_as_plain_text():
    data = pdf([(1, b"<< /Type /Catalog >>"), (3, b"<< /Author (<img src=x onerror=alert\\(1\\)>) >>")],
               b"<< /Root 1 0 R /Info 3 0 R >>")
    r = one("x.pdf", data)
    assert "<img src=x onerror=alert(1)>" in values(r, "person")  # rendered with textContent by the page


def test_long_values_are_capped():
    data = pdf([(1, b"<< /Type /Catalog >>"), (3, b"<< /Title (" + b"A" * 5000 + b") >>")],
               b"<< /Root 1 0 R /Info 3 0 R >>")
    title = [f["value"] for f in one("x.pdf", data)["fields"] if f["label"] == "Title"][0]
    assert len(title) == 2001 and title.endswith("…")


# --- summary and CSV ----------------------------------------------------------------------

def test_summary_groups_across_files():
    out = run([("a.pdf", classic_pdf()), ("b.docx", docx()), ("c.xlsx", xlsx())])
    s = out["summary"]
    assert set(s) == set(out["kinds"])
    company = [x for x in s["org"] if x["value"] == "Example Corp"][0]
    assert sorted(company["files"]) == ["a.pdf", "b.docx", "c.xlsx"]
    assert s["org"][0]["value"] == "Example Corp"  # most files first
    servers = {x["value"] for x in s["server"]}
    assert {"fs01", "finance-srv"} <= servers
    fs01 = [x for x in s["server"] if x["value"] == "fs01"][0]
    assert sorted(fs01["files"]) == ["a.pdf", "b.docx"]


def test_csv_escapes_formulas_and_quotes():
    data = pdf([(1, b"<< /Type /Catalog >>"), (3, b"<< /Author (=HYPERLINK\\(\"http://x\"\\)) /Title (-2+3) /Subject (@SUM) >>")],
               b"<< /Root 1 0 R /Info 3 0 R >>")
    csv = run([("x.pdf", data), ("bad.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600)])["csv"]
    assert csv.startswith('\ufeff"file","type","field","value","kind"\r\n')
    assert '"\'=HYPERLINK(""http://x"")"' in csv
    assert '"\'-2+3"' in csv and '"\'@SUM"' in csv
    assert '"bad.doc","Older Office file","Note"' in csv
