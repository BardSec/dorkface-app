"""Builders for sample legacy Office (OLE2 compound file) and HEIC/AVIF files, stdlib only.

Used by tests/test_meta.py. Formats: [MS-CFB] compound files, [MS-OLEPS] property sets,
[MS-DOC] FIB + string tables, [MS-XLS] WRITEACCESS, [MS-PPT] CurrentUserAtom, and ISO/IEC 23008-12
(HEIF) meta/iinf/iloc boxes.
"""
import math
import struct
import uuid
from datetime import datetime, timezone

FREE, END, FATSECT, NOSTREAM = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF


# --- compound file -------------------------------------------------------------------------

def cfb(streams):
    """streams: list of (name, bytes). Streams under 4096 bytes go in the mini stream."""
    ss, ms, cutoff = 512, 64, 4096
    small = [(n, d) for n, d in streams if len(d) < cutoff]
    large = [(n, d) for n, d in streams if len(d) >= cutoff]

    mini, minifat, starts = bytearray(), [], {}
    for name, data in small:
        count = math.ceil(len(data) / ms)
        if not count:
            starts[name] = END
            continue
        first = len(minifat)
        minifat += [first + i + 1 for i in range(count - 1)] + [END]
        mini += data.ljust(count * ms, b"\0")
        starts[name] = first

    entries = 1 + len(streams)
    runs = [("dir", math.ceil(entries * 128 / ss)), ("minifat", math.ceil(len(minifat) * 4 / ss)),
            ("mini", math.ceil(len(mini) / ss))] + [(n, math.ceil(len(d) / ss)) for n, d in large]
    rest = sum(c for _, c in runs)
    nfat = 1
    while nfat * (ss // 4) < nfat + rest:
        nfat += 1

    fat = [FREE] * (nfat * (ss // 4))
    for i in range(nfat):
        fat[i] = FATSECT
    where, sid = {}, nfat
    for name, count in runs:
        if not count:
            where[name] = END
            continue
        where[name] = sid
        for i in range(count):
            fat[sid + i] = sid + i + 1 if i < count - 1 else END
        sid += count

    def entry(name, typ, start, size, child=NOSTREAM, right=NOSTREAM):
        n = name.encode("utf-16-le")
        return (n.ljust(64, b"\0") + struct.pack("<HBB", len(n) + 2, typ, 1) +
                struct.pack("<III", NOSTREAM, right, child) + b"\0" * 16 + struct.pack("<I", 0) + b"\0" * 16 +
                struct.pack("<III", start, size, 0))

    dirb = entry("Root Entry", 5, where["mini"], len(mini), child=1 if streams else NOSTREAM)
    for i, (name, data) in enumerate(streams, start=1):
        start = starts[name] if len(data) < cutoff else where[name]
        dirb += entry(name, 2, start, len(data), right=i + 1 if i < len(streams) else NOSTREAM)

    body = {"dir": dirb, "minifat": b"".join(struct.pack("<I", x) for x in minifat), "mini": bytes(mini)}
    body.update({n: d for n, d in large})
    difat = list(range(nfat)) + [FREE] * (109 - nfat)
    header = struct.pack("<8s16sHHHHH6sIIIIIIIII", bytes.fromhex("D0CF11E0A1B11AE1"), b"\0" * 16, 0x3E, 3, 0xFFFE,
                         9, 6, b"\0" * 6, 0, nfat, where["dir"], 0, cutoff,
                         where["minifat"], math.ceil(len(minifat) * 4 / ss), END, 0)
    header += b"".join(struct.pack("<I", x) for x in difat)
    out = header.ljust(ss, b"\0")
    out += b"".join(struct.pack("<I", x) for x in fat)
    for name, count in runs:
        if count:
            out += body[name].ljust(count * ss, b"\0")
    return out


# --- property sets ---------------------------------------------------------------------------

SUMMARY = uuid.UUID("F29F85E0-4FF9-1068-AB91-08002B27B3D9").bytes_le
DOCSUMMARY = uuid.UUID("D5CDD502-2E9C-101B-9397-08002B2CF9AE").bytes_le
CUSTOM = uuid.UUID("D5CDD505-2E9C-101B-9397-08002B2CF9AE").bytes_le


def filetime(dt=None, minutes=None):
    if minutes is not None:
        ticks = minutes * 60 * 10_000_000
    else:
        ticks = int((dt - datetime(1601, 1, 1, tzinfo=timezone.utc)).total_seconds() * 10_000_000)
    return ("ft", ticks)


def _value(v, cp):
    if isinstance(v, tuple) and v[0] == "ft":
        return struct.pack("<III", 64, v[1] & 0xFFFFFFFF, v[1] >> 32)
    if isinstance(v, tuple) and v[0] == "i4":
        return struct.pack("<Ii", 3, v[1])
    if isinstance(v, tuple) and v[0] == "w":   # VT_LPWSTR
        s = (v[1] + "\0").encode("utf-16-le")
        b = struct.pack("<II", 31, len(s) // 2) + s
    else:                                        # VT_LPSTR in the section's code page
        s = (v + "\0").encode("cp1252" if cp == 1252 else "utf-8")
        b = struct.pack("<II", 30, len(s)) + s
    return b + b"\0" * (-len(b) % 4)


def _section(props, cp=1252, names=None):
    items = [(1, struct.pack("<IhH", 2, cp if cp < 32768 else cp - 65536, 0))]
    if names:
        d = struct.pack("<I", len(names))
        for pid, name in names.items():
            n = (name + "\0").encode("cp1252")
            d += struct.pack("<II", pid, len(n)) + n
        items.append((0, d + b"\0" * (-len(d) % 4)))
    items += [(pid, _value(v, cp)) for pid, v in props.items()]
    head = 8 + 8 * len(items)
    offsets, blob = [], b""
    for pid, b in items:
        offsets.append((pid, head + len(blob)))
        blob += b
    return struct.pack("<II", head + len(blob), len(items)) + b"".join(struct.pack("<II", p, o) for p, o in offsets) + blob


def propset(sections):
    """sections: list of (fmtid bytes, section bytes)."""
    head = struct.pack("<HHI16sI", 0xFFFE, 0, 0x00020006, b"\0" * 16, len(sections))
    first = len(head) + 20 * len(sections)
    table, blob = b"", b""
    for fmtid, sec in sections:
        table += fmtid + struct.pack("<I", first + len(blob))
        blob += sec
    return head + table + blob


def summary_streams(app="Microsoft Office Word", version=0x000E0000):
    created = datetime(2012, 3, 4, 5, 6, 7, tzinfo=timezone.utc)
    si = propset([(SUMMARY, _section({
        2: "Board minutes", 4: "jsmith", 5: "budget; draft", 7: "Normal.dotm", 8: "Jane Smith",
        9: "12", 10: filetime(minutes=95), 12: filetime(created), 13: filetime(datetime(2013, 1, 2, tzinfo=timezone.utc)),
        18: app,
    }))])
    dsi = propset([
        (DOCSUMMARY, _section({2: "Finance", 14: "Pat Boss", 15: "Example Corp", 23: ("i4", version)})),
        (CUSTOM, _section({2: "Phoenix", 3: "\\\\fs02\\projects\\phoenix"},
                          names={2: "Project", 3: "Share"})),
    ])
    return [("\x05SummaryInformation", si), ("\x05DocumentSummaryInformation", dsi)]


# --- Word / Excel / PowerPoint specifics -------------------------------------------------------

def _sttb(strings):
    out = struct.pack("<HHH", 0xFFFF, len(strings), 0)
    for s in strings:
        out += struct.pack("<H", len(s)) + s.encode("utf-16-le")
    return out


def doc(encrypted=False):
    table = bytearray(b"\0" * 16)
    pairs = {}

    def put(index, blob):
        pairs[index] = (len(table), len(blob))
        table.extend(blob)

    put(71, _sttb(["jsmith", "C:\\Users\\jsmith\\Documents\\Plan.doc", "Jane Smith", "\\\\fs01\\shared\\Plan.doc"]))
    put(32, _sttb(["", "C:\\Users\\jsmith\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm", "Plan"]))
    put(51, _sttb(["Unknown", "Bob Reviewer"]))
    put(36, struct.pack("<H", 15) + "Carol Commenter".encode("utf-16-le"))

    fib = bytearray(1500)
    struct.pack_into("<HH", fib, 0, 0xA5EC, 0x00C1)
    struct.pack_into("<H", fib, 0x0A, 0x0200 | (0x0100 if encrypted else 0))   # fWhichTblStm = 1Table
    struct.pack_into("<H", fib, 32, 14)          # csw
    struct.pack_into("<H", fib, 62, 22)          # cslw
    struct.pack_into("<H", fib, 152, 93)         # cbRgFcLcb
    for index, (fc, lcb) in pairs.items():
        struct.pack_into("<II", fib, 154 + 8 * index, fc, lcb)
    return cfb(summary_streams() + [("WordDocument", bytes(fib)), ("1Table", bytes(table))])


def xls(unicode_name=False):
    def rec(t, body):
        return struct.pack("<HH", t, len(body)) + body
    if unicode_name:
        name = "Zoë Ünicode"
        wa = struct.pack("<HB", len(name), 1) + name.encode("utf-16-le")
    else:
        name = "Dana Doe"
        wa = struct.pack("<HB", len(name), 0) + name.encode("latin-1")
    wa = wa.ljust(112, b" ")
    book = rec(0x0809, b"\0" * 16) + rec(0x00E1, b"\0\0") + rec(0x005C, wa) + rec(0x0085, b"\0" * 8)
    book = book + rec(0x00FC, b"\0" * 5000)      # pad past the mini-stream cutoff: regular sectors
    return cfb(summary_streams("Microsoft Excel", 0x000C0000) + [("Workbook", book)])


def ppt():
    name = "Eve Presenter"
    atom = struct.pack("<IIIHHBBH", 0x14, 0xE391C05F, 0, len(name), 0x03F4, 3, 0, 0) + name.encode("latin-1")
    atom += struct.pack("<I", 8) + name.encode("utf-16-le")
    current_user = struct.pack("<HHI", 0, 0x0FF6, len(atom)) + atom
    return cfb(summary_streams("Microsoft Office PowerPoint", 0x000F0000) +
               [("Current User", current_user), ("PowerPoint Document", b"\0" * 300)])


def msg():
    return cfb(summary_streams("Microsoft Outlook") + [("__substg1.0_0037001F", "Subject".encode("utf-16-le"))])


# --- HEIC / AVIF --------------------------------------------------------------------------------

def _box(t, body):
    return struct.pack(">I", 8 + len(body)) + t + body


def _full(t, version, body, flags=0):
    return _box(t, struct.pack(">I", (version << 24) | flags) + body)


def _infe(item_id, item_type, content_type=None):
    body = struct.pack(">HH", item_id, 0) + item_type + b"\0"
    if content_type:
        body += content_type.encode() + b"\0"
    return _full(b"infe", 2, body)


def heif(exif_tiff, brand=b"heic", in_idat=False):
    exif = struct.pack(">I", 6) + b"Exif\0\0" + exif_tiff
    xmp = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="r"><rdf:Description xmlns:dc="d">'
           b"<dc:creator><rdf:Seq><rdf:li>Ivy Phone</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>")
    ftyp = _box(b"ftyp", brand + struct.pack(">I", 0) + b"mif1" + brand)
    hdlr = _full(b"hdlr", 0, struct.pack(">I", 0) + b"pict" + b"\0" * 12 + b"\0")
    iinf = _full(b"iinf", 0, struct.pack(">H", 3) + _infe(1, b"hvc1") + _infe(2, b"Exif") +
                 _infe(3, b"mime", "application/rdf+xml"))

    def iloc(offsets):
        version = 1 if in_idat else 0
        body = bytes([0x44, 0x00]) + struct.pack(">H", 3)
        for item_id, (method, off, length) in offsets.items():
            body += struct.pack(">H", item_id)
            if version == 1:
                body += struct.pack(">H", method)
            body += struct.pack(">HH", 0, 1) + struct.pack(">II", off, length)
        return _full(b"iloc", version, body)

    image = b"\0" * 32
    if in_idat:
        idat = _box(b"idat", exif)
        meta_kids = lambda offs: hdlr + iinf + iloc(offs) + idat
        dummy = {1: (0, 0, 0), 2: (1, 0, len(exif)), 3: (0, 0, 0)}
        meta_len = len(_full(b"meta", 0, meta_kids(dummy)))
        mdat_data = len(ftyp) + meta_len + 8
        offs = {1: (0, mdat_data, len(image)), 2: (1, 0, len(exif)), 3: (0, mdat_data + len(image), len(xmp))}
        meta = _full(b"meta", 0, meta_kids(offs))
    else:
        dummy = {1: (0, 0, 0), 2: (0, 0, 0), 3: (0, 0, 0)}
        meta_len = len(_full(b"meta", 0, hdlr + iinf + iloc(dummy)))
        mdat_data = len(ftyp) + meta_len + 8
        offs = {1: (0, mdat_data, len(image)), 2: (0, mdat_data + len(image), len(exif)),
                3: (0, mdat_data + len(image) + len(exif), len(xmp))}
        meta = _full(b"meta", 0, hdlr + iinf + iloc(offs))
    payload = image + (b"" if in_idat else exif) + xmp
    out = ftyp + meta + _box(b"mdat", payload)
    assert len(ftyp) + len(meta) + 8 == mdat_data
    return out
