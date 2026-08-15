# -*- coding: utf-8 -*-
"""Print a docs HTML file to its companion PDF via headless Chromium.

Used by build-style-guide.py and build-screens-sheet.py so the PDFs in
public/docs/ can't drift from the HTML they're printed from — every build
reprints them. The HTML carries its own @page rules (Letter, margins) and
print stylesheet; Chromium's print-to-PDF honors both.

Chromium discovery, in order: $DOCS_CHROME, the Playwright-managed binary at
/opt/pw-browsers/chromium (present on the remote runners), then chromium /
chromium-browser / google-chrome / chrome on PATH. If none is found the build
still succeeds — the HTML is the source of truth — but a loud warning says the
PDF is now stale and how to reprint it. Set DOCS_SKIP_PDF=1 to skip quietly
(e.g. in a check that only cares about the HTML).
"""

import os
import shutil
import subprocess
import sys


def _find_chrome():
    candidates = [
        os.environ.get("DOCS_CHROME"),
        "/opt/pw-browsers/chromium",
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("google-chrome"),
        shutil.which("chrome"),
    ]
    return next((c for c in candidates if c and os.path.exists(c)), None)


def print_pdf(html_path, pdf_path):
    """Print html_path to pdf_path. Returns True if the PDF was written."""
    if os.environ.get("DOCS_SKIP_PDF"):
        return False
    chrome = _find_chrome()
    name = os.path.basename(pdf_path)
    if not chrome:
        print(
            f"WARNING: no Chromium found — {name} NOT reprinted and is now stale.\n"
            f"  Install Chromium (or set DOCS_CHROME=/path/to/chrome) and re-run,\n"
            f"  or print manually: chrome --headless --no-pdf-header-footer "
            f"--print-to-pdf={pdf_path} file://{os.path.abspath(html_path)}",
            file=sys.stderr,
        )
        return False
    subprocess.run(
        [
            chrome,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--no-pdf-header-footer",
            f"--print-to-pdf={os.path.abspath(pdf_path)}",
            "file://" + os.path.abspath(html_path),
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )
    print("printed", pdf_path)
    return True
