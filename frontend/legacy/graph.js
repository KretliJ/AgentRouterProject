// ============================================================================
// AgentRouter — Grafo rodoviário v1 (só a visualização; sem custos/recursos)
// ============================================================================
// Nós = cidades escolhidas no design (capitais + polos regionais do corte v1).
// Arestas = trechos de rodovias federais confirmados (PDF BIT/gov.br + fontes).
// As arestas são RETAS geodésicas — não seguem o traçado 1:1 (decisão do
// usuário: "outline básico do país sem preenchimento; arestas podem ser retas").
//
// Fontes:
//  - Mapa "Rodoviário Federal" (BIT/Ministério dos Transportes), 2023:
//    https://www.gov.br/transportes/pt-br/assuntos/dados-de-transportes/bit/mapas/
//  - Contorno do Brasil: Natural Earth (domínio público), ne_110m simplificado.
//
// Este módulo governa APENAS a visualização do grafo — nenhum custo,
// capacidade ou política é calculado aqui (decisão do usuário).

// --- Dados ------------------------------------------------------------------

/** Nós do grafo (ver MODELAGEM.md §3.1). coord = [lon, lat] WGS84. */
const NODES = [
  // Sede do centro logístico
  { id: "BHZ", name: "Belo Horizonte", coord: [-43.938, -19.917], kind: "capital", hub: true },

  // Capitais do corte v1 (Sudeste + DF + Goiás)
  { id: "SAO", name: "São Paulo",          coord: [-46.633, -23.555], kind: "capital" },
  { id: "RIO", name: "Rio de Janeiro",     coord: [-43.209, -22.908], kind: "capital" },
  { id: "VIT", name: "Vitória",            coord: [-40.338, -20.316], kind: "capital" },
  { id: "BSB", name: "Brasília",           coord: [-47.930, -15.780], kind: "capital" },
  { id: "GYN", name: "Goiânia",            coord: [-49.254, -16.686], kind: "capital" },

  // Polos regionais de Minas Gerais
  { id: "UDI", name: "Uberlândia",           coord: [-48.274, -18.919], kind: "regional" },
  { id: "UBA", name: "Uberaba",              coord: [-47.932, -19.749], kind: "regional" },
  { id: "PTL", name: "Patos de Minas",       coord: [-46.517, -18.582], kind: "regional" },
  { id: "MOC", name: "Montes Claros",        coord: [-43.875, -16.737], kind: "regional" },
  { id: "PMC", name: "Pirapora",             coord: [-44.941, -17.347], kind: "regional" },
  { id: "GVL", name: "Governador Valadares", coord: [-41.887, -18.851], kind: "regional" },
  { id: "TEO", name: "Teófilo Otoni",        coord: [-41.506, -17.858], kind: "regional" },
  { id: "IPS", name: "Ipatinga",             coord: [-42.540, -19.469], kind: "regional" },
  { id: "JDF", name: "Juiz de Fora",         coord: [-43.350, -21.764], kind: "regional" },
  { id: "DIV", name: "Divinópolis",          coord: [-44.884, -20.139], kind: "regional" },
  { id: "VRG", name: "Varginha",             coord: [-45.443, -21.551], kind: "regional" },

  // Polos do interior de SP
  { id: "RPT", name: "Ribeirão Preto",      coord: [-47.822, -21.178], kind: "regional" },
  { id: "SJK", name: "São José dos Campos", coord: [-45.958, -23.189], kind: "regional" },
];

