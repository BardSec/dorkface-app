# Files made by real encoders

Regression fixtures for `src/meta_core.js`, made with macOS tools (not by our own test builders),
so the readers are checked against files the formats' real producers write. All metadata is
made-up sample data.

- `real.doc`: `textutil -convert doc -author "Real Author" -company "Real Company" -title "Real Title" -subject "Real Subject"` on a one-line text file (Word 97 binary format).
- `real.heic`: a 16×16 PNG converted to JPEG with `sips`, given the EXIF block from
  `tests/test_meta.py` `tiff()` (camera, serial number, GPS), then `sips -s format heic`
  (Apple's HEIC encoder, which also adds its own XMP).
