"""Websocket API for Matter Thread Map."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from homeassistant.components.matter.const import DOMAIN as MATTER_DOMAIN

from .topology import async_build_topology


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register Matter Thread Map websocket commands."""
    websocket_api.async_register_command(hass, websocket_get_topology)


@websocket_api.websocket_command({vol.Required("type"): "matter_map/get_topology"})
@websocket_api.async_response
async def websocket_get_topology(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the current Matter over Thread topology."""
    if not hass.config_entries.async_loaded_entries(MATTER_DOMAIN):
        connection.send_error(
            msg["id"], "matter_not_loaded", "The Matter integration is not loaded"
        )
        return

    try:
        topology = await async_build_topology(hass)
    except Exception as err:  # noqa: BLE001
        connection.send_error(msg["id"], "topology_failed", str(err))
        return

    connection.send_result(msg["id"], topology)
