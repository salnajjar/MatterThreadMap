"""Matter Thread Map integration."""

from __future__ import annotations

import logging

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    FRONTEND_DIR,
    FRONTEND_MODULE,
    NAME,
    PANEL_URL,
    STATIC_PATH,
    VERSION,
)
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up Matter Thread Map."""
    async_register_websocket_api(hass)
    return True


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Set up Matter Thread Map from a config entry."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_PATH, str(FRONTEND_DIR), True)]
    )

    module_url = f"{FRONTEND_MODULE}?v={VERSION}"
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name="matter-map-panel",
        sidebar_title=NAME,
        sidebar_icon="mdi:graph-outline",
        module_url=module_url,
        require_admin=False,
        config={"domain": DOMAIN},
    )

    def _unregister_panel() -> None:
        frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)

    entry.async_on_unload(_unregister_panel)
    _LOGGER.debug("Matter Thread Map panel registered")
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Unload Matter Thread Map."""
    return True
