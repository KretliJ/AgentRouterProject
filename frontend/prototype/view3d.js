// ============================================================================
// AgentRouter — Renderer 3D do mapa (Three.js r128, local)
// ============================================================================
// Substitui o desenho SVG do grafo mantendo os MESMOS dados (NODES/EDGES,
// projeção equiretangular do graph.js) e o MESMO estado do sim.js.
//
// Decisões:
//  - Corpo do caminhão = wireframe do caminhao.glb (frente +X, chão Y=0),
//    extruído via LineSegments — cor segue a MESMA lógica dos triângulos SVG.
//  - Câmera órbita: botão ESQUERDO = orbitar; botão do MEIO/SHIFT+esq = pan;
//    roda = zoom. Duplo clique = reenquadrar.
//  - Hit-test de nó: clique curto (sem arrasto) resolve o nó mais próximo.
//
// Coordenadas do mundo: x = leste (+lon), z = sul (+lat) — "flat map".
// Escala: 1 grau = 100 unidades.

(function () {
  "use strict";

  const G = window.AgentRouterGraph;
  const SVG_NS = "http://www.w3.org/2000/svg";

  /** Mesma matemática do graph.js, agora para o plano XZ. */
  const P = (coord, W, H) => G.EQUIRECT.project(coord, W, H); // [px, px] 0..W/H
  const toWorld = (px, py, W, H) => {
    // centraliza o plano na origem: mundo X = px - W/2, Z = py - H/2
    return [px - W / 2, py - H / 2];
  };

  const COLORS = {
    bg: 0x101016,
    outline: 0xc9d1e0,
    edge: 0x4a9eff,
    nodeCap: 0xeeeeee,
    nodeReg: 0x999999,
    hub: 0x4a9eff,
    label: "#eee",
    labelDim: "#999",
    // estados de caminhão — MESMOS das cores dos triângulos SVG
    truckViajando: 0x4a9eff,
    truckManuseio: 0xffd24d,
    truckDescanso: 0xb48cff,
    truckOcioso: 0x999999,
    incComum: 0xff9d4d,
    incGrave: 0xff4d4d,
    rotaAtiva: 0x7cfc00,
    rotaFantasma: 0xff7ad9,
  };

  // ====================================================================
  // CALIBRAÇÃO DA ROTAÇÃO DO CAMINHÃO — ajuste aqui (graus)
  // A rotação final é: -heading_do_sim + ROT_FIX_GRAUS
  //   195 = valor anterior. Você também pode ajustar AO VIVO pelo slider
  //   dentro do painel Legenda; o valor escolhido ali vale só para a sessão.
  // ====================================================================
  const ROT_FIX_GRAUS = 95;
  const ROT_FIX = ROT_FIX_GRAUS * Math.PI / 180;

  function init(container, { onClickNode } = {}) {
    const W = window.AgentRouterGraph ? 42 : 42; // graus (moldura fixa)
    const DEG = 100;                              // 1° = 100 unidades
    const WORLD_W = 42 * DEG, WORLD_H = 42 * DEG;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1, 20000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // --- luzes (wireframe não usa, mas os modelos GLB usarão no futuro) -----
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(300, 600, 200);
    scene.add(dir);

    // --- grupo raiz do "mundo" (pan/rotate atuam na câmera, não aqui) -------
    const world = new THREE.Group();
    scene.add(world);

    // --- grade de chão: vende a perspectiva (linhas convergem) ---------------
    const gridMat = new THREE.LineBasicMaterial({ color: 0x2a2f3a, transparent: true, opacity: 0.55 });
    const gridGroup = new THREE.Group();
    for (let gx = -2100; gx <= 2100; gx += 300) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(gx, -1, -2100), new THREE.Vector3(gx, -1, 4200)]);
      gridGroup.add(new THREE.Line(g, gridMat));
    }
    for (let gz = -2100; gz <= 4200; gz += 300) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-2100, -1, gz), new THREE.Vector3(2100, -1, gz)]);
      gridGroup.add(new THREE.Line(g, gridMat));
    }
    world.add(gridGroup);

    // --- contorno do Brasil -------------------------------------------------
    if (typeof BRAZIL_OUTLINE !== "undefined") {
      const pts = [];
      for (const [lon, lat] of BRAZIL_OUTLINE) {
        const [px, py] = P([lon, lat], WORLD_W, WORLD_H);
        const [x, z] = toWorld(px, py, WORLD_W, WORLD_H);
        pts.push(new THREE.Vector3(x, 0, z));
      }
      pts.push(pts[0].clone());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      world.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COLORS.outline, transparent: true, opacity: 0.9 })));
    }

    // --- arestas ------------------------------------------------------------
    const byId = Object.fromEntries(G.NODES.map((n) => [n.id, n]));
    const nodePos = new Map();
    for (const n of G.NODES) {
      const [px, py] = P(n.coord, WORLD_W, WORLD_H);
      const [x, z] = toWorld(px, py, WORLD_W, WORLD_H);
      nodePos.set(n.id, [x, z]);
    }
    const edgeLines = new Map(); // edgeId -> Line
    const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.75 });
    const edgeGeoCache = new Map();
    for (const e of G.EDGES) {
      const a = nodePos.get(e.a), b = nodePos.get(e.b);
      if (!a || !b) continue;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a[0], 0, a[1]),
        new THREE.Vector3(b[0], 0, b[1]),
      ]);
      const line = new THREE.Line(geo, edgeMat);
      line.userData.edgeId = e.id;
      world.add(line);
      edgeLines.set(e.id, line);
    }

    // --- nós: discos + pino -------------------------------------------------
    const nodeDots = new Map();
    const nodeGeo = new THREE.CylinderGeometry(9, 9, 2, 20);
    for (const n of G.NODES) {
      const [x, z] = nodePos.get(n.id);
      const isHub = n.hub, isCap = n.kind === "capital";
      const mat = new THREE.MeshBasicMaterial({ color: isHub ? COLORS.hub : isCap ? COLORS.nodeCap : COLORS.nodeReg });
      const dot = new THREE.Mesh(nodeGeo, mat);
      dot.position.set(x, 1, z);
      if (isHub) dot.scale.set(1.5, 1.5, 1.5);
      world.add(dot);
      nodeDots.set(n.id, dot);
    }

    // --- rótulos (sprites de canvas — legíveis em qualquer ângulo) ----------
    const labelSprites = [];
    function makeLabel(text, x, z, { size = 42, color = COLORS.label, weight = 400, y = 26, scale = 1 } = {}) {
      const pad = 12;
      const cv = document.createElement("canvas");
      const ctx = cv.getContext("2d");
      const fontPx = 44;
      ctx.font = `${weight} ${fontPx}px system-ui, sans-serif`;
      const w = ctx.measureText(text).width + pad * 2;
      cv.width = Math.ceil(w);
      cv.height = Math.ceil(fontPx * 1.5);
      const ctx2 = cv.getContext("2d");
      ctx2.font = `${weight} ${fontPx}px system-ui, sans-serif`;
      ctx2.lineWidth = 8;
      ctx2.strokeStyle = "rgba(10,12,18,.9)";   // halo escuro p/ contraste
      ctx2.strokeText(text, pad, cv.height / 2);
      ctx2.fillStyle = color;
      ctx2.textBaseline = "middle";
      ctx2.fillText(text, pad, cv.height / 2);
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(cv.width / 22, cv.height / 22, 1);  // ~44px na cena
      spr.position.set(x, y, z);
      world.add(spr);
      labelSprites.push(spr);
      return spr;
    }
    for (const n of G.NODES) {
      const [x, z] = nodePos.get(n.id);
      makeLabel(n.name, x + 16, z, {
        size: n.hub || n.kind === "capital" ? 46 : 38,
        weight: n.hub || n.kind === "capital" ? 600 : 400,
        y: 30,
        scale: 1,
      });
    }

    // --- incidentes: arestas tracejadas coloridas ----------------------------
    // tracejado em Line não é nativo; usamos LineDashedMaterial
    const incLines = new Map(); // edgeId -> Line
    function refreshIncidents(incidents) {
      for (const [id, line] of incLines) { world.remove(line); }
      incLines.clear();
      for (const [edgeId, inc] of incidents) {
        const e = G.EDGES.find((x) => x.id === edgeId);
        if (!e) continue;
        const a = nodePos.get(e.a), b = nodePos.get(e.b);
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a[0], 4, a[1]),
          new THREE.Vector3(b[0], 4, b[1]),
        ]);
        const mat = new THREE.LineDashedMaterial({
          color: inc.grave ? COLORS.incGrave : COLORS.incComum,
          dashSize: 12, gapSize: 8, transparent: true, opacity: 0.95,
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        world.add(line);
        incLines.set(edgeId, line);
      }
    }

    // --- rotas destacadas (decisão) -----------------------------------------
    const routeGroup = new THREE.Group();
    world.add(routeGroup);
    function showRoutes(edgesAtivos, edgesGhost) {
      clearRoutes();
      const draw = (ids, color, dashed, y) => {
        for (const id of ids || []) {
          const e = G.EDGES.find((x) => x.id === id);
          if (!e) continue;
          const a = nodePos.get(e.a), b = nodePos.get(e.b);
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(a[0], y, a[1]),
            new THREE.Vector3(b[0], y, b[1]),
          ]);
          const mat = dashed
            ? new THREE.LineDashedMaterial({ color, dashSize: 14, gapSize: 10 })
            : new THREE.LineBasicMaterial({ color });
          const line = new THREE.Line(geo, mat);
          if (dashed) line.computeLineDistances();
          routeGroup.add(line);
        }
      };
      draw(edgesGhost, COLORS.rotaFantasma, true, 8);
      draw(edgesAtivos, COLORS.rotaAtiva, false, 8);
    }
    function clearRoutes() { routeGroup.clear(); }

    // --- caminhões: modelo GLB real (superfície), tintado por estado ---------
    const truckGroup = new THREE.Group();
    world.add(truckGroup);
    // No enquadramento nacional (raio ~2500), caminhão de ~90 unidades é visível
    const truckScale = 90 / 189;

    const truckMatByState = {
      em_viagem:     new THREE.MeshLambertMaterial({ color: COLORS.truckViajando }),
      carregando:    new THREE.MeshLambertMaterial({ color: COLORS.truckManuseio }),
      descarregando: new THREE.MeshLambertMaterial({ color: COLORS.truckManuseio }),
      reabastecendo: new THREE.MeshLambertMaterial({ color: COLORS.truckManuseio }),
      descansando:   new THREE.MeshLambertMaterial({ color: COLORS.truckDescanso }),
    };
    // ocioso: nem é mostrado (decisão do usuário)

    let truckProto = null;       // Group do GLB carregado, com material base
    let protoReady = false;
    const pendingTrucks = [];    // caminhões que esperam o GLB chegar

    function tintTruck(root, mat) {
      root.traverse((o) => { if (o.isMesh) o.material = mat; });
    }

    if (typeof window.CAMINHAO_GLB_B64 !== "undefined" && THREE.GLTFLoader) {
      const loader = new THREE.GLTFLoader();
      const bin = atob(window.CAMINHAO_GLB_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      loader.parse(bytes.buffer, "", (gltf) => {
        truckProto = gltf.scene;
        // centraliza o pivô: bbox X [-87.6, 101.3] → centro ~6.85; Z ±34 → ~1.2
        const box = new THREE.Box3().setFromObject(truckProto);
        const c = box.getCenter(new THREE.Vector3());
        truckProto.position.set(-c.x * truckScale, 0, -c.z * truckScale);
        truckProto.scale.setScalar(truckScale);
        protoReady = true;
        // cria os que ficaram pendentes
        for (const t of pendingTrucks) t._3d = makeTruckFromProto(t.status);
        pendingTrucks.length = 0;
      }, (err) => console.error("[GLB]", err));
    } else {
      console.warn("GLB ou loader ausente — caminhões não serão exibidos.");
    }

    function makeTruckFromProto(status) {
      if (!truckProto) return null;
      const g = new THREE.Group();
      const clone = truckProto.clone(true);       // clone profundo (compartilha geometria)
      tintTruck(clone, truckMatByState[status] || truckMatByState.em_viagem);
      g.add(clone);
      truckGroup.add(g);
      return g;
    }

    // --- câmera orbital manual (botão esquerdo = orbitar; shift/esq ou meio = pan; roda = zoom)
    // target = centroide dos nós (o grafo vive no Sudeste do quadro)
    const centroid = (() => {
      let sx = 0, sz = 0;
      for (const [x, z] of nodePos.values()) { sx += x; sz += z; }
      return [sx / nodePos.size, sz / nodePos.size];
    })();
    // target calibrado por iteração: centro do BBOX do contorno na tela
    // (982, 0, 671) — o centro geométrico (0,1900) desloca o mapa p/ o canto
    const target = new THREE.Vector3(982, 0, 671);
    let theta = Math.PI * 0.25;                     // azimute
    let phi = 0.8;                                  // polar do TOPO (~36° do horizonte): inclinado e legível
    let radius = 2500;                              // Brasil ocupa ~51% da largura
    const MIN_PHI = 0.25, MAX_PHI = 1.2;
    const MIN_R = 150, MAX_R = 12000;

    function updateCamera() {
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    }
    updateCamera();

    let drag = null;
    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", (ev) => {
      drag = {
        id: ev.pointerId, x: ev.clientX, y: ev.clientY,
        mode: (ev.button === 1 || ev.shiftKey) ? "pan" : "orbit",
        moved: false,
      };
      dom.setPointerCapture(ev.pointerId);
    });
    dom.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.mode === "orbit") {
        theta -= dx * 0.005;
        phi = Math.max(MIN_PHI, Math.min(MAX_PHI, phi - dy * 0.004));
      } else { // pan no plano do mundo
        const panScale = radius * 0.0016;
        // move o target no plano XZ relativo à orientação da câmera
        const sin = Math.sin(theta), cos = Math.cos(theta);
        target.x -= (dx * cos - dy * sin) * panScale;
        target.z -= (dx * sin + dy * cos) * panScale;
      }
      drag.x = ev.clientX; drag.y = ev.clientY;
      updateCamera();
    });
    dom.addEventListener("pointerup", (ev) => {
      if (drag && !drag.moved && onClickNode) {
        // clique curto → nó mais próximo por raio na tela
        const rect = dom.getBoundingClientRect();
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        // projeta cada nó
        let best = null, bestD = 28;
        const v = new THREE.Vector3();
        for (const [id, dot] of nodeDots) {
          v.copy(dot.position).project(camera);
          const sx = (v.x * 0.5 + 0.5) * rect.width;
          const sy = (-v.y * 0.5 + 0.5) * rect.height;
          const d = Math.hypot(sx - mx, sy - my);
          if (d < bestD) { bestD = d; best = id; }
        }
        if (best) onClickNode(best);
      }
      try { dom.releasePointerCapture(ev.pointerId); } catch (_) {}
      drag = null;
    });
    dom.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      radius = Math.max(MIN_R, Math.min(MAX_R, radius * (ev.deltaY < 0 ? 0.88 : 1 / 0.88)));
      updateCamera();
    }, { passive: false });
    dom.addEventListener("dblclick", () => {
      target.set(982, 0, 671); theta = Math.PI * 0.25; phi = 0.8; radius = 2500;
      updateCamera();
    });

    // --- loop de render sob demanda: só renderiza quando algo muda ----------
    // (câmera movendo, sim viva, janela redimensionada) — economiza GPU/bateria
    let running = true;
    let needsRender = true;
    const markDirty = () => { needsRender = true; };
    function frame() {
      if (!running) return;
      requestAnimationFrame(frame);
      if (!needsRender) return;      // pula o render: frame "grátis"
      needsRender = false;
      renderer.render(scene, camera);
    }
    frame();
    // a câmera orbita/pan/zoom marca dirty; o sim.tick emite "tick" que chama
    // renderSim → updateTrucks (muta a cena) → marcar dirty a partir daqui:
    const _origUpdateTrucks = updateTrucks;
    updateTrucks = function (trucks) { _origUpdateTrucks(trucks); markDirty(); };
    refreshIncidents = (function (orig) {
      return function (inc) { orig(inc); markDirty(); };
    })(refreshIncidents);
    showRoutes = (function (orig) {
      return function (a, b) { orig(a, b); markDirty(); };
    })(showRoutes);
    clearRoutes = (function (orig) {
      return function () { orig(); markDirty(); };
    })(clearRoutes);
    // durante arrasto de câmera: render contínuo
    const _origUpdateCamera = updateCamera;
    updateCamera = function () { _origUpdateCamera(); markDirty(); };

    window.addEventListener("resize", () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });

    /** Atualiza caminhões a partir do estado do sim (mesmos dados do SVG).
     *  Ociosos (disponivel) não são exibidos — decisão do usuário.
     *  Rotação: -heading_do_sim + window.ROT_FIX_GRAUS (calibrável ao vivo
     *  pelos sliders da legenda; default fixado no topo deste arquivo). */
    function updateTrucks(trucks) {
      const seen = new Set();
      for (const t of trucks) {
        // ocioso fora da cena
        if (t.status === "disponivel") {
          if (t._3d) { t._3d.visible = false; }
          continue;
        }
        const xy = window.__truckXY ? window.__truckXY(t) : null;
        if (!xy) continue;
        seen.add(t.id);
        let obj = t._3d;
        if (!obj) {
          if (!protoReady) { if (!pendingTrucks.includes(t)) pendingTrucks.push(t); continue; }
          obj = t._3d = makeTruckFromProto(t.status);
          if (!obj) continue;
        }
        obj.visible = true;
        const [wx, wz] = toWorld(xy[0], xy[1], WORLD_W, WORLD_H);
        obj.position.set(wx, 2, wz);
        const ang = window.__truckAngle ? window.__truckAngle(t) : 0;
        obj.rotation.y = -(ang * Math.PI / 180) + (window.ROT_FIX_GRAUS ?? ROT_FIX_GRAUS) * Math.PI / 180;
        // tint só quando muda de estado (barato: compara referência)
        const mat = truckMatByState[t.status] || truckMatByState.em_viagem;
        obj.traverse((o) => { if (o.isMesh && o.material !== mat) o.material = mat; });
      }
      for (const t of trucks) {
        if (!seen.has(t.id) && t._3d) { truckGroup.remove(t._3d); delete t._3d; }
      }
    }

    return {
      scene, camera, renderer, world, target,
      updateCamera, markDirty, updateTrucks, refreshIncidents, showRoutes, clearRoutes,
      nodePos, byId, WORLD_W, WORLD_H,
      resetView: () => { target.set(982, 0, 671); theta = Math.PI * 0.25; phi = 0.8; radius = 2500; updateCamera(); },
      dispose: () => { running = false; renderer.dispose(); },
    };
  }

  window.AgentRouter3D = { init, COLORS };
})();
