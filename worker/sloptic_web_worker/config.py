"""Worker configuration, read from the environment (.env in dev)."""

import os
from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise SystemExit(f"missing required env var: {name}")
    return val


DATABASE_URL = _require("DATABASE_URL")
CATALOG_DIR = os.environ.get("CATALOG_DIR", "../../sloptic-main/catalog")
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))

# P0 safety gate: the egress sandbox is not implemented, so real grading is refused unless this is set.
EGRESS_SANDBOX_READY = os.environ.get("EGRESS_SANDBOX_READY", "").strip() in ("1", "true", "yes")
