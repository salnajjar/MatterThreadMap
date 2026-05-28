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
    this._positions = new Map();
    this._animationFrame = undefined;
    this._dragging = undefined;
    this._panning = undefined;
    this._view = { x: 0, y: 0, scale: 1 };
    this._activeGraph = undefined;
    this._dragMoveHandler = undefined;
    this._dragEndHandler = undefined;
    this._pinned = new Set();
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
    this._render();
    this._loadTopology();
    this._timer = window.setInterval(() => this._loadTopology(true), 30000);
  }

  disconnectedCallback() {
    if (this._timer) {
      window.clearInterval(this._timer);
      this._timer = undefined;
    }
    if (this._animationFrame) {
      window.cancelAnimationFrame(this._animationFrame);
      this._animationFrame = undefined;
    }
    if (this._dragMoveHandler) {
      window.removeEventListener("pointermove", this._dragMoveHandler);
      this._dragMoveHandler = undefined;
    }
  }

  async _loadTopology(quiet = false) {
    if (!this._hass) {
      this._loading = false;
      this._render();
      return;
    }
    if (!quiet) {
      this._loading = true;
      this._error = "";
      this._render();
    }
    try {
      this._topology = await this._hass.callWS({ type: "matter_map/get_topology" });
      this._error = "";
    } catch (err) {
      this._error = err && err.message ? err.message : "Unable to load topology";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _render() {
    const topology = this._topology || { nodes: [], links: [], summary: {} };
    const graph = this._layoutGraph(topology.nodes, topology.links);
    const selected = topology.nodes.find((node) => node.id === this._selected);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100vh;
          height: 100dvh;
          overflow: hidden;
          min-height: 100vh;
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
          grid-template-columns: minmax(0, 1fr) 320px;
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
        }
        svg.panning {
          cursor: grabbing;
        }
        .viewport {
          transform-origin: 0 0;
        }
        .link {
          stroke-linecap: round;
          opacity: 0.88;
        }
        .link-label {
          fill: var(--secondary-text-color);
          font-size: 11px;
          pointer-events: none;
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
        .node {
          cursor: pointer;
          touch-action: none;
        }
        .node.selected circle {
          stroke: var(--accent-color);
        }
        .node.center circle {
          stroke: var(--warning-color, #f39c12);
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
          grid-template-columns: 110px minmax(0, 1fr);
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
          max-width: min(520px, calc(100% - 36px));
          padding: 12px 14px;
          border-radius: 6px;
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.16));
        }
        .map-controls {
          position: absolute;
          right: 18px;
          top: 18px;
          display: flex;
          gap: 8px;
          z-index: 1;
        }
        .map-controls button {
          width: 36px;
          min-width: 36px;
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
            <svg viewBox="0 0 ${graph.width} ${graph.height}" role="img" aria-label="Matter Thread network graph">
              <g class="viewport">
                ${graph.links.map((link) => this._linkSvg(link)).join("")}
                ${graph.nodes.map((node) => this._nodeSvg(node)).join("")}
              </g>
            </svg>
          </section>
          <aside>
            <div class="metric-grid">
              <div class="metric"><strong>${topology.summary.matter_thread_nodes || 0}</strong><span>Matter devices</span></div>
              <div class="metric"><strong>${topology.summary.external_thread_nodes || 0}</strong><span>External nodes</span></div>
              <div class="metric"><strong>${topology.summary.links || 0}</strong><span>Links</span></div>
              <div class="metric"><strong>${topology.summary.partial_errors || 0}</strong><span>Read errors</span></div>
            </div>
            ${selected ? this._details(selected, topology.nodes, topology.links) : '<p class="empty">Select a node to inspect its role and links.</p>'}
          </aside>
        </main>
      </div>
    `;

    const refreshButton = this.shadowRoot.getElementById("refresh");
    if (refreshButton) {
      refreshButton.addEventListener("click", () => this._loadTopology());
    }
    const zoomIn = this.shadowRoot.getElementById("zoom-in");
    const zoomOut = this.shadowRoot.getElementById("zoom-out");
    const zoomReset = this.shadowRoot.getElementById("zoom-reset");
    if (zoomIn) {
      zoomIn.addEventListener("click", () => this._zoomBy(1.2));
    }
    if (zoomOut) {
      zoomOut.addEventListener("click", () => this._zoomBy(1 / 1.2));
    }
    if (zoomReset) {
      zoomReset.addEventListener("click", () => this._resetView());
    }
    this.shadowRoot.querySelectorAll(".node").forEach((node) => {
      node.addEventListener("click", () => {
        this._selected = node.getAttribute("data-node-id");
        this._render();
      });
      node.addEventListener("pointerdown", (event) => this._startDrag(event, node));
    });
    this.shadowRoot.querySelectorAll(".connected-node").forEach((node) => {
      node.addEventListener("click", () => {
        this._selected = node.getAttribute("data-node-id");
        this._render();
      });
    });
    this._bindGraphPointerEvents(graph);
    this._applyViewTransform();
    this._startSimulation(graph);
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

  _layoutGraph(nodes, links) {
    const width = 1120;
    const height = 720;
    const centerX = width / 2;
    const centerY = height / 2;
    const centerNode = this._chooseCenterNode(nodes, links);
    const centerId = centerNode ? centerNode.id : undefined;
    const directIds = new Set();
    links.forEach((link) => {
      if (link.source === centerId) {
        directIds.add(link.target);
      }
      if (link.target === centerId) {
        directIds.add(link.source);
      }
    });

    const direct = nodes.filter((node) => node.id !== centerId && directIds.has(node.id));
    const indirect = nodes.filter((node) => node.id !== centerId && !directIds.has(node.id));
    const ordered = [
      ...direct.filter((node) => node.role.includes("routing") || node.external),
      ...direct.filter((node) => !node.role.includes("routing") && !node.external),
      ...indirect.filter((node) => node.role.includes("routing") || node.external),
      ...indirect.filter((node) => !node.role.includes("routing") && !node.external),
    ];
    const baseRadius = Math.min(width, height) * 0.3;
    const graphNodes = [];

    if (centerNode) {
      const position = this._positionFor(centerNode, centerX, centerY, true);
      graphNodes.push({
        ...centerNode,
        x: position.x,
        y: position.y,
        vx: position.vx,
        vy: position.vy,
        pinned: true,
        isCenter: true,
      });
    }

    ordered.forEach((node, index) => {
      const angle = ordered.length ? (Math.PI * 2 * index) / ordered.length - Math.PI / 2 : 0;
      const ring = directIds.has(node.id) ? baseRadius : baseRadius * 1.38;
      const stagger = index % 2 === 0 ? 0 : 18;
      const fallbackX = centerX + Math.cos(angle) * (ring + stagger);
      const fallbackY = centerY + Math.sin(angle) * (ring + stagger);
      const position = this._positionFor(node, fallbackX, fallbackY, false);
      graphNodes.push({
        ...node,
        x: position.x,
        y: position.y,
        vx: position.vx,
        vy: position.vy,
        pinned: this._pinned.has(node.id),
        isCenter: false,
      });
    });

    const byId = new Map(graphNodes.map((node) => [node.id, node]));
    const graphLinks = links
      .map((link) => ({ ...link, sourceNode: byId.get(link.source), targetNode: byId.get(link.target) }))
      .filter((link) => link.sourceNode && link.targetNode);
    this._separateInitialOverlaps(graphNodes, width, height);
    return { width, height, nodes: graphNodes, links: graphLinks };
  }

  _separateInitialOverlaps(nodes, width, height) {
    const padding = 56;
    for (let pass = 0; pass < 16; pass += 1) {
      let moved = false;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x || 0.01;
          const dy = b.y - a.y || 0.01;
          const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const minDistance = this._nodeRadius(a) + this._nodeRadius(b) + 38;
          if (distance >= minDistance) {
            continue;
          }
          const overlap = (minDistance - distance) / 2;
          const pushX = (dx / distance) * overlap;
          const pushY = (dy / distance) * overlap;
          if (!this._isFixedNode(a)) {
            a.x = Math.max(padding, Math.min(width - padding, a.x - pushX));
            a.y = Math.max(padding, Math.min(height - padding, a.y - pushY));
            moved = true;
          }
          if (!this._isFixedNode(b)) {
            b.x = Math.max(padding, Math.min(width - padding, b.x + pushX));
            b.y = Math.max(padding, Math.min(height - padding, b.y + pushY));
            moved = true;
          }
        }
      }
      if (!moved) {
        break;
      }
    }
    nodes.forEach((node) => {
      const position = this._positions.get(node.id);
      if (position) {
        position.x = node.x;
        position.y = node.y;
        position.vx = node.vx || 0;
        position.vy = node.vy || 0;
      }
    });
  }

  _positionFor(node, fallbackX, fallbackY, isCenter) {
    let position = this._positions.get(node.id);
    if (!position) {
      position = {
        x: fallbackX,
        y: fallbackY,
        vx: 0,
        vy: 0,
      };
      this._positions.set(node.id, position);
    }
    if (isCenter) {
      position.x = fallbackX;
      position.y = fallbackY;
      position.vx = 0;
      position.vy = 0;
    }
    return position;
  }

  _startSimulation(graph) {
    if (this._animationFrame) {
      window.cancelAnimationFrame(this._animationFrame);
      this._animationFrame = undefined;
    }
    if (!graph.nodes.length) {
      return;
    }

    const nodes = graph.nodes.map((node) => ({ ...node }));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const links = graph.links
      .map((link) => ({
        ...link,
        sourceNode: nodeMap.get(link.source),
        targetNode: nodeMap.get(link.target),
      }))
      .filter((link) => link.sourceNode && link.targetNode);
    let energy = 1.15;
    let frame = 0;

    const tick = () => {
      this._simulateForces(nodes, links, graph.width, graph.height, energy);
      this._syncGraphDom(nodes, links);
      frame += 1;
      energy *= 0.985;
      if (frame < 1200 && energy > 0.006) {
        this._animationFrame = window.requestAnimationFrame(tick);
      } else {
        this._animationFrame = undefined;
      }
    };

    this._animationFrame = window.requestAnimationFrame(tick);
  }

  _simulateForces(nodes, links, width, height, energy) {
    const centerX = width / 2;
    const centerY = height / 2;
    const padding = 56;

    links.forEach((link) => {
      const source = link.sourceNode;
      const target = link.targetNode;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const desired = source.isCenter || target.isCenter ? 210 : 165;
      const strength = 0.009 * energy;
      const pull = (distance - desired) * strength;
      const fx = (dx / distance) * pull;
      const fy = (dy / distance) * pull;
      if (!this._isFixedNode(source)) {
        source.vx += fx;
        source.vy += fy;
      }
      if (!this._isFixedNode(target)) {
        target.vx -= fx;
        target.vy -= fy;
      }
    });

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const minDistance = this._nodeRadius(a) + this._nodeRadius(b) + 34;
        if (distance < minDistance) {
          const push = ((minDistance - distance) / distance) * 0.18 * energy;
          const fx = dx * push;
          const fy = dy * push;
          this._applyNodeForce(a, -fx, -fy);
          this._applyNodeForce(b, fx, fy);
        } else {
          const distanceSq = Math.max(1800, distance * distance);
          const force = (1200 / distanceSq) * energy;
          const fx = dx * force;
          const fy = dy * force;
          this._applyNodeForce(a, -fx, -fy);
          this._applyNodeForce(b, fx, fy);
        }
      }
    }

    nodes.forEach((node) => {
      if (node.isCenter) {
        node.x = centerX;
        node.y = centerY;
        node.vx = 0;
        node.vy = 0;
        this._positions.set(node.id, { x: node.x, y: node.y, vx: 0, vy: 0 });
        return;
      }
      if (this._isFixedNode(node)) {
        this._positions.set(node.id, {
          x: node.x,
          y: node.y,
          vx: 0,
          vy: 0,
        });
        return;
      }

      node.vx += (centerX - node.x) * 0.00018 * energy;
      node.vy += (centerY - node.y) * 0.00018 * energy;
      node.vx *= 0.91;
      node.vy *= 0.91;
      node.x = Math.max(padding, Math.min(width - padding, node.x + node.vx));
      node.y = Math.max(padding, Math.min(height - padding, node.y + node.vy));
      this._positions.set(node.id, {
        x: node.x,
        y: node.y,
        vx: node.vx,
        vy: node.vy,
      });
    });
  }

  _isFixedNode(node) {
    return node.isCenter || node.pinned || this._dragging === node.id;
  }

  _applyNodeForce(node, fx, fy) {
    if (this._isFixedNode(node)) {
      return;
    }
    node.vx += fx;
    node.vy += fy;
  }

  _nodeRadius(node) {
    if (node.isCenter) {
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

  _syncGraphDom(nodes, links) {
    const root = this.shadowRoot;
    nodes.forEach((node) => {
      const element = root.querySelector(`.node[data-node-id="${this._selectorEscape(node.id)}"]`);
      if (element) {
        element.setAttribute("transform", `translate(${node.x}, ${node.y})`);
      }
    });
    links.forEach((link) => {
      const linkId = this._selectorEscape(link.id);
      const line = root.querySelector(`.link[data-link-id="${linkId}"]`);
      const label = root.querySelector(`.link-label[data-link-id="${linkId}"]`);
      if (line) {
        line.setAttribute("x1", link.sourceNode.x);
        line.setAttribute("y1", link.sourceNode.y);
        line.setAttribute("x2", link.targetNode.x);
        line.setAttribute("y2", link.targetNode.y);
      }
      if (label) {
        label.setAttribute("x", (link.sourceNode.x + link.targetNode.x) / 2);
        label.setAttribute("y", (link.sourceNode.y + link.targetNode.y) / 2 - 8);
      }
    });
  }

  _bindGraphPointerEvents(graph) {
    const svg = this.shadowRoot.querySelector("svg");
    if (!svg) {
      return;
    }
    this._activeGraph = graph;
    svg.addEventListener("wheel", (event) => {
      const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const point = this._eventToRawSvgPoint(svg, event);
      this._zoomAt(zoomFactor, point.x, point.y);
      event.preventDefault();
    }, { passive: false });
    svg.addEventListener("pointerdown", (event) => {
      if (event.target.closest && event.target.closest(".node")) {
        return;
      }
      this._panning = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        viewX: this._view.x,
        viewY: this._view.y,
        width: graph.width,
        height: graph.height,
      };
      svg.classList.add("panning");
      if (svg.setPointerCapture) {
        svg.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    });
    svg.addEventListener("pointermove", (event) => {
      if (!this._dragging) {
        if (this._panning) {
          const rect = svg.getBoundingClientRect();
          const scaleX = graph.width / rect.width;
          const scaleY = graph.height / rect.height;
          this._view.x = this._panning.viewX + (event.clientX - this._panning.startX) * scaleX;
          this._view.y = this._panning.viewY + (event.clientY - this._panning.startY) * scaleY;
          this._clampView(graph.width, graph.height);
          this._applyViewTransform();
          event.preventDefault();
        }
        return;
      }
      this._moveDraggedNode(event);
      event.preventDefault();
    });
    svg.addEventListener("pointerup", () => {
      this._stopDrag();
      this._panning = undefined;
      svg.classList.remove("panning");
    });
    svg.addEventListener("pointerleave", () => {
      this._stopDrag();
      this._panning = undefined;
      svg.classList.remove("panning");
    });
  }

  _startDrag(event, nodeElement) {
    this._dragging = nodeElement.getAttribute("data-node-id");
    if (this._animationFrame) {
      window.cancelAnimationFrame(this._animationFrame);
      this._animationFrame = undefined;
    }
    if (nodeElement.setPointerCapture) {
      nodeElement.setPointerCapture(event.pointerId);
    }
    this._moveDraggedNode(event);
    this._dragMoveHandler = (moveEvent) => {
      this._moveDraggedNode(moveEvent);
      moveEvent.preventDefault();
    };
    this._dragEndHandler = () => {
      this._stopDrag();
    };
    window.addEventListener("pointermove", this._dragMoveHandler, { passive: false });
    window.addEventListener("pointerup", this._dragEndHandler, { once: true });
    event.preventDefault();
  }

  _stopDrag() {
    if (!this._dragging) {
      return;
    }
    const draggedId = this._dragging;
    this._dragging = undefined;
    this._pinned.add(draggedId);
    if (this._dragMoveHandler) {
      window.removeEventListener("pointermove", this._dragMoveHandler);
      this._dragMoveHandler = undefined;
    }
    this._dragEndHandler = undefined;
    if (this._activeGraph) {
      const graphNode = this._activeGraph.nodes.find((node) => node.id === draggedId);
      if (graphNode) {
        graphNode.pinned = true;
      }
      this._startSimulation(this._activeGraph);
    }
  }

  _eventToSvgPoint(svg, event) {
    const raw = this._eventToRawSvgPoint(svg, event);
    return {
      x: (raw.x - this._view.x) / this._view.scale,
      y: (raw.y - this._view.y) / this._view.scale,
    };
  }

  _eventToRawSvgPoint(svg, event) {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const rawX = ((event.clientX - rect.left) / rect.width) * viewBox.width + viewBox.x;
    const rawY = ((event.clientY - rect.top) / rect.height) * viewBox.height + viewBox.y;
    return {
      x: rawX,
      y: rawY,
    };
  }

  _moveDraggedNode(event) {
    if (!this._dragging || !this._activeGraph) {
      return;
    }
    const svg = this.shadowRoot.querySelector("svg");
    if (!svg) {
      return;
    }
    const graph = this._activeGraph;
    const point = this._eventToSvgPoint(svg, event);
    const x = Math.max(48, Math.min(graph.width - 48, point.x));
    const y = Math.max(48, Math.min(graph.height - 48, point.y));
    const position = this._positions.get(this._dragging);
    if (position) {
      position.x = x;
      position.y = y;
      position.vx = 0;
      position.vy = 0;
    }
    const graphNode = graph.nodes.find((node) => node.id === this._dragging);
    if (graphNode) {
      graphNode.x = x;
      graphNode.y = y;
      graphNode.vx = 0;
      graphNode.vy = 0;
      graphNode.pinned = true;
      this._syncGraphDom(graph.nodes, graph.links);
    }
  }

  _zoomBy(factor) {
    const svg = this.shadowRoot.querySelector("svg");
    if (!svg) {
      return;
    }
    const viewBox = svg.viewBox.baseVal;
    this._zoomAt(factor, viewBox.width / 2, viewBox.height / 2);
  }

  _zoomAt(factor, rawX, rawY) {
    const oldScale = this._view.scale;
    const newScale = Math.max(0.35, Math.min(4, oldScale * factor));
    const graphX = (rawX - this._view.x) / oldScale;
    const graphY = (rawY - this._view.y) / oldScale;
    this._view.scale = newScale;
    this._view.x = rawX - graphX * newScale;
    this._view.y = rawY - graphY * newScale;
    this._clampView(1120, 720);
    this._applyViewTransform();
  }

  _resetView() {
    this._view = { x: 0, y: 0, scale: 1 };
    this._applyViewTransform();
  }

  _clampView(width, height) {
    const minScale = 0.35;
    this._view.scale = Math.max(minScale, Math.min(4, this._view.scale));
    const marginX = width * this._view.scale;
    const marginY = height * this._view.scale;
    this._view.x = Math.max(-marginX, Math.min(width, this._view.x));
    this._view.y = Math.max(-marginY, Math.min(height, this._view.y));
  }

  _applyViewTransform() {
    const viewport = this.shadowRoot.querySelector(".viewport");
    if (viewport) {
      viewport.setAttribute(
        "transform",
        `translate(${this._view.x}, ${this._view.y}) scale(${this._view.scale})`
      );
    }
  }

  _chooseCenterNode(nodes, links) {
    if (!nodes.length) {
      return undefined;
    }

    const degrees = new Map();
    links.forEach((link) => {
      degrees.set(link.source, (degrees.get(link.source) || 0) + 1);
      degrees.set(link.target, (degrees.get(link.target) || 0) + 1);
    });

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

  _linkSvg(link) {
    const color = this._qualityColor(link.quality);
    const width = Math.max(2, Math.min(8, ((link.quality || 35) / 100) * 7));
    const label = link.quality === null || link.quality === undefined ? link.relationship : `${link.relationship} ${link.quality}`;
    const midX = (link.sourceNode.x + link.targetNode.x) / 2;
    const midY = (link.sourceNode.y + link.targetNode.y) / 2;
    return `
      <line class="link" data-link-id="${this._escapeAttr(link.id)}" x1="${link.sourceNode.x}" y1="${link.sourceNode.y}" x2="${link.targetNode.x}" y2="${link.targetNode.y}" stroke="${color}" stroke-width="${width}"></line>
      <text class="link-label" data-link-id="${this._escapeAttr(link.id)}" x="${midX}" y="${midY - 8}">${this._escape(label)}</text>
    `;
  }

  _nodeSvg(node) {
    const selected = node.id === this._selected ? " selected" : "";
    const center = node.isCenter ? " center" : "";
    const fill = node.external ? "#7f8c8d" : node.role.includes("routing") ? "#16a085" : "#3498db";
    const radius = node.isCenter ? 34 : node.role.includes("routing") ? 28 : node.external ? 22 : 24;
    const role = node.external ? "external" : this._humanize(node.role);
    return `
      <g class="node${selected}${center}" data-node-id="${this._escapeAttr(node.id)}" transform="translate(${node.x}, ${node.y})">
        <circle r="${radius}" fill="${fill}"></circle>
        <text y="${radius + 18}">${this._escape(this._shortLabel(node.label))}</text>
        <text class="role" y="${radius + 33}">${this._escape(node.isCenter ? "center " + role : role)}</text>
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

  _linkSummary(links, nodeId) {
    return links
      .slice(0, 6)
      .map((link) => {
        const direction = link.source === nodeId ? "to" : "from";
        const other = link.source === nodeId ? link.target : link.source;
        const quality = link.quality === null || link.quality === undefined ? "unknown quality" : `${link.quality}% quality`;
        return `${link.relationship} ${direction} ${other} (${quality})`;
      })
      .join("; ");
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
