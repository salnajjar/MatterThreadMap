class MatterMapPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = undefined;
    this._topology = undefined;
    this._loading = true;
    this._error = "";
    this._selected = undefined;
    this._timer = undefined;
    this._frame = undefined;
    this._graph = this._emptyGraph();
    this._state = new Map();
    this._view = { x: 0, y: 0, scale: 1 };
    this._drag = undefined;
    this._suppressClick = false;
    this._pan = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._topology && !this._loading) {
      this._loadTopology();
    }
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._renderShell();
    this._loadTopology();
    this._timer = window.setInterval(() => this._loadTopology(true), 30000);
  }

  disconnectedCallback() {
    if (this._timer) {
      window.clearInterval(this._timer);
      this._timer = undefined;
    }
    this._stopSimulation();
    this._removeWindowDragHandlers();
  }

  async _loadTopology(quiet = false) {
    if (!this._hass) {
      this._loading = false;
      this._renderShell();
      return;
    }

    if (!quiet) {
      this._loading = true;
      this._error = "";
      this._renderShell();
    }

    try {
      this._topology = await this._hass.callWS({ type: "matter_map/get_topology" });
      this._error = "";
    } catch (err) {
      this._error = err && err.message ? err.message : "Unable to load topology";
    } finally {
      this._loading = false;
      this._renderShell();
    }
  }

  _renderShell() {
    const topology = this._topology || { nodes: [], links: [], summary: {} };
    const selected = topology.nodes.find((node) => node.id === this._selected);
    this._graph = this._buildGraph(topology.nodes, topology.links);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100vh;
          height: 100dvh;
          min-height: 100vh;
          overflow: hidden;
          color: var(--primary-text-color);
          background: var(--primary-background-color);
          font-family: var(--paper-font-body1_-_font-family, Roboto, Arial, sans-serif);
        }
        .shell {
          height: 100%;
          min-height: 0;
          display: grid;
          grid-template-rows: auto 1fr;
          overflow: hidden;
        }
        header {
          display: flex;
          gap: 16px;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 16px;
          border-bottom: 1px solid var(--divider-color);
          background: var(--app-header-background-color, var(--card-background-color));
        }
        h1 {
          margin: 0;
          font-size: 22px;
          line-height: 1.25;
          font-weight: 500;
        }
        .subtitle {
          margin-top: 4px;
          color: var(--secondary-text-color);
          font-size: 13px;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        button {
          min-height: 36px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          padding: 0 14px;
          color: var(--primary-text-color);
          background: var(--card-background-color);
          cursor: pointer;
          font: inherit;
        }
        button:hover {
          background: var(--secondary-background-color);
        }
        main {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          min-height: 0;
          overflow: hidden;
        }
        .graph-wrap {
          position: relative;
          min-height: 0;
          overflow: hidden;
          background:
            linear-gradient(90deg, color-mix(in srgb, var(--divider-color) 45%, transparent) 1px, transparent 1px),
            linear-gradient(0deg, color-mix(in srgb, var(--divider-color) 45%, transparent) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        svg {
          width: 100%;
          height: 100%;
          min-height: 0;
          display: block;
          cursor: grab;
          touch-action: none;
        }
        svg.panning {
          cursor: grabbing;
        }
        .viewport {
          transform-origin: 0 0;
        }
        .link {
          stroke-linecap: round;
          opacity: 0.84;
          pointer-events: none;
        }
        .link-label {
          fill: var(--secondary-text-color);
          font-size: 11px;
          pointer-events: none;
        }
        .node {
          cursor: pointer;
          touch-action: none;
        }
        .node circle {
          stroke-width: 3px;
          stroke: var(--card-background-color);
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.22));
        }
        .node text {
          fill: var(--primary-text-color);
          font-size: 12px;
          text-anchor: middle;
          paint-order: stroke;
          stroke: var(--primary-background-color);
          stroke-width: 4px;
          stroke-linejoin: round;
          pointer-events: none;
        }
        .node .role {
          fill: var(--secondary-text-color);
          font-size: 10px;
        }
        .node.selected circle {
          stroke: var(--accent-color);
          stroke-width: 4px;
        }
        .node.center circle {
          stroke: var(--warning-color, #f39c12);
        }
        .node.pinned circle {
          stroke-dasharray: 3 3;
        }
        aside {
          border-left: 1px solid var(--divider-color);
          background: var(--card-background-color);
          padding: 18px;
          overflow: auto;
          min-height: 0;
        }
        .metric-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 18px;
        }
        .metric {
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          padding: 10px;
          min-width: 0;
        }
        .metric strong {
          display: block;
          font-size: 20px;
          font-weight: 500;
        }
        .metric span,
        .empty,
        .meta {
          color: var(--secondary-text-color);
          font-size: 12px;
        }
        .panel-title {
          margin: 0 0 10px;
          font-size: 16px;
          font-weight: 500;
        }
        .section-title {
          margin: 18px 0 10px;
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          text-transform: uppercase;
        }
        .detail {
          border-top: 1px solid var(--divider-color);
          padding-top: 14px;
          overflow-wrap: anywhere;
        }
        dl {
          display: grid;
          grid-template-columns: 112px minmax(0, 1fr);
          gap: 8px 12px;
          margin: 0;
          font-size: 13px;
        }
        dt {
          color: var(--secondary-text-color);
        }
        dd {
          margin: 0;
        }
        .connected-list {
          display: grid;
          gap: 8px;
        }
        .connected-node {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 6px;
          width: 100%;
          min-height: 0;
          padding: 10px;
          text-align: left;
        }
        .connected-main {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 2px;
        }
        .connected-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          font-weight: 500;
        }
        .connected-id,
        .connected-meta {
          color: var(--secondary-text-color);
          font-size: 11px;
        }
        .connected-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 8px;
        }
        .banner {
          position: absolute;
          inset: 18px auto auto 18px;
          max-width: min(560px, calc(100% - 36px));
          padding: 12px 14px;
          border-radius: 6px;
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.16));
          z-index: 1;
        }
        .map-controls {
          position: absolute;
          right: 18px;
          top: 18px;
          display: flex;
          gap: 8px;
          z-index: 2;
        }
        .map-controls button {
          width: 38px;
          min-width: 38px;
          padding: 0;
          font-size: 18px;
          line-height: 1;
        }
        @media (max-width: 860px) {
          :host {
            height: auto;
            overflow: visible;
          }
          .shell,
          main {
            height: auto;
            overflow: visible;
          }
          header {
            align-items: flex-start;
            flex-direction: column;
            padding: 16px;
          }
          main {
            grid-template-columns: 1fr;
          }
          aside {
            border-left: 0;
            border-top: 1px solid var(--divider-color);
            overflow: visible;
          }
          .graph-wrap,
          svg {
            min-height: 460px;
          }
        }
      </style>
      <div class="shell">
        <header>
          <div>
            <h1>Matter Thread Map</h1>
            <div class="subtitle">${this._subtitle(topology)}</div>
          </div>
          <div class="actions">
            <button title="Refresh Thread topology" id="refresh">Refresh</button>
          </div>
        </header>
        <main>
          <section class="graph-wrap">
            ${this._statusBanner(topology)}
            <div class="map-controls">
              <button id="zoom-in" title="Zoom in">+</button>
              <button id="zoom-out" title="Zoom out">-</button>
              <button id="zoom-reset" title="Reset map view">1:1</button>
            </div>
            <svg viewBox="0 0 ${this._graph.width} ${this._graph.height}" role="img" aria-label="Matter Thread network graph">
              <g class="viewport">
                <g class="link-layer"></g>
                <g class="node-layer"></g>
              </g>
            </svg>
          </section>
          <aside>
            <div class="metric-grid">
              <div class="metric"><strong>${topology.summary.matter_thread_nodes || 0}</strong><span>Matter devices</span></div>
              <div class="metric"><strong>${topology.summary.unresolved_thread_links || 0}</strong><span>Unresolved links</span></div>
              <div class="metric"><strong>${topology.summary.links || 0}</strong><span>Links</span></div>
              <div class="metric"><strong>${topology.summary.partial_errors || 0}</strong><span>Read errors</span></div>
            </div>
            <div class="details-pane">
              ${selected ? this._details(selected, topology.nodes, topology.links) : '<p class="empty">Select a node to inspect its role and links.</p>'}
            </div>
          </aside>
        </main>
      </div>
    `;

    this._bindShellEvents();
    this._renderGraph();
    this._applyViewTransform();
    this._startSimulation();
  }

  _bindShellEvents() {
    const refreshButton = this.shadowRoot.getElementById("refresh");
    const zoomIn = this.shadowRoot.getElementById("zoom-in");
    const zoomOut = this.shadowRoot.getElementById("zoom-out");
    const zoomReset = this.shadowRoot.getElementById("zoom-reset");
    const svg = this.shadowRoot.querySelector("svg");

    if (refreshButton) {
      refreshButton.addEventListener("click", () => this._loadTopology());
    }
    if (zoomIn) {
      zoomIn.addEventListener("click", () => this._zoomBy(1.2));
    }
    if (zoomOut) {
      zoomOut.addEventListener("click", () => this._zoomBy(1 / 1.2));
    }
    if (zoomReset) {
      zoomReset.addEventListener("click", () => this._resetView());
    }
    if (!svg) {
      return;
    }

    svg.addEventListener("wheel", (event) => this._onWheel(event), { passive: false });
    svg.addEventListener("pointerdown", (event) => this._onSvgPointerDown(event));
    svg.addEventListener("pointermove", (event) => this._onSvgPointerMove(event));
    svg.addEventListener("pointerup", () => this._endPan());
    svg.addEventListener("pointerleave", () => this._endPan());
  }

  _renderGraph() {
    const linkLayer = this.shadowRoot.querySelector(".link-layer");
    const nodeLayer = this.shadowRoot.querySelector(".node-layer");
    if (!linkLayer || !nodeLayer) {
      return;
    }

    linkLayer.innerHTML = this._graph.links.map((link) => this._linkSvg(link)).join("");
    nodeLayer.innerHTML = this._graph.nodes.map((node) => this._nodeSvg(node)).join("");

    this.shadowRoot.querySelectorAll(".node").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (this._suppressClick) {
          this._suppressClick = false;
          return;
        }
        this._selectNode(element.getAttribute("data-node-id"));
        event.stopPropagation();
      });
      element.addEventListener("pointerdown", (event) => this._startNodeDrag(event, element));
    });

    this.shadowRoot.querySelectorAll(".connected-node").forEach((element) => {
      element.addEventListener("click", () => this._selectNode(element.getAttribute("data-node-id")));
    });

    this._syncGraphDom();
  }

  _selectNode(nodeId) {
    this._selected = nodeId;
    this._updateSelectedClasses();
    this._renderDetailsPane();
  }

  _renderDetailsPane() {
    const pane = this.shadowRoot.querySelector(".details-pane");
    if (!pane) {
      return;
    }
    const topology = this._topology || { nodes: [], links: [] };
    const selected = topology.nodes.find((node) => node.id === this._selected);
    pane.innerHTML = selected ? this._details(selected, topology.nodes, topology.links) : '<p class="empty">Select a node to inspect its role and links.</p>';
    pane.querySelectorAll(".connected-node").forEach((element) => {
      element.addEventListener("click", () => this._selectNode(element.getAttribute("data-node-id")));
    });
  }

  _updateSelectedClasses() {
    this.shadowRoot.querySelectorAll(".node").forEach((element) => {
      if (element.getAttribute("data-node-id") === this._selected) {
        element.classList.add("selected");
      } else {
        element.classList.remove("selected");
      }
    });
  }

  _subtitle(topology) {
    if (this._loading) {
      return "Reading Thread diagnostics from Matter devices, this may take a minute or two...";
    }
    if (this._error) {
      return this._error;
    }
    const count = topology.summary && topology.summary.matter_thread_nodes ? topology.summary.matter_thread_nodes : 0;
    return `${count} paired Thread ${count === 1 ? "device" : "devices"} found`;
  }

  _statusBanner(topology) {
    if (this._loading) {
      return '<div class="banner">Loading topology...</div>';
    }
    if (this._error) {
      return `<div class="banner">${this._escape(this._error)}</div>`;
    }
    if (!topology.nodes.length) {
      return '<div class="banner">No Matter over Thread diagnostics were found. Add Matter Thread devices first, then refresh this panel.</div>';
    }
    if (topology.errors && topology.errors.length) {
      return `<div class="banner">${topology.errors.length} device diagnostic ${topology.errors.length === 1 ? "read" : "reads"} returned partial data.</div>`;
    }
    return "";
  }

  _emptyGraph() {
    return {
      width: 1200,
      height: 800,
      nodes: [],
      links: [],
      nodeById: new Map(),
      centerId: undefined,
      alpha: 0,
    };
  }

  _buildGraph(rawNodes, rawLinks) {
    const graph = this._sizedGraph(rawNodes.length);
    const centerNode = this._chooseCenterNode(rawNodes, rawLinks);
    graph.centerId = centerNode ? centerNode.id : undefined;

    const degrees = this._degrees(rawLinks);
    const centerX = graph.width / 2;
    const centerY = graph.height / 2;
    const ordered = this._orderedNodes(rawNodes, rawLinks, graph.centerId);

    ordered.forEach((rawNode, index) => {
      const isCenter = rawNode.id === graph.centerId;
      const fallback = this._fallbackPosition(index, Math.max(1, ordered.length - 1), isCenter, centerX, centerY);
      const state = this._stateFor(rawNode, fallback.x, fallback.y);
      const node = {
        ...rawNode,
        x: isCenter ? centerX : state.x,
        y: isCenter ? centerY : state.y,
        vx: state.vx || 0,
        vy: state.vy || 0,
        radius: this._nodeRadius(rawNode, isCenter),
        isCenter,
        pinned: isCenter || state.pinned,
        degree: degrees.get(rawNode.id) || 0,
      };
      if (isCenter) {
        state.x = centerX;
        state.y = centerY;
        state.vx = 0;
        state.vy = 0;
        state.pinned = true;
      }
      graph.nodes.push(node);
      graph.nodeById.set(node.id, node);
    });

    graph.links = rawLinks
      .map((rawLink) => {
        const source = graph.nodeById.get(rawLink.source);
        const target = graph.nodeById.get(rawLink.target);
        if (!source || !target) {
          return undefined;
        }
        const preferredDistance = source.isCenter || target.isCenter ? 230 : 175;
        return {
          ...rawLink,
          sourceNode: source,
          targetNode: target,
          preferredDistance,
        };
      })
      .filter((link) => Boolean(link));

    this._repairStackedState(graph.nodes, centerX, centerY);
    this._resolveCollisions(graph.nodes, graph.width, graph.height, 52);
    this._persistGraphState(graph.nodes);
    graph.alpha = 1;
    return graph;
  }

  _sizedGraph(nodeCount) {
    const graph = this._emptyGraph();
    const radius = Math.max(320, 84 * Math.sqrt(Math.max(1, nodeCount)));
    graph.width = Math.max(1200, Math.ceil(radius * 2 + 360));
    graph.height = Math.max(800, Math.ceil(radius * 2 + 300));
    return graph;
  }

  _stateFor(node, fallbackX, fallbackY) {
    let state = this._state.get(node.id);
    if (!state) {
      state = {
        x: fallbackX,
        y: fallbackY,
        vx: 0,
        vy: 0,
        pinned: false,
      };
      this._state.set(node.id, state);
    }
    return state;
  }

  _degrees(links) {
    const degrees = new Map();
    links.forEach((link) => {
      degrees.set(link.source, (degrees.get(link.source) || 0) + 1);
      degrees.set(link.target, (degrees.get(link.target) || 0) + 1);
    });
    return degrees;
  }

  _orderedNodes(nodes, links, centerId) {
    const directIds = new Set();
    links.forEach((link) => {
      if (link.source === centerId) {
        directIds.add(link.target);
      }
      if (link.target === centerId) {
        directIds.add(link.source);
      }
    });
    return [...nodes].sort((a, b) => {
      if (a.id === centerId) {
        return -1;
      }
      if (b.id === centerId) {
        return 1;
      }
      const aDirect = directIds.has(a.id) ? 0 : 1;
      const bDirect = directIds.has(b.id) ? 0 : 1;
      if (aDirect !== bDirect) {
        return aDirect - bDirect;
      }
      const aRouter = a.role && a.role.includes("routing") ? 0 : 1;
      const bRouter = b.role && b.role.includes("routing") ? 0 : 1;
      if (aRouter !== bRouter) {
        return aRouter - bRouter;
      }
      return String(a.label || a.id).localeCompare(String(b.label || b.id));
    });
  }

  _fallbackPosition(index, count, isCenter, centerX, centerY) {
    if (isCenter) {
      return { x: centerX, y: centerY };
    }
    const spiralIndex = Math.max(0, index - 1);
    const angle = spiralIndex * 2.399963229728653;
    const radius = 190 + 78 * Math.sqrt(spiralIndex);
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  }

  _repairStackedState(nodes, centerX, centerY) {
    const buckets = new Map();
    nodes.forEach((node) => {
      if (node.isCenter || node.pinned) {
        return;
      }
      const key = `${Math.round(node.x / 24)}:${Math.round(node.y / 24)}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });

    let needsRepair = false;
    buckets.forEach((count) => {
      if (count > 2) {
        needsRepair = true;
      }
    });

    if (!needsRepair) {
      return;
    }

    let index = 1;
    nodes.forEach((node) => {
      if (node.isCenter || node.pinned) {
        return;
      }
      const fallback = this._fallbackPosition(index, nodes.length, false, centerX, centerY);
      node.x = fallback.x;
      node.y = fallback.y;
      node.vx = 0;
      node.vy = 0;
      index += 1;
    });
  }

  _startSimulation() {
    this._stopSimulation();
    if (!this._graph.nodes.length) {
      return;
    }
    this._graph.alpha = Math.max(this._graph.alpha, 0.9);
    const step = () => {
      this._tick();
      this._syncGraphDom();
      this._graph.alpha *= 0.982;
      if (this._graph.alpha > 0.004 || this._drag) {
        this._frame = window.requestAnimationFrame(step);
      } else {
        this._frame = undefined;
      }
    };
    this._frame = window.requestAnimationFrame(step);
  }

  _stopSimulation() {
    if (this._frame) {
      window.cancelAnimationFrame(this._frame);
      this._frame = undefined;
    }
  }

  _wakeSimulation(alpha) {
    this._graph.alpha = Math.max(this._graph.alpha, alpha || 0.45);
    if (!this._frame) {
      this._startSimulation();
    }
  }

  _tick() {
    const graph = this._graph;
    const alpha = graph.alpha;

    this._applySpringForces(graph.links, alpha);
    this._applyRepulsion(graph.nodes, alpha);
    this._applyCentering(graph.nodes, graph.width / 2, graph.height / 2, alpha);
    this._integrate(graph.nodes, graph.width, graph.height);
    this._persistGraphState(graph.nodes);
  }

  _applySpringForces(links, alpha) {
    links.forEach((link) => {
      const source = link.sourceNode;
      const target = link.targetNode;
      const dx = target.x - source.x || 0.01;
      const dy = target.y - source.y || 0.01;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const strength = (source.isCenter || target.isCenter ? 0.018 : 0.012) * alpha;
      const force = (distance - link.preferredDistance) * strength;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      this._pushNode(source, fx, fy);
      this._pushNode(target, -fx, -fy);
    });
  }

  _applyRepulsion(nodes, alpha) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const minDistance = a.radius + b.radius + 52;

        if (distance < minDistance) {
          const overlap = (minDistance - distance) / distance;
          const force = overlap * 0.42 * alpha;
          this._separatePair(a, b, dx * force, dy * force);
          continue;
        }

        const charge = (a.isCenter || b.isCenter ? 4200 : 2300) * alpha;
        const force = charge / Math.max(distance * distance, 2200);
        this._pushNode(a, -dx * force, -dy * force);
        this._pushNode(b, dx * force, dy * force);
      }
    }
  }

  _applyCentering(nodes, centerX, centerY, alpha) {
    nodes.forEach((node) => {
      if (this._isFixed(node)) {
        return;
      }
      const strength = node.degree ? 0.00016 : 0.00045;
      node.vx += (centerX - node.x) * strength * alpha;
      node.vy += (centerY - node.y) * strength * alpha;
    });
  }

  _integrate(nodes, width, height) {
    const padding = 72;
    nodes.forEach((node) => {
      if (node.isCenter) {
        node.x = width / 2;
        node.y = height / 2;
        node.vx = 0;
        node.vy = 0;
        return;
      }
      if (node.pinned || (this._drag && this._drag.id === node.id)) {
        node.vx = 0;
        node.vy = 0;
        return;
      }
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x += node.vx;
      node.y += node.vy;
      this._nudgeInside(node, width, height, padding);
    });
  }

  _pushNode(node, fx, fy) {
    if (this._isFixed(node)) {
      return;
    }
    node.vx += fx;
    node.vy += fy;
  }

  _separatePair(a, b, fx, fy) {
    const aFixed = this._isFixed(a);
    const bFixed = this._isFixed(b);
    if (aFixed && bFixed) {
      return;
    }
    if (aFixed) {
      this._pushNode(b, fx * 2, fy * 2);
      return;
    }
    if (bFixed) {
      this._pushNode(a, -fx * 2, -fy * 2);
      return;
    }
    this._pushNode(a, -fx, -fy);
    this._pushNode(b, fx, fy);
  }

  _resolveCollisions(nodes, width, height, passes) {
    const padding = 72;
    for (let pass = 0; pass < passes; pass += 1) {
      let moved = false;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x || 0.01;
          const dy = b.y - a.y || 0.01;
          const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const minDistance = a.radius + b.radius + 56;
          if (distance >= minDistance) {
            continue;
          }
          const shift = (minDistance - distance) / distance;
          const sx = dx * shift * 0.36;
          const sy = dy * shift * 0.36;
          const aFixed = this._isFixed(a);
          const bFixed = this._isFixed(b);
          if (!aFixed && !bFixed) {
            a.x -= sx;
            a.y -= sy;
            b.x += sx;
            b.y += sy;
            moved = true;
          } else if (aFixed && !bFixed) {
            b.x += sx * 2;
            b.y += sy * 2;
            moved = true;
          } else if (!aFixed && bFixed) {
            a.x -= sx * 2;
            a.y -= sy * 2;
            moved = true;
          }
        }
      }
      nodes.forEach((node) => this._nudgeInside(node, width, height, padding));
      if (!moved) {
        break;
      }
    }
  }

  _nudgeInside(node, width, height, padding) {
    if (node.isCenter) {
      return;
    }
    if (node.x < padding) {
      node.x = padding + (padding - node.x) * 0.18;
      node.vx = Math.abs(node.vx || 0) * 0.15;
    } else if (node.x > width - padding) {
      node.x = width - padding - (node.x - (width - padding)) * 0.18;
      node.vx = -Math.abs(node.vx || 0) * 0.15;
    }
    if (node.y < padding) {
      node.y = padding + (padding - node.y) * 0.18;
      node.vy = Math.abs(node.vy || 0) * 0.15;
    } else if (node.y > height - padding) {
      node.y = height - padding - (node.y - (height - padding)) * 0.18;
      node.vy = -Math.abs(node.vy || 0) * 0.15;
    }
  }

  _isFixed(node) {
    return node.isCenter || node.pinned || Boolean(this._drag && this._drag.id === node.id);
  }

  _persistGraphState(nodes) {
    nodes.forEach((node) => {
      const state = this._stateFor(node, node.x, node.y);
      state.x = node.x;
      state.y = node.y;
      state.vx = node.vx || 0;
      state.vy = node.vy || 0;
      state.pinned = Boolean(node.pinned);
    });
  }

  _syncGraphDom() {
    const root = this.shadowRoot;
    this._graph.nodes.forEach((node) => {
      const element = root.querySelector(`.node[data-node-id="${this._selectorEscape(node.id)}"]`);
      if (!element) {
        return;
      }
      element.setAttribute("transform", `translate(${node.x}, ${node.y})`);
      if (node.pinned && !node.isCenter) {
        element.classList.add("pinned");
      } else {
        element.classList.remove("pinned");
      }
    });
    this._graph.links.forEach((link) => {
      const linkId = this._selectorEscape(link.id);
      const line = root.querySelector(`.link[data-link-id="${linkId}"]`);
      const label = root.querySelector(`.link-label[data-link-id="${linkId}"]`);
      const midX = (link.sourceNode.x + link.targetNode.x) / 2;
      const midY = (link.sourceNode.y + link.targetNode.y) / 2;
      if (line) {
        line.setAttribute("x1", link.sourceNode.x);
        line.setAttribute("y1", link.sourceNode.y);
        line.setAttribute("x2", link.targetNode.x);
        line.setAttribute("y2", link.targetNode.y);
      }
      if (label) {
        label.setAttribute("x", midX);
        label.setAttribute("y", midY - 8);
      }
    });
  }

  _onWheel(event) {
    const svg = this.shadowRoot.querySelector("svg");
    if (!svg) {
      return;
    }
    const point = this._eventToRawSvgPoint(svg, event);
    this._zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, point.x, point.y);
    event.preventDefault();
  }

  _onSvgPointerDown(event) {
    if (event.target.closest && event.target.closest(".node")) {
      return;
    }
    const svg = this.shadowRoot.querySelector("svg");
    if (!svg) {
      return;
    }
    this._pan = {
      startX: event.clientX,
      startY: event.clientY,
      viewX: this._view.x,
      viewY: this._view.y,
    };
    svg.classList.add("panning");
    if (svg.setPointerCapture) {
      svg.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  }

  _onSvgPointerMove(event) {
    if (!this._pan || this._drag) {
      return;
    }
    const svg = this.shadowRoot.querySelector("svg");
    if (!svg) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    const scaleX = this._graph.width / rect.width;
    const scaleY = this._graph.height / rect.height;
    this._view.x = this._pan.viewX + (event.clientX - this._pan.startX) * scaleX;
    this._view.y = this._pan.viewY + (event.clientY - this._pan.startY) * scaleY;
    this._clampView();
    this._applyViewTransform();
    event.preventDefault();
  }

  _endPan() {
    this._pan = undefined;
    const svg = this.shadowRoot.querySelector("svg");
    if (svg) {
      svg.classList.remove("panning");
    }
  }

  _startNodeDrag(event, element) {
    const nodeId = element.getAttribute("data-node-id");
    const node = this._graph.nodeById.get(nodeId);
    const svg = this.shadowRoot.querySelector("svg");
    if (!node || node.isCenter || !svg) {
      return;
    }
    const pointer = this._eventToGraphPoint(svg, event);
    this._drag = {
      id: node.id,
      offsetX: node.x - pointer.x,
      offsetY: node.y - pointer.y,
      moved: false,
    };
    node.pinned = true;
    this._stopSimulation();

    this._dragMove = (moveEvent) => {
      this._moveDraggedNode(moveEvent);
      moveEvent.preventDefault();
    };
    this._dragEnd = () => this._finishNodeDrag();
    window.addEventListener("pointermove", this._dragMove, { passive: false });
    window.addEventListener("pointerup", this._dragEnd, { once: true });
    if (element.setPointerCapture) {
      element.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  }

  _moveDraggedNode(event) {
    if (!this._drag) {
      return;
    }
    const svg = this.shadowRoot.querySelector("svg");
    const node = this._graph.nodeById.get(this._drag.id);
    if (!svg || !node) {
      return;
    }
    const point = this._eventToGraphPoint(svg, event);
    node.x = Math.max(72, Math.min(this._graph.width - 72, point.x + this._drag.offsetX));
    node.y = Math.max(72, Math.min(this._graph.height - 72, point.y + this._drag.offsetY));
    node.vx = 0;
    node.vy = 0;
    this._drag.moved = true;
    this._resolveCollisions(this._graph.nodes, this._graph.width, this._graph.height, 8);
    this._persistGraphState(this._graph.nodes);
    this._syncGraphDom();
  }

  _finishNodeDrag() {
    if (!this._drag) {
      return;
    }
    const node = this._graph.nodeById.get(this._drag.id);
    const moved = this._drag.moved;
    this._removeWindowDragHandlers();
    if (node) {
      this._placePinnedNode(node);
      node.pinned = true;
      node.vx = 0;
      node.vy = 0;
    }
    this._drag = undefined;
    this._suppressClick = moved;
    this._persistGraphState(this._graph.nodes);
    this._wakeSimulation(0.75);
  }

  _removeWindowDragHandlers() {
    if (this._dragMove) {
      window.removeEventListener("pointermove", this._dragMove);
      this._dragMove = undefined;
    }
    this._dragEnd = undefined;
  }

  _placePinnedNode(node) {
    const originalX = node.x;
    const originalY = node.y;
    const candidates = [{ x: originalX, y: originalY }];
    for (let radius = 42; radius <= 220; radius += 26) {
      for (let step = 0; step < 14; step += 1) {
        const angle = (Math.PI * 2 * step) / 14;
        candidates.push({
          x: originalX + Math.cos(angle) * radius,
          y: originalY + Math.sin(angle) * radius,
        });
      }
    }

    let best = candidates[0];
    let bestScore = Infinity;
    candidates.forEach((candidate) => {
      const x = Math.max(72, Math.min(this._graph.width - 72, candidate.x));
      const y = Math.max(72, Math.min(this._graph.height - 72, candidate.y));
      let overlapPenalty = 0;
      this._graph.nodes.forEach((other) => {
        if (other.id === node.id) {
          return;
        }
        const dx = other.x - x;
        const dy = other.y - y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const minDistance = node.radius + other.radius + 54;
        if (distance < minDistance) {
          overlapPenalty += (minDistance - distance) * 80;
        }
      });
      const travel = Math.hypot(x - originalX, y - originalY);
      const score = overlapPenalty + travel;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    });

    node.x = best.x;
    node.y = best.y;
  }

  _eventToRawSvgPoint(svg, event) {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return {
      x: ((event.clientX - rect.left) / rect.width) * viewBox.width + viewBox.x,
      y: ((event.clientY - rect.top) / rect.height) * viewBox.height + viewBox.y,
    };
  }

  _eventToGraphPoint(svg, event) {
    const raw = this._eventToRawSvgPoint(svg, event);
    return {
      x: (raw.x - this._view.x) / this._view.scale,
      y: (raw.y - this._view.y) / this._view.scale,
    };
  }

  _zoomBy(factor) {
    this._zoomAt(factor, this._graph.width / 2, this._graph.height / 2);
  }

  _zoomAt(factor, rawX, rawY) {
    const oldScale = this._view.scale;
    const newScale = Math.max(0.35, Math.min(4, oldScale * factor));
    const graphX = (rawX - this._view.x) / oldScale;
    const graphY = (rawY - this._view.y) / oldScale;
    this._view.scale = newScale;
    this._view.x = rawX - graphX * newScale;
    this._view.y = rawY - graphY * newScale;
    this._clampView();
    this._applyViewTransform();
  }

  _resetView() {
    this._view = { x: 0, y: 0, scale: 1 };
    this._applyViewTransform();
  }

  _clampView() {
    const width = this._graph.width;
    const height = this._graph.height;
    this._view.scale = Math.max(0.35, Math.min(4, this._view.scale));
    this._view.x = Math.max(-width * this._view.scale, Math.min(width, this._view.x));
    this._view.y = Math.max(-height * this._view.scale, Math.min(height, this._view.y));
  }

  _applyViewTransform() {
    const viewport = this.shadowRoot.querySelector(".viewport");
    if (viewport) {
      viewport.setAttribute("transform", `translate(${this._view.x}, ${this._view.y}) scale(${this._view.scale})`);
    }
  }

  _chooseCenterNode(nodes, links) {
    if (!nodes.length) {
      return undefined;
    }
    const degrees = this._degrees(links);
    return nodes
      .map((node) => ({
        node,
        score: this._centerScore(node, degrees.get(node.id) || 0),
      }))
      .sort((a, b) => b.score - a.score)[0].node;
  }

  _centerScore(node, degree) {
    const label = String(node.label || "").toLowerCase();
    const role = String(node.role || "").toLowerCase();
    const leaderCost = node.details ? node.details.leader_cost : undefined;
    let score = degree * 10;

    if (leaderCost === 0) {
      score += 2000;
    } else if (typeof leaderCost === "number") {
      score += Math.max(0, 100 - leaderCost * 10);
    }
    if (role.indexOf("routing") !== -1 || role.indexOf("router") !== -1) {
      score += 30;
    }
    if (node.external) {
      score += 8;
    }
    if (
      label.indexOf("border router") !== -1 ||
      label.indexOf("border-router") !== -1 ||
      label.indexOf("openthread") !== -1 ||
      label.indexOf("open thread") !== -1 ||
      label.indexOf("otbr") !== -1 ||
      label.indexOf("skyconnect") !== -1 ||
      label.indexOf("home assistant yellow") !== -1
    ) {
      score += 1000;
    }
    return score;
  }

  _nodeRadius(node, isCenter) {
    if (isCenter || node.isCenter) {
      return 34;
    }
    if (node.role && node.role.includes("routing")) {
      return 28;
    }
    if (node.external) {
      return 22;
    }
    return 24;
  }

  _linkSvg(link) {
    const color = this._qualityColor(link.quality);
    const width = Math.max(2, Math.min(8, ((link.quality || 35) / 100) * 7));
    const label = link.quality === null || link.quality === undefined ? link.relationship : `${link.relationship} ${link.quality}`;
    return `
      <line class="link" data-link-id="${this._escapeAttr(link.id)}" stroke="${color}" stroke-width="${width}"></line>
      <text class="link-label" data-link-id="${this._escapeAttr(link.id)}">${this._escape(label)}</text>
    `;
  }

  _nodeSvg(node) {
    const selected = node.id === this._selected ? " selected" : "";
    const center = node.isCenter ? " center" : "";
    const pinned = node.pinned && !node.isCenter ? " pinned" : "";
    const fill = node.external ? "#7f8c8d" : node.role.includes("routing") ? "#16a085" : "#3498db";
    const role = node.external ? "external" : this._humanize(node.role);
    return `
      <g class="node${selected}${center}${pinned}" data-node-id="${this._escapeAttr(node.id)}">
        <circle r="${node.radius}" fill="${fill}"></circle>
        <text y="${node.radius + 18}">${this._escape(this._shortLabel(node.label))}</text>
        <text class="role" y="${node.radius + 33}">${this._escape(node.isCenter ? "center " + role : role)}</text>
      </g>
    `;
  }

  _details(node, nodes, links) {
    const connected = this._connectedDevices(node, nodes, links);
    return `
      <section class="detail">
        <h2 class="panel-title">${this._escape(node.label)}</h2>
        <dl>
          <dt>Role</dt><dd>${this._escape(this._humanize(node.role))}</dd>
          <dt>Kind</dt><dd>${this._escape(node.kind)}</dd>
          <dt>Available</dt><dd>${node.available === null || node.available === undefined ? "Unknown" : node.available ? "Yes" : "No"}</dd>
          <dt>Network</dt><dd>${this._escape(node.network_name || "Unknown")}</dd>
          <dt>MAC/EUI</dt><dd>${this._escape(node.mac_address || "Unknown")}</dd>
          <dt>Leader cost</dt><dd>${this._escape(this._leaderCostLabel(node))}</dd>
          <dt>Links</dt><dd>${connected.length}</dd>
        </dl>
        <h3 class="section-title">Connected Thread Devices</h3>
        ${connected.length ? this._connectedList(connected) : '<p class="empty">No connected Thread devices are exposed by diagnostics for this node.</p>'}
      </section>
    `;
  }

  _connectedDevices(node, nodes, links) {
    const byId = new Map(nodes.map((item) => [item.id, item]));
    return links
      .filter((link) => link.source === node.id || link.target === node.id)
      .map((link) => {
        const direction = link.source === node.id ? "to" : "from";
        const peerId = link.source === node.id ? link.target : link.source;
        const peer = byId.get(peerId) || {
          id: peerId,
          label: peerId,
          node_id: null,
          role: "unknown",
          external: true,
        };
        return {
          direction,
          link,
          peer,
          sortLabel: String(peer.label || peer.id).toLowerCase(),
        };
      })
      .sort((a, b) => a.sortLabel.localeCompare(b.sortLabel));
  }

  _leaderCostLabel(node) {
    if (!node.details || node.details.leader_cost === null || node.details.leader_cost === undefined) {
      return "Unknown";
    }
    return String(node.details.leader_cost);
  }

  _connectedList(connected) {
    return `
      <div class="connected-list">
        ${connected.map((item) => this._connectedRow(item)).join("")}
      </div>
    `;
  }

  _connectedRow(item) {
    const peer = item.peer;
    const link = item.link;
    const threadId = peer.node_id === null || peer.node_id === undefined ? peer.id : `Matter node ${peer.node_id}`;
    const quality = link.quality === null || link.quality === undefined ? "Unknown quality" : `${link.quality}% quality`;
    const role = peer.external ? "external" : this._humanize(peer.role);
    const route = `${link.relationship} ${item.direction}`;
    return `
      <button class="connected-node" data-node-id="${this._escapeAttr(peer.id)}" title="Select ${this._escapeAttr(peer.label)}">
        <span class="connected-main">
          <span class="connected-label">${this._escape(peer.label)}</span>
          <span class="connected-id">${this._escape(threadId)}</span>
        </span>
        <span class="connected-meta">
          <span>${this._escape(route)}</span>
          <span>${this._escape(role)}</span>
          <span>${this._escape(quality)}</span>
        </span>
      </button>
    `;
  }

  _qualityColor(quality) {
    if (quality === null || quality === undefined) {
      return "#95a5a6";
    }
    if (quality >= 75) {
      return "#27ae60";
    }
    if (quality >= 45) {
      return "#f1c40f";
    }
    return "#e74c3c";
  }

  _shortLabel(label) {
    if (!label) {
      return "Unknown";
    }
    return label.length > 24 ? `${label.slice(0, 21)}...` : label;
  }

  _humanize(value) {
    return String(value || "").split("_").join(" ");
  }

  _escape(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  _escapeAttr(value) {
    return this._escape(value).replace(/`/g, "&#96;");
  }

  _selectorEscape(value) {
    if (window.CSS && window.CSS.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }
}

if (!customElements.get("matter-map-panel")) {
  customElements.define("matter-map-panel", MatterMapPanel);
}

window.matterThreadMapPanelLoaded = true;