/** Arestas retas entre nós adjacentes, agrupadas por rodovia. */
const EDGES = [
  // BR-040 — Rio ⇄ BH ⇄ Brasília (eixo central)
  { id: "BR040:RIO-BHZ", br: "BR-040", a: "RIO", b: "BHZ" },
  { id: "BR040:BHZ-BSB", br: "BR-040", a: "BHZ", b: "BSB" },

  // BR-050 — Brasília ⇄ Uberlândia ⇄ Uberaba ⇄ Ribeirão Preto ⇄ SP
  { id: "BR050:BSB-UDI", br: "BR-050", a: "BSB", b: "UDI" },
  { id: "BR050:UDI-UBA", br: "BR-050", a: "UDI", b: "UBA" },
  { id: "BR050:UBA-RPT", br: "BR-050", a: "UBA", b: "RPT" },
  { id: "BR050:RPT-SAO", br: "BR-050", a: "RPT", b: "SAO" },

  // BR-116 — RJ ⇄ JDF ⇄ GVL ⇄ TEO (rumo NE); BH ⇄ RJ pelo Rio-Minas (116/040)
  { id: "BR116:BHZ-RIO", br: "BR-116", a: "BHZ", b: "RIO" },
  { id: "BR116:RIO-JDF", br: "BR-116", a: "RIO", b: "JDF" },
  { id: "BR116:JDF-GVL", br: "BR-116", a: "JDF", b: "GVL" },
  { id: "BR116:GVL-TEO", br: "BR-116", a: "GVL", b: "TEO" },

  // BR-262 — Vitória ⇄ GVL ⇄ Ipatinga ⇄ BH ⇄ Divinópolis ⇄ Uberaba ⇄ UDI
  { id: "BR262:VIT-GVL", br: "BR-262", a: "VIT", b: "GVL" },
  { id: "BR262:GVL-IPS", br: "BR-262", a: "GVL", b: "IPS" },
  { id: "BR262:IPS-BHZ", br: "BR-262", a: "IPS", b: "BHZ" },
  { id: "BR262:BHZ-DIV", br: "BR-262", a: "BHZ", b: "DIV" },
  { id: "BR262:DIV-UBA", br: "BR-262", a: "DIV", b: "UBA" },
  { id: "BR262:UBA-UDI", br: "BR-262", a: "UBA", b: "UDI" },

  // BR-381 — Fernão Dias BH ⇄ SJK ⇄ SP; e BH ⇄ Ipatinga ⇄ GVL (Vale do Aço)
  { id: "BR381:BHZ-SJK", br: "BR-381", a: "BHZ", b: "SJK" },
  { id: "BR381:SJK-SAO", br: "BR-381", a: "SJK", b: "SAO" },
  { id: "BR381:BHZ-IPS", br: "BR-381", a: "BHZ", b: "IPS" },
  { id: "BR381:IPS-GVL", br: "BR-381", a: "IPS", b: "GVL" },

  // BR-365 — UDI ⇄ PTL ⇄ PMC ⇄ MOC
  { id: "BR365:UDI-PTL", br: "BR-365", a: "UDI", b: "PTL" },
  { id: "BR365:PTL-PMC", br: "BR-365", a: "PTL", b: "PMC" },
  { id: "BR365:PMC-MOC", br: "BR-365", a: "PMC", b: "MOC" },

  // BR-367 — TEO ⇄ VIT (simplificação do litoral NE–ES)
  { id: "BR367:TEO-VIT", br: "BR-367", a: "TEO", b: "VIT" },

  // BR-267 — JDF ⇄ Varginha ⇄ interior de SP
  { id: "BR267:JDF-VRG", br: "BR-267", a: "JDF", b: "VRG" },
  { id: "BR267:VRG-RPT", br: "BR-267", a: "VRG", b: "RPT" },

  // BR-491/369 (simplificado) — sul de MG ⇄ Vale do Paraíba
  { id: "BR491:VRG-SJK", br: "BR-491", a: "VRG", b: "SJK" },

  // BR-153/060 (simplificado) — BSB ⇄ Goiânia
  { id: "BR153:BSB-GYN", br: "BR-153", a: "BSB", b: "GYN" },
];

// --- Projeção equiretangular ------------------------------------------------

/** Moldura geográfica fixa cobrindo o Brasil + margem:
 *  lon [-75,-33] × lat [-35,7] (42° × 42°). [lon,lat] → [0,W]×[0,H] px. */
const EQUIRECT = {
  LON0: -75, LAT1: 7, DLON: 42, DLAT: 42,
  project([lon, lat], W, H) {
    return [
      ((lon - EQUIRECT.LON0) / EQUIRECT.DLON) * W,
      ((EQUIRECT.LAT1 - lat) / EQUIRECT.DLAT) * H,
    ];
  },
  unproject(x, y, W, H) {
    return [
      EQUIRECT.LON0 + (x / W) * EQUIRECT.DLON,
      EQUIRECT.LAT1 - (y / H) * EQUIRECT.DLAT,
    ];
  },
};

// --- Geometria auxiliar -----------------------------------------------------

const GEO = {
  /** Distância grande-círculo em km (métrica futura; não usada nesta fase). */
  haversine([lon1, lat1], [lon2, lat2]) {
    const R = 6371, rad = Math.PI / 180;
    const h =
      Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },
  midpoint(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  },
};

// --- Estilos (variáveis de tema do app; fallback p/ standalone) -------------

const STYLES = {
  outline:  { stroke: "var(--border, #888)", width: 1.2 },
  edge:     { stroke: "var(--accent, #4a9eff)", width: 1.4, opacity: 0.75 },
  nodeCap:  { fill: "var(--foreground, #eee)", r: 4 },
  nodeReg:  { fill: "var(--muted-foreground, #999)", r: 3 },
  hub:      { fill: "var(--accent, #4a9eff)", r: 6 },
  labelCap: { size: 11, weight: 600 },
  labelReg: { size: 10, weight: 400 },
};

