import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

NODE = shutil.which("node")
RUNNER = Path(__file__).parent / "js" / "run_core.js"


def run_core(**req):
    """Send one request to tests/js/run_core.js (which loads src/dork_core.js) and return its JSON."""
    if NODE is None:
        pytest.skip("node not installed")
    r = subprocess.run([NODE, str(RUNNER)], input=json.dumps(req), capture_output=True, text=True,
                       timeout=30, check=True)
    return json.loads(r.stdout)
