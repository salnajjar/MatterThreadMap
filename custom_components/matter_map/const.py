"""Constants for Matter Thread Map."""

from __future__ import annotations

from pathlib import Path

DOMAIN = "matter_map"
NAME = "Matter Thread Map"
VERSION = "0.1.8"
PANEL_URL = "matter-thread-map"
STATIC_PATH = "/matter_map_static"
FRONTEND_DIR = Path(__file__).parent / "frontend"
FRONTEND_MODULE = f"{STATIC_PATH}/matter-map-panel.js"