const SVG_NS = "http://www.w3.org/2000/svg";
const NS = (tag) => document.createElementNS(SVG_NS, tag);

/**
 * Renderiza o grafo rodoviário dentro de `container`.
 * @returns {{svg: SVGElement, edgeEls: Map<string,SVGElement>, project: Function,
 *            byId: Object, W: number, H: number}}
 */
function renderGraph(container, { nodes = NODES, edges = EDGES, projection = EQUIRECT } = {}) {
  if (!container) throw new Error("container ausente");
  const W = Math.max(320, container.clientWidth || 960);
  const H = W; // moldura quadrada: 42° lon × 42° lat
  const P = (c) => projection.project(c, W, H);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  container.innerHTML = "";
  const svg = NS("svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Grafo rodoviário AgentRouter v1");
  container.appendChild(svg);

  // Grupo "world" — todo o conteúdo vive aqui; zoom/pan = transform neste grupo.
  const world = NS("g");
  svg.appendChild(world);

  // 1) Contorno do Brasil — linha, sem preenchimento (decisão do usuário)
  const outlinePath = NS("path");
  outlinePath.setAttribute("fill", "none");
  outlinePath.setAttribute("stroke", STYLES.outline.stroke);
  outlinePath.setAttribute("stroke-width", STYLES.outline.width);
  outlinePath.setAttribute("stroke-linejoin", "round");
  world.appendChild(outlinePath);
  if (typeof BRAZIL_OUTLINE !== "undefined") {
    const d =
      BRAZIL_OUTLINE.map((c, i) => {
        const [x, y] = P(c);
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join(" ") + " Z";
    outlinePath.setAttribute("d", d);
  } else {
    console.warn("brazil_outline.js não carregado — mapa ficará sem contorno.");
  }

  // 2) Arestas — retas entre nós adjacentes
  const edgeEls = new Map();
  for (const e of edges) {
    const A = byId[e.a];
    const B = byId[e.b];
    if (!A || !B) {
      console.warn("aresta com nó inexistente:", e.id);
      continue;
    }
    const [x1, y1] = P(A.coord);
    const [x2, y2] = P(B.coord);
    const line = NS("line");
    line.setAttribute("x1", x1.toFixed(1));
    line.setAttribute("y1", y1.toFixed(1));
    line.setAttribute("x2", x2.toFixed(1));
    line.setAttribute("y2", y2.toFixed(1));
    line.setAttribute("stroke", STYLES.edge.stroke);
    line.setAttribute("stroke-width", STYLES.edge.width);
    line.setAttribute("stroke-opacity", STYLES.edge.opacity);
    line.dataset.edgeId = e.id;
    world.appendChild(line);
    edgeEls.set(e.id, line);
  }

  // 2.b) Rótulos das BRs — um por cadeia, ancorado na aresta central
  const chains = new Map();
  for (const e of edges) {
    if (!chains.has(e.br)) chains.set(e.br, []);
    chains.get(e.br).push(e);
  }
  for (const [br, list] of chains) {
    const mid = list[Math.floor(list.length / 2)];
    const A = byId[mid.a];
    const B = byId[mid.b];
    if (!A || !B) continue;
    const [mx, my] = P(GEO.midpoint(A.coord, B.coord));
    const t = NS("text");
    t.textContent = br;
    t.setAttribute("x", (mx + 6).toFixed(1));
    t.setAttribute("y", (my - 5).toFixed(1));
    t.setAttribute("font-size", "10");
    t.setAttribute("fill", "var(--muted-foreground, #999)");
    t.setAttribute("class", "br-label");
    world.appendChild(t);
  }

  // 3) Nós + rótulos
  for (const n of nodes) {
    const [x, y] = P(n.coord);
    const st = n.hub ? STYLES.hub : n.kind === "capital" ? STYLES.nodeCap : STYLES.nodeReg;

    const dot = NS("circle");
    dot.setAttribute("cx", x.toFixed(1));
    dot.setAttribute("cy", y.toFixed(1));
    dot.setAttribute("r", st.r);
    dot.setAttribute("fill", st.fill);
    if (n.hub) {
      dot.setAttribute("stroke", "var(--foreground, #eee)");
      dot.setAttribute("stroke-width", "1.5");
    }
    dot.dataset.nodeId = n.id;
    dot.classList.add("node");
    world.appendChild(dot);

    const label = NS("text");
    label.textContent = n.name;
    label.setAttribute("x", (x + st.r + 4).toFixed(1));
    label.setAttribute("y", (y + 4).toFixed(1));
    label.setAttribute("font-size", String(st === STYLES.nodeCap ? STYLES.labelCap.size : STYLES.labelReg.size));
    label.setAttribute("font-weight", String(st === STYLES.nodeCap ? STYLES.labelCap.weight : STYLES.labelReg.weight));
    label.setAttribute("fill", "var(--foreground, #eee)");
    label.classList.add("node-label");
    world.appendChild(label);
  }

  // 4) Zoom & pan (roda = zoom no cursor; arrastar = pan; duplo clique = reset)
  const view = { k: 1, x: 0, y: 0 };
  const MIN_K = 1, MAX_K = 12;
  const listeners = { zoom: [] };

  function apply() {
    world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    // Contra-escala em rótulos/traços p/ manter legibilidade no zoom-out… e
    // leve crescimento no zoom-in sem dominar a tela.
    const inv = 1 / Math.sqrt(view.k);
    svg.querySelectorAll(".node-label, .br-label").forEach((t) => {
      const base = parseFloat(t.dataset.baseSize || (t.dataset.baseSize = t.getAttribute("font-size")));
      t.setAttribute("font-size", (base * Math.max(0.55, Math.min(1.6, inv * view.k ** 0.25))).toFixed(2));
    });
    svg.querySelectorAll("circle.node").forEach((c) => {
      const base = parseFloat(c.dataset.baseR || (c.dataset.baseR = c.getAttribute("r")));
      c.setAttribute("r", (base * Math.max(0.7, Math.min(2.2, inv * view.k ** 0.3))).toFixed(2));
    });
    for (const fn of listeners.zoom) fn(view);
  }
  apply();

  const toSvg = (ev) => {
    // converte client → coords do viewBox via CTM (robusto a letterbox/aspect)
    const inv = svg.getScreenCTM().inverse();
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(inv);
    return [p.x, p.y];
  };
  const zoomAt = (factor, [sx, sy]) => {
    const k2 = Math.max(MIN_K, Math.min(MAX_K, view.k * factor));
    const s = k2 / view.k;
    view.x = sx - s * (sx - view.x);
    view.y = sy - s * (sy - view.y);
    view.k = k2;
    if (view.k === 1) { view.x = 0; view.y = 0; }
    apply();
  };
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, toSvg(ev));
  }, { passive: false });

  let drag = null;
  svg.addEventListener("pointerdown", (ev) => {
    drag = { id: ev.pointerId, px: ev.clientX, py: ev.clientY, moved: false };
    try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* ponteiro sintético */ }
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const r = svg.getBoundingClientRect();
    const a = W / r.width, b = H / r.height;
    const s = Math.max(a, b);             // o mapa é escalado pelo fator MAIOR (letterbox)
    const dx = (ev.clientX - drag.px) * s;
    const dy = (ev.clientY - drag.py) * s;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    view.x += dx; view.y += dy;
    drag.px = ev.clientX; drag.py = ev.clientY;
    apply();
  });
  svg.addEventListener("pointerup", (ev) => {
    if (drag && !drag.moved) {
      // clique simples sem arrasto → resolve o nó mais próximo (coords. do mundo)
      const [sx, sy] = toSvg(ev);
      const wx = (sx - view.x) / view.k;
      const wy = (sy - view.y) / view.k;
      let nodeId = null;
      let bestD = 14 / Math.sqrt(view.k) + 3; // tolerância em unidades do mundo
      for (const n of nodes) {
        const [nx, ny] = P(n.coord);
        const d = Math.hypot(nx - wx, ny - wy);
        if (d < bestD) { bestD = d; nodeId = n.id; }
      }
      svg.dispatchEvent(new CustomEvent("graphclick", { detail: { x: sx, y: sy, nodeId } }));
    }
    drag = null;
  });
  svg.addEventListener("dblclick", () => { view.k = 1; view.x = 0; view.y = 0; apply(); });

  return {
    svg, world, edgeEls, project: P, byId, W, H,
    getView: () => ({ ...view }),
    resetView: () => { view.k = 1; view.x = 0; view.y = 0; apply(); },
    onZoom: (fn) => listeners.zoom.push(fn),
  };
}

// Global p/ <script> simples — módulo ES quebraria file:// em alguns browsers.
if (typeof window !== "undefined") {
  window.AgentRouterGraph = { renderGraph, NODES, EDGES, EQUIRECT, GEO, STYLES };
  /** ids válidos do grafo (usado por data.js p/ sortear origens/destinos). */
  window.AgentRouterGraphNodes = () => NODES.map((n) => n.id);
}
