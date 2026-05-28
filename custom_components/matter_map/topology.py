"""Build a Thread topology view from Matter diagnostics."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from typing import Any

from chip.clusters import Objects as Clusters
from chip.clusters.Types import NullValue
from matter_server.client.models.node import NetworkType, NodeType

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from homeassistant.components.matter.helpers import get_matter


@dataclass(slots=True)
class TopologyNode:
    """A node in the Thread topology graph."""

    id: str
    label: str
    node_id: int | None
    kind: str
    role: str
    available: bool | None
    network_name: str | None = None
    mac_address: str | None = None
    external: bool = False
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TopologyLink:
    """A link between two Thread topology nodes."""

    id: str
    source: str
    target: str
    relationship: str
    quality: int | None = None
    rssi: int | None = None
    lqi_in: int | None = None
    lqi_out: int | None = None
    path_cost: int | None = None
    details: dict[str, Any] = field(default_factory=dict)


async def async_build_topology(hass: HomeAssistant) -> dict[str, Any]:
    """Return Matter over Thread topology data."""
    matter = get_matter(hass)
    client = matter.matter_client
    device_registry = dr.async_get(hass)
    nodes: dict[str, TopologyNode] = {}
    links: dict[str, TopologyLink] = {}
    ids_by_mac: dict[str, str] = {}
    errors: list[dict[str, str]] = []

    matter_nodes = sorted(client.get_nodes(), key=lambda item: item.node_id)

    for matter_node in matter_nodes:
        try:
            diagnostics = await client.node_diagnostics(matter_node.node_id)
        except Exception as err:  # noqa: BLE001
            errors.append({"node_id": str(matter_node.node_id), "error": str(err)})
            continue

        if diagnostics.network_type is not NetworkType.THREAD:
            continue

        node_key = _node_key(matter_node.node_id)
        label = _device_label(device_registry, matter_node.node_id) or _node_label(
            matter_node
        )
        role = diagnostics.node_type.value
        mac_address = _normalize_hex(diagnostics.mac_address)
        if mac_address:
            ids_by_mac[mac_address] = node_key

        thread_cluster = _thread_cluster(matter_node)
        nodes[node_key] = TopologyNode(
            id=node_key,
            label=label,
            node_id=matter_node.node_id,
            kind="matter",
            role=role,
            available=diagnostics.available,
            network_name=diagnostics.network_name,
            mac_address=diagnostics.mac_address,
            details={
                "ip_addresses": diagnostics.ip_adresses,
                "fabric_index": diagnostics.active_fabric_index,
                "fabrics": [asdict(fabric) for fabric in diagnostics.active_fabrics],
                "leader_cost": _leader_cost(thread_cluster),
            },
        )

    for matter_node in matter_nodes:
        source_key = _node_key(matter_node.node_id)
        if source_key not in nodes:
            continue

        thread_cluster = _thread_cluster(matter_node)
        if thread_cluster is None:
            continue

        _add_neighbor_links(nodes, links, ids_by_mac, source_key, thread_cluster)
        _add_route_links(nodes, links, ids_by_mac, source_key, thread_cluster)

    return {
        "nodes": [asdict(node) for node in nodes.values()],
        "links": [asdict(link) for link in links.values()],
        "summary": {
            "matter_thread_nodes": sum(1 for node in nodes.values() if not node.external),
            "external_thread_nodes": sum(1 for node in nodes.values() if node.external),
            "links": len(links),
            "partial_errors": len(errors),
        },
        "errors": errors,
    }


def _add_neighbor_links(
    nodes: dict[str, TopologyNode],
    links: dict[str, TopologyLink],
    ids_by_mac: dict[str, str],
    source_key: str,
    thread_cluster: Any,
) -> None:
    """Add links from Thread neighbor table data."""
    for index, neighbor in enumerate(_table(thread_cluster, "neighborTable")):
        neighbor_id = _neighbor_identity(neighbor, index)
        target_key = _resolve_external_node(
            nodes,
            ids_by_mac,
            neighbor_id,
            "Thread neighbor",
            _neighbor_role(neighbor),
            {"rloc16": _safe_get(neighbor, "rloc16"), "source": "neighbor_table"},
        )
        rssi = _safe_get(neighbor, "averageRssi", "lastRssi")
        lqi_in = _safe_get(neighbor, "lqiIn")
        quality = _quality_from_lqi_rssi(lqi_in, rssi)
        relationship = "child" if _safe_get(neighbor, "isChild") else "neighbor"
        _put_link(
            links,
            TopologyLink(
                id=f"{source_key}:neighbor:{target_key}",
                source=source_key,
                target=target_key,
                relationship=relationship,
                quality=quality,
                rssi=rssi,
                lqi_in=lqi_in,
                details=_compact_details(neighbor),
            ),
        )


def _add_route_links(
    nodes: dict[str, TopologyNode],
    links: dict[str, TopologyLink],
    ids_by_mac: dict[str, str],
    source_key: str,
    thread_cluster: Any,
) -> None:
    """Add links from Thread route table data."""
    for index, route in enumerate(_table(thread_cluster, "routeTable")):
        if _safe_get(route, "allocated") is False:
            continue
        if _safe_get(route, "linkEstablished") is False:
            continue
        route_id = _route_identity(route, index)
        target_key = _resolve_external_node(
            nodes,
            ids_by_mac,
            route_id,
            "Thread router",
            "routing_end_device",
            {"router_id": _safe_get(route, "routerId"), "source": "route_table"},
        )
        lqi_in = _safe_get(route, "lqiIn")
        lqi_out = _safe_get(route, "lqiOut")
        path_cost = _safe_get(route, "pathCost")
        _put_link(
            links,
            TopologyLink(
                id=f"{source_key}:route:{target_key}",
                source=source_key,
                target=target_key,
                relationship="route",
                quality=_quality_from_lqi_cost(lqi_in, lqi_out, path_cost),
                lqi_in=lqi_in,
                lqi_out=lqi_out,
                path_cost=path_cost,
                details=_compact_details(route),
            ),
        )


def _put_link(links: dict[str, TopologyLink], link: TopologyLink) -> None:
    """Add the strongest known copy of a graph link."""
    existing = links.get(link.id)
    if existing is None or (link.quality or 0) > (existing.quality or 0):
        links[link.id] = link


def _thread_cluster(matter_node: Any) -> Any | None:
    """Return the Thread diagnostics cluster for a Matter node."""
    if not matter_node.has_cluster(Clusters.ThreadNetworkDiagnostics, endpoint=0):
        return None
    return matter_node.get_cluster(0, Clusters.ThreadNetworkDiagnostics)


def _leader_cost(thread_cluster: Any | None) -> int | None:
    """Return the Thread leader cost when exposed by diagnostics."""
    if thread_cluster is None:
        return None
    value = _safe_get(
        thread_cluster,
        "leaderCost",
        "leader_cost",
        "leaderPathCost",
        "leader_path_cost",
    )
    return value if isinstance(value, int) else None


def _table(cluster: Any, attr_name: str) -> Iterable[Any]:
    """Return a Thread diagnostics table as an iterable."""
    value = getattr(cluster, attr_name, None)
    if value in (None, NullValue):
        return ()
    return value


def _resolve_external_node(
    nodes: dict[str, TopologyNode],
    ids_by_mac: dict[str, str],
    identity: str,
    label_prefix: str,
    role: str,
    details: dict[str, Any],
) -> str:
    """Resolve a table identity to an existing or external graph node."""
    normalized = _normalize_hex(identity)
    if normalized in ids_by_mac:
        return ids_by_mac[normalized]

    key = f"thread:{normalized or identity}"
    if key not in nodes:
        nodes[key] = TopologyNode(
            id=key,
            label=f"{label_prefix} {identity}",
            node_id=None,
            kind="thread",
            role=role,
            available=None,
            external=True,
            details=details,
        )
    return key


def _neighbor_identity(neighbor: Any, index: int) -> str:
    """Return the best stable identifier from a neighbor table row."""
    return str(
        _safe_get(neighbor, "extAddress", "extendedAddress", "rloc16", "routerId")
        or f"neighbor-{index}"
    )


def _route_identity(route: Any, index: int) -> str:
    """Return the best stable identifier from a route table row."""
    return str(
        _safe_get(route, "extAddress", "extendedAddress", "routerId", "rloc16")
        or f"route-{index}"
    )


def _neighbor_role(neighbor: Any) -> str:
    """Infer a role for a neighbor table row."""
    if _safe_get(neighbor, "isChild"):
        if _safe_get(neighbor, "rxOnWhenIdle") is False:
            return NodeType.SLEEPY_END_DEVICE.value
        return NodeType.END_DEVICE.value
    if _safe_get(neighbor, "fullThreadDevice"):
        return NodeType.ROUTING_END_DEVICE.value
    return NodeType.UNKNOWN.value


def _quality_from_lqi_rssi(lqi: Any, rssi: Any) -> int | None:
    """Convert LQI/RSSI diagnostics to a 0-100 quality value."""
    if isinstance(lqi, int):
        return max(0, min(100, round(lqi / 3)))
    if isinstance(rssi, int):
        return max(0, min(100, round((rssi + 100) * 2)))
    return None


def _quality_from_lqi_cost(lqi_in: Any, lqi_out: Any, path_cost: Any) -> int | None:
    """Convert route diagnostics to a 0-100 quality value."""
    lqi_values = [value for value in (lqi_in, lqi_out) if isinstance(value, int)]
    if lqi_values:
        return max(0, min(100, round((sum(lqi_values) / len(lqi_values)) / 3)))
    if isinstance(path_cost, int) and path_cost > 0:
        return max(0, min(100, 100 - (path_cost - 1) * 20))
    return None


def _safe_get(row: Any, *names: str) -> Any:
    """Get the first present value from a Matter SDK row object."""
    for name in names:
        if hasattr(row, name):
            value = getattr(row, name)
            if value is not NullValue:
                return value
        if isinstance(row, dict) and name in row:
            value = row[name]
            if value is not NullValue:
                return value
    return None


def _compact_details(row: Any) -> dict[str, Any]:
    """Return JSON-safe details for a Matter SDK row object."""
    raw = row if isinstance(row, dict) else getattr(row, "__dict__", {})
    details: dict[str, Any] = {}
    for key, value in raw.items():
        if key.startswith("_") or value is NullValue:
            continue
        if isinstance(value, bytes):
            details[key] = value.hex()
        elif isinstance(value, (str, int, float, bool)) or value is None:
            details[key] = value
    return details


def _normalize_hex(value: Any) -> str:
    """Normalize MAC/EUI strings for matching."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.hex()
    return "".join(char.lower() for char in str(value) if char.isalnum())


def _node_key(node_id: int) -> str:
    """Return graph node id for a Matter node."""
    return f"matter:{node_id}"


def _node_label(matter_node: Any) -> str:
    """Return a human label for a Matter node."""
    return matter_node.name or f"Matter node {matter_node.node_id}"


def _device_label(device_registry: dr.DeviceRegistry, node_id: int) -> str | None:
    """Find a Home Assistant device name for a Matter node."""
    node_id_hex = f"{node_id:016X}"
    for device in device_registry.devices.values():
        if any(
            domain == "matter" and node_id_hex in identifier
            for domain, identifier in device.identifiers
        ):
            return device.name_by_user or device.name
    return None
