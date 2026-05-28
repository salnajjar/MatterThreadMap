# Matter Thread Map

Matter Thread Map is a HACS custom integration for Home Assistant. It adds a sidebar panel that maps Matter devices connected over Thread, showing router-capable devices, visible Thread neighbors/routes, and link quality when devices expose it through the Matter Thread Network Diagnostics cluster.

## Current scope

- Uses Home Assistant's existing Matter integration and Matter Server connection.
- Reads Matter node diagnostics plus Thread neighbor and route tables when available.
- Shows paired Matter Thread devices and external Thread nodes discovered through route/neighbor data.
- Renders a local sidebar panel with no frontend build step.

## Install for development

1. Copy this repository into Home Assistant's `/config/custom_components` path through HACS as a custom repository, or copy `custom_components/matter_map` manually.
2. Restart Home Assistant.
3. Add **Matter Thread Map** from **Settings > Devices & services > Add integration**.
4. Open **Matter Thread Map** from the sidebar.

After updating the integration, restart Home Assistant and hard-refresh the browser or clear the Home Assistant frontend cache. Custom panel modules are cached aggressively by the browser.

## Notes

Thread topology visibility depends on device support. Some Matter over Thread devices expose full neighbor and route tables; others only expose basic role/network diagnostics. In those cases the panel will show the device but may not be able to draw all mesh links.

The integration does not create a new Thread border router or commission devices. It only visualizes diagnostics available from devices already paired to Home Assistant through Matter.
