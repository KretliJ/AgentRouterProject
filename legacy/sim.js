// ============================================================================
// AgentRouter — Motor de simulação do protótipo (v0, client-side)
// ============================================================================
// ANTECIPA A SEMÂNTICA do núcleo definitivo (Java, roadmap F1+):
//   - Relógio paced: pausável, acelerável; eventos consomem tempo simulado.
//   - Ground truth exógena: incidentes brotam nas arestas por processo
//     estocástico (Poisson discreto por tick), independentes das decisões.
//   - Despacho ATIVO: prioridade > FIFO; rota de MENOR TEMPO com penalidade
//     de incidentes; planeja reabastecimento e jornada (hard constraints).
//   - Política FANTASMA: para cada despacho, o contrafactual de MENOR
//     DISTÂNCIA que ignora incidentes, combustível e filas (§7.1 do design).
//   - KPIs ao vivo + delta fantasma→ativa por carga entregue.
//
// Simplificações declaradas do protótipo (válidas p/ demo, não p/ estudo):
//   - Sem terminal físico (docas/equipes): coleta/carregamento = tempos fixos.
//   - Reabastecimento permitido em qualquer cidade-nó (§12 do design), 30 min.
//   - Repositioning: caminhão ocioso retorna vazio à sede da empresa.
//   - Fantasma é métrica por despacho (não replay pareado completo).

(function () {
  "use strict";

  const G = window.AgentRouterGraph;
  const D = window.AgentRouterData;
  const H = 3600e3;               // 1 hora em ms
  const T0 = Date.parse("2026-10-24T08:00:00-03:00");

  // --- PRNG semeado (ground truth determinística por sessão) -----------------
  let _seed = 424242;
  const rnd = () => {
    _seed |= 0; _seed = (_seed + 0x6d2b79f5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // --- índices do grafo -------------------------------------------------------
  const NODES = G.NODES;
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const adj = new Map(NODES.map((n) => [n.id, []]));
  const edgeKm = new Map();
  const edgeMid = new Map();
  for (const e of G.EDGES) {
    const km = G.GEO.haversine(byId[e.a].coord, byId[e.b].coord);
    edgeKm.set(e.id, km);
    edgeMid.set(e.id, G.GEO.midpoint(byId[e.a].coord, byId[e.b].coord));
    adj.get(e.a).push({ to: e.b, edgeId: e.id, km });
    adj.get(e.b).push({ to: e.a, edgeId: e.id, km });
  }

  // --- constantes de operação ------------------------------------------------
  const TEMPO_COLETA = 0.75 * H;      // 45 min carregando
  const TEMPO_DESCARGA = 0.5 * H;     // 30 min descarregando
  const TEMPO_REABAST = 0.5 * H;      // 30 min no posto
  const TEMPO_DESCANSO = 8 * H;       // descanso após fechar jornada
  const LIMITE_JORNADA_H = 10;
  const N_DOCAS_REC = 3;              // docas de recebimento no terminal de BH
  const N_DOCAS_EXP = 3;              // docas de expedição no terminal de BH
  const N_PATIO = 12;                 // vagas de pátio (capacidade finita)
  const PENALIDADE_INC = 2.5;         // × tempo na aresta com incidente
  const PENALIDADE_INC_GRAVE = 6;     // interdição parcial severa
  const SLA_H = { critica: 24, alta: 48, padrao: 72 };
  const PRIO_RANK = { critica: 0, alta: 1, padrao: 2 };
  const COMPAT = {
    seca: ["bau", "sider"],
    refrigerada: ["refrigerado"],
    perigosa: ["tanque"],
    granel: ["graneleiro", "bitrem"],
    superdimensionada: ["porta_conteiner", "bitrem"],
  };

  // --- Dijkstra ---------------------------------------------------------------
  // weight(edge, ctx) → custo; devolve {dist, path:[nodeIds]}
  function shortest(from, to, weight) {
    const dist = new Map(NODES.map((n) => [n.id, Infinity]));
    const prev = new Map();
    dist.set(from, 0);
    const open = new Set([from]);
    const done = new Set();
    while (open.size) {
      let u = null, du = Infinity;
      for (const id of open) { const d = dist.get(id); if (d < du) { du = d; u = id; } }
      if (u === null || u === to) break;
      open.delete(u); done.add(u);
      for (const { to: v, edgeId, km } of adj.get(u)) {
        if (done.has(v)) continue;
        const nd = du + weight(edgeId, km, v);
        if (nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); open.add(v); }
      }
    }
    const path = [];
    for (let cur = to; cur !== undefined; cur = prev.get(cur)) { path.unshift(cur); if (cur === from) break; }
    if (path[0] !== from) return null;
    return { dist: dist.get(to), path };
  }

  // --- estado -----------------------------------------------------------------
  let state = null;

  function buildState() {
    const trucks = D.TRUCKS.map((t) => ({ ...t, path: null, legs: null, legIdx: 0, legKm: 0, cargaId: null, until: 0 }));
    const cargas = D.CARGAS.map((c) => {
      const s = { ...c };
      if (s.status !== "aguardando_coleta") s.status = "aguardando_coleta"; // protótipo: só simula coletas novas
      s.ghostH = null; s.despachoMs = null;
      return s;
    });
    return {
      simMs: 0, speed: 60, paused: true,
      trucks, cargas,
      terminal: {
        docasRec: Array(N_DOCAS_REC).fill(null),  // slot: {cargaId, ateMs}
        docasExp: Array(N_DOCAS_EXP).fill(null),
      },
      decisions: [],                 // feed do agente {t, camada, msg, edgesAtivos?, edgesGhost?}
      gantt: [],                     // ocupação de docas {doca, cargaId, prio, de, ate}
      incidents: new Map(),          // edgeId -> {ateMs, penalty, grave, br}
      incHistory: [],                // {edgeId, de, ate, penalty} p/ replay fantasma
      nextCargaMs: 2 * H,
      nextIncidentMs: 3 * H,
      kpis: { entregues: 0, atrasadas: 0, kmRodados: 0, reabastecimentos: 0, incidentesGerados: 0, transbordos: 0, ganhoH: [], temposH: [], filaHubH: [] },
      log: [],
      seq: 100,
    };
  }

  // --- log & eventos ----------------------------------------------------------
  function logEv(icon, msg) {
    state.log.unshift({ t: state.simMs, icon, msg });
    if (state.log.length > 60) state.log.pop();
    emit("log");
  }
  const listeners = new Map();
  function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); }
  function emit(ev) { (listeners.get(ev) || []).forEach((f) => f()); }

  // --- ground truth: incidentes ----------------------------------------------
  function maybeIncident() {
    if (state.simMs < state.nextIncidentMs) return;
    state.nextIncidentMs = state.simMs + (20 + rnd() * 60) * (60e3); // 1 a cada 20–80 min de simulação
    // escolhe aresta com peso ∝ km
    const total = [...edgeKm.values()].reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    let edge = G.EDGES[0];
    for (const e of G.EDGES) { r -= edgeKm.get(e.id); if (r <= 0) { edge = e; break; } }
    const grave = rnd() < 0.12;
    const durH = 2 + rnd() * 6;
    const inc = {
      ateMs: state.simMs + durH * H,
      penalty: grave ? PENALIDADE_INC_GRAVE : PENALIDADE_INC,
      grave, br: edge.br,
    };
    state.incidents.set(edge.id, inc);
    state.incHistory.push({ edgeId: edge.id, de: state.simMs, ate: inc.ateMs, penalty: inc.penalty });
    state.kpis.incidentesGerados += 1;
    logEv("⚠️", `${edge.br}: ${grave ? "interdição grave" : "incidente"} (${durH.toFixed(1)} h) — trecho ${edge.a}↔${edge.b}`);
    emit("incidents");
  }
  function expireIncidents() {
    for (const [id, inc] of state.incidents) {
      if (state.simMs >= inc.ateMs) { state.incidents.delete(id); emit("incidents"); }
    }
  }

  // --- ground truth: novas cargas --------------------------------------------
  // Fluxo hub-and-spoke (decisão do usuário): TODA carga passa pelo terminal
  // de BH. A carga nasce na empresa de origem; o DESTINO é uma empresa
  // receptora cuja FUNÇÃO absorve a classe (DESTINO_POR_CLASSE). Ciclo:
  //   coleta na origem -> BHZ (transbordo) -> entrega no destino.
  function maybeSpawnCarga() {
    if (state.simMs < state.nextCargaMs) return;
    state.nextCargaMs = state.simMs + (90 + rnd() * 90) * 60e3; // a cada 1,5–3 h
    if (state.cargas.filter((c) => c.status !== "entregue" && c.status !== "atrasada").length >= 80) return;
    const emp = pick(D.COMPANIES);
    const classe = pick(emp.cargas_tipos);
    const receptor = D.sortearReceptor(classe, emp, rnd);
    if (!receptor) return;
    const pr = rnd();
    const prioridade = pr < 0.1 ? "critica" : pr < 0.4 ? "alta" : "padrao";
    const PESO = { seca: [4, 24], refrigerada: [3, 15], perigosa: [10, 24], granel: [20, 38], superdimensionada: [12, 38] };
    const [pmin, pmax] = PESO[classe];
    state.seq += 1;
    state.cargas.push({
      id: "CARGA-" + state.seq,
      empresa_id: emp.id,
      receptor_id: receptor.id,          // empresa receptora (função destinatária)
      classe,
      peso_ton: Math.round((pmin + rnd() * (pmax - pmin)) * 10) / 10,
      origem: emp.no,
      hub: "BHZ",                        // toda carga transborda no terminal
      destino: receptor.no,
      criada_em: new Date(T0 + state.simMs).toISOString(),
      prazo_limite: new Date(T0 + state.simMs + SLA_H[prioridade] * H).toISOString(),
      prioridade, valor_reais: Math.round(5000 + rnd() * 495000),
      status: "aguardando_coleta", ghostH: null, despachoMs: null,
      fase: "coleta",                    // coleta -> no_hub -> entrega
    });
    logEv("📦", `Nova carga ${prioridade} (${classe}) ${emp.no} → [BHZ] → ${receptor.no} (${receptor.tipo.replaceAll("_", " ")})`);
    emit("cargas");
  }

  // --- planejamento de rota ----------------------------------------------------
  // Ativo: menor TEMPO com penalidade de incidente; insere paradas de
  // reabastecimento quando a perna excede a autonomia disponível.
  function planoAtivo(truck, from, to) {
    const peso = (edgeId, km) => {
      const inc = state.incidents.get(edgeId);
      return (km / truck.vel_media_kmh) * (inc ? inc.penalty : 1);
    };
    const sp = shortest(from, to, peso);
    if (!sp) return null;
    const legs = [];
    for (let i = 0; i < sp.path.length - 1; i++) {
      const a = sp.path[i], b = sp.path[i + 1];
      const e = adj.get(a).find((x) => x.to === b);
      legs.push({ a, b, edgeId: e.edgeId, km: e.km, refuel: false });
    }
    // reabastecimento: percorre pernas acumulando; antes de estourar autonomia,
    // marca refuel no último nó e zera o acumulado (tanque cheio).
    let alcance = truck.comb_atual_l * truck.consumo_km_l;
    let acc = 0;
    for (let i = 0; i < legs.length; i++) {
      if (acc + legs[i].km > alcance) {
        legs[i - 1 >= 0 ? i - 1 : 0].refuel = true;   // reabastece antes desta perna
        acc = 0;
        alcance = truck.cap_comb_l * truck.consumo_km_l; // tanque cheio a partir daqui
      }
      acc += legs[i].km;
    }
    return legs;
  }

  // Fantasma: menor DISTÂNCIA, ignora incidentes NA ESCOLHA (política ingênua).
  // Por decisão do usuário TODA carga passa por BHZ — o fantasma também
  // (compara estratégias de rota, não a topologia). Replay no mundo real
  // na entrega (replayGhost), cobrindo as duas pernas.
  function planoFantasma(truck, from, hub, to) {
    const legs = [];
    let km = 0;
    for (const [a, b] of [[from, hub], [hub, to]]) {
      const sp = shortest(a, b, (_e, dist) => dist);
      if (!sp) return null;
      for (let i = 0; i < sp.path.length - 1; i++) {
        const x = sp.path[i], y = sp.path[i + 1];
        const e = adj.get(x).find((z) => z.to === y);
        legs.push({ edgeId: e.edgeId, km: e.km });
        km += e.km;
      }
    }
    return { legs, km };
  }

  /** Replay da viagem fantasma no mundo real: sofre os mesmos incidentes
   *  (histórico) no instante em que os encontraria — e obedece às MESMAS
   *  hard constraints: reabastecimento (30 min) e descanso de jornada (8 h).
   *  Tanque cheio e motorista zerado na saída (viagem nova). */
  function replayGhost(c) {
    const legs = c.ghostLegs || [];
    let t = 0;                                   // horas desde o despacho
    let driver = c.ghostJornada ?? 0;            // MESMA jornada residual do motorista
    let comb = c.ghostComb ?? c.ghostCapL;       // MESMO tanque do caminhão real
    for (const leg of legs) {
      if (leg.km > comb * c.ghostConsL) { t += TEMPO_REABAST / H; comb = c.ghostCapL; }
      let rest = leg.km;
      let guard = 0;
      while (rest > 1e-6 && guard++ < 5000) {
        const inc = incAt(leg.edgeId, c.despachoMs + t * H);
        const vel = c.ghostVel / (inc ? inc.penalty : 1);
        const dtH = 0.25;                        // passos de 15 min
        const step = Math.min(rest, vel * dtH);
        rest -= step; comb -= step / c.ghostConsL; t += step / vel; driver += step / vel;
        if (driver >= LIMITE_JORNADA_H) { t += TEMPO_DESCANSO / H; driver = 0; }
      }
    }
    return t + TEMPO_COLETA / H + TRANSBORDO_MS / H + TEMPO_DESCARGA / H;
  }

  /** Incidente vigente numa aresta num instante (histórico completo). */
  function incAt(edgeId, ms) {
    for (const h of state.incHistory) {
      if (h.edgeId === edgeId && ms >= h.de && ms < h.ate) return h;
    }
    return null;
  }

  // --- despacho (política ativa) ----------------------------------------------
  // Pipeline hub-and-spoke: 1º caminhão coleta na origem e leva ao terminal
  // de BH (transbordo); 2º caminhão leva de BH ao destino final.
  const TRANSBORDO_MS = 1.5 * H;   // manuseio no terminal (decisão micro futura)
  const TEMPO_DOCA_REC = 0.75 * H; // tempo de doca no recebimento
  // (expedição usa TEMPO_COLETA como tempo de doca/carregamento)

  /** Tenta alocar doca de recebimento p/ carga recém-chegada ao hub.
   *  DECISÃO MICRO do agente: doca específica vs pátio. */
  function alocaDocaRec(c) {
    const dock = state.terminal.docasRec.findIndex((d) => !d);
    if (dock >= 0) {
      state.terminal.docasRec[dock] = { cargaId: c.id, ateMs: state.simMs + TEMPO_DOCA_REC };
      state.gantt.push({ tipo: "rec", idx: dock, cargaId: c.id, prio: c.prioridade, de: state.simMs, ate: state.simMs + TEMPO_DOCA_REC });
      if (state.gantt.length > 400) state.gantt.splice(0, state.gantt.length - 400);
      c.status = "recebendo";
      c.docaRec = dock;
      state.decisions.unshift({ t: state.simMs, camada: "micro", msg: `${c.id} (${c.prioridade}) alocada na doca de recebimento R${dock + 1}`, cargaId: c.id });
    } else {
      c.status = "no_hub";           // fila informal no pátio
      c.hubDesdeMs = state.simMs;
      const ocup = state.cargas.filter((x) => x.status === "no_hub" || x.status === "recebendo").length;
      state.decisions.unshift({ t: state.simMs, camada: "micro", msg: `${c.id} sem doca livre — aguarda no pátio (${ocup}/${N_PATIO} vagas)`, cargaId: c.id });
    }
    if (state.decisions.length > 80) state.decisions.pop();
  }

  /** Libera docas cujo tempo acabou; carga sai da doca pronta p/ expedição. */
  function processaDocas() {
    for (const [i, d] of state.terminal.docasRec.entries()) {
      if (d && state.simMs >= d.ateMs) {
        state.terminal.docasRec[i] = null;
        const c = state.cargas.find((x) => x.id === d.cargaId);
        if (c) { c.status = "no_hub"; c.hubDesdeMs = state.simMs; }
      }
    }
    for (const [i, d] of state.terminal.docasExp.entries()) {
      if (d && state.simMs >= d.ateMs) state.terminal.docasExp[i] = null;
    }
  }

  function despacha() {
    const pend = state.cargas
      .filter((c) => c.status === "aguardando_coleta" ||
                     (c.status === "no_hub" && state.simMs - (c.hubDesdeMs ?? 0) >= TRANSBORDO_MS))
      .sort((x, y) => PRIO_RANK[x.prioridade] - PRIO_RANK[y.prioridade] || Date.parse(x.criada_em) - Date.parse(y.criada_em));
    for (const c of pend) {
      const de = c.status === "no_hub" ? c.hub : c.origem;   // BHZ ou origem
      const para = c.status === "no_hub" ? c.destino : c.hub;
      const segundaPerna = c.status === "no_hub";
      const cand = state.trucks
        .filter((t) => t.status === "disponivel" && t.no_atual === de &&
                        COMPAT[c.classe].includes(t.tipo) && t.peso_max_ton >= c.peso_ton &&
                        t.jornada_h < LIMITE_JORNADA_H - 1)
        .sort((a, b) => b.comb_atual_l * b.consumo_km_l - a.comb_atual_l * a.consumo_km_l)[0];
      if (!cand) continue;
      const legs = planoAtivo(cand, de, para);
      if (!legs || !legs.length) continue;   // de===para (ex.: carga BHZ→BHZ): aguarda
      const kmAtivo = legs.reduce((s, l) => s + l.km, 0);
      const tAtivo = kmAtivo / cand.vel_media_kmh;
      // contrafactual na 1ª perna: rota fantasma COMPLETA origem→[BHZ]→destino
      const ghost = c.fase === "coleta" ? planoFantasma(cand, c.origem, c.hub, c.destino) : null;
      cand.status = "carregando";
      cand.until = state.simMs + TEMPO_COLETA;
      cand.cargaId = c.id;
      cand.path = [legs[0].a, ...legs.map((l) => l.b)];
      cand.legs = legs; cand.legIdx = 0; cand.legKm = 0;
      cand.legAte = para;
      c.status = "coleta_em_curso";
      c.despachoMs = c.despachoMs ?? state.simMs;
      if (segundaPerna) c.hubSaiuMs = state.simMs;  // p/ medir fila no hub
      // metadados p/ o replay do contrafactual no mundo real (na entrega)
      if (ghost) {
        c.ghostLegs = ghost.legs;
        c.ghostVel = cand.vel_media_kmh;
        c.ghostCapL = cand.cap_comb_l;
        c.ghostConsL = cand.consumo_km_l;
        c.ghostComb = cand.comb_atual_l;
        c.ghostJornada = cand.jornada_h;
        c.ghostKm = ghost.km;
      }
      // ── decisão do agente registrada (visível nas duas camadas) ──
      const incEdges = legs.filter((l) => state.incidents.has(l.edgeId)).length;
      const desvioInc = incEdges > 0;
      const maisCurta = ghost && ghost.km < kmAtivo - 1; // ativa aceitou km a mais
      const motivo = desvioInc
        ? (maisCurta ? `desvio: ${incEdges} incidente(s) na rota curta (aceita +${Math.round(kmAtivo - ghost.km)} km)`
                     : `incidente(s) na rota, menor tempo mesmo assim`)
        : (maisCurta ? `rota mais longa por melhor condição (${Math.round(kmAtivo - ghost.km)} km a mais)`
                     : "menor tempo; sem incidentes na rota");
      state.decisions.unshift({
        t: state.simMs, camada: "macro",
        msg: `${c.id} (${c.prioridade}) ${de}→${para} via ${cand.id}: ${motivo}`,
        edgesAtivos: legs.map((l) => l.edgeId),
        edgesGhost: ghost ? ghost.legs.map((l) => l.edgeId) : null,
        cargaId: c.id, truckId: cand.id,
      });
      if (state.decisions.length > 80) state.decisions.pop();
      logEv("🚚", `${cand.id} leva ${c.id} ${de}→${para}${segundaPerna ? " (entrega final)" : " (coleta p/ BHZ)"}`);
      emit("cargas");
    }
    // repositioning: caminhão ocioso fora da volta p/ a sede
    for (const t of state.trucks) {
      if (t.status !== "disponivel") continue;
      const emp = D.companyById(t.empresa_id);
      if (t.no_atual === emp.no) continue;
      if (state.cargas.some((c) => c.status === "aguardando_coleta" && c.origem === t.no_atual &&
                                   COMPAT[c.classe].includes(t.tipo) && t.peso_max_ton >= c.peso_ton)) continue;
      const legs = planoAtivo(t, t.no_atual, emp.no);
      if (!legs) continue;
      t.status = "em_viagem"; t.cargaId = null; t.reposition = true;
      t.path = [legs[0].a, ...legs.map((l) => l.b)];
      t.legs = legs; t.legIdx = 0; t.legKm = 0;
    }
  }

  // --- movimento ---------------------------------------------------------------
  function moveTrucks(dtMs) {
    const dtH = dtMs / H;
    for (const t of state.trucks) {
      if (t.status === "descansando") {
        if (state.simMs >= t.until) { t.status = t.cargaId ? "em_viagem" : "disponivel"; t.jornada_h = 0; }
        continue;
      }
      if (t.status === "carregando" || t.status === "descarregando" || t.status === "reabastecendo") {
        if (state.simMs >= t.until) {
          if (t.status === "carregando") { t.status = "em_viagem"; }
          else if (t.status === "reabastecendo") { t.comb_atual_l = t.cap_comb_l; t.status = t.cargaId ? "em_viagem" : "disponivel"; }
          else { // descarregando → entrega concluída
            finalizaEntrega(t);
          }
        }
        continue;
      }
      if (t.status !== "em_viagem" || !t.legs) continue;

      let restaKm = t.vel_media_kmh * dtH;
      while (restaKm > 0 && t.legIdx < t.legs.length) {
        const leg = t.legs[t.legIdx];
        const inc = state.incidents.get(leg.edgeId);
        const vel = t.vel_media_kmh / (inc ? inc.penalty : 1);
        const porLeg = vel * dtH; // não usado diretamente; convertemos km↔hora no fim
        const falta = leg.km - t.legKm;
        const passo = Math.min(restaKm, falta);
        t.legKm += passo; restaKm -= passo;
        state.kpis.kmRodados += passo;
        // combustível
        const gasto = passo / t.consumo_km_l;
        if (t.comb_atual_l - gasto <= 0) { // reserva: parada de emergência (30 min)
          t.status = "reabastecendo";
          t.until = state.simMs + TEMPO_REABAST;
          state.kpis.reabastecimentos += 1;
          logEv("⛽", `${t.id} reabasteceu (reserva) — ${leg.a}→${leg.b}`);
          break;
        }
        t.comb_atual_l -= gasto;
        if (t.legKm >= leg.km - 1e-6) { // chegou ao nó
          t.no_atual = leg.b;
          t.legIdx += 1; t.legKm = 0;
          if (leg.refuel && t.comb_atual_l < t.cap_comb_l * 0.95) {
            t.status = "reabastecendo";
            t.until = state.simMs + TEMPO_REABAST;
            state.kpis.reabastecimentos += 1;
            logEv("⛽", `${t.id} reabastecendo em ${leg.b} (planejado)`);
          }
        }
        // jornada (clamp no limite: o resto do subtick vira descanso)
        t.jornada_h = Math.min(LIMITE_JORNADA_H, t.jornada_h + passo / vel);
        if (t.jornada_h >= LIMITE_JORNADA_H) {
          t.status = "descansando";
          t.until = state.simMs + TEMPO_DESCANSO;
          logEv("😴", `${t.id} em descanso obrigatório (jornada ${LIMITE_JORNADA_H} h)`);
          break;
        }
        void porLeg;
      }
      if (t.status === "em_viagem" && t.legIdx >= t.legs.length) {
        // chegou ao destino da perna
        if (t.reposition) { t.reposition = false; t.status = "disponivel"; t.path = null; t.legs = null; }
        else {
          const c = state.cargas.find((x) => x.id === t.cargaId);
          if (c && t.no_atual === c.hub && c.fase === "coleta") {
            // transbordo no terminal de BH: doca/pátio decidido pelo agente micro
            t.cargaId = null; t.status = "disponivel"; t.path = null; t.legs = null;
            alocaDocaRec(c);
            logEv("🏭", `${c.id} chegou ao terminal de BH (${c.origem}→${c.destino})`);
          } else {
            t.status = "descarregando";
            t.until = state.simMs + TEMPO_DESCARGA;
          }
        }
      }
    }
  }

  function finalizaEntrega(t) {
    const c = state.cargas.find((x) => x.id === t.cargaId);
    t.status = "disponivel"; t.path = null; t.legs = null; t.cargaId = null;
    if (!c) return;
    const entregueMs = state.simMs;
    const atrasada = entregueMs > Date.parse(c.prazo_limite) - T0;
    c.status = atrasada ? "atrasada" : "entregue";
    if (atrasada) state.kpis.atrasadas += 1;
    state.kpis.entregues += 1;
    state.kpis.transbordos += 1;
    // Contrafactual §7.1: fantasma replayada no mesmo mundo, rota completa
    // origem→[BHZ]→destino. O delta isola QUALIDADE DE ROTA: a fila no hub
    // (espera por caminhão além do transbordo padrão) é efeito de CAPACIDADE
    // da frota, não de rota — descontada do tempo real do par rota×fila.
    const horasReais = (entregueMs - (c.despachoMs ?? 0)) / H;
    const filaHubH = (c.hubSaiuMs !== undefined && c.hubDesdeMs !== undefined)
      ? Math.max(0, (c.hubSaiuMs - c.hubDesdeMs - TRANSBORDO_MS) / H) : 0;
    const horasReaisRota = horasReais - filaHubH;
    const horasGhost = c.ghostLegs ? replayGhost(c) : horasReais;
    state.kpis.filaHubH.push(filaHubH);
    state.kpis.ganhoH.push(horasGhost - horasReaisRota);
    state.kpis.temposH.push(horasReais);
    if (filaHubH > 0.5) logEv("⏳", `${c.id} esperou ${filaHubH.toFixed(1)} h por caminhão no terminal de BHZ`);
    logEv(atrasada ? "🔴" : "✅", `${c.id} ${atrasada ? "ATRASADA" : "entregue"} em ${c.destino} · fantasma ${horasGhost.toFixed(1)} h vs ativa ${horasReais.toFixed(1)} h`);
    emit("cargas");
  }

  // --- KPIs ---------------------------------------------------------------------
  function kpis() {
    const k = state.kpis;
    const ativos = state.cargas.filter((c) => c.status !== "entregue" && c.status !== "atrasada");
    const ganho = k.ganhoH.length ? k.ganhoH.reduce((a, b) => a + b, 0) / k.ganhoH.length : 0;
    const tempoMedio = k.temposH.length ? k.temposH.reduce((a, b) => a + b, 0) / k.temposH.length : 0;
    return {
      simMs: state.simMs, paused: state.paused, speed: state.speed,
      entregues: k.entregues, atrasadas: k.atrasadas,
      sla: k.entregues ? 100 * (k.entregues - k.atrasadas) / k.entregues : null,
      emTransito: state.trucks.filter((t) => t.status === "em_viagem").length,
      aguardando: state.cargas.filter((c) => c.status === "aguardando_coleta").length,
      incidentes: state.incidents.size,
      reabastecimentos: k.reabastecimentos,
      kmRodados: k.kmRodados,
      ganhoFantasmaH: ganho, tempoMedioH: tempoMedio,
      filaHubMediaH: k.filaHubH.length ? k.filaHubH.reduce((a, b) => a + b, 0) / k.filaHubH.length : 0,
      ativos: ativos.length,
    };
  }

  // --- tick & relógio -------------------------------------------------------------
  function tick(dtMs) {
    state.simMs += dtMs;
    processaDocas();
    expireIncidents();
    maybeIncident();
    maybeSpawnCarga();
    despacha();
    moveTrucks(dtMs);
    emit("tick");
  }

  let timer = null;
  function start() { state.paused = false; armTimer(); emit("tick"); }
  function pause() { state.paused = true; if (timer) { clearInterval(timer); timer = null; } emit("tick"); }
  function setSpeed(s) { state.speed = s; armTimer(); emit("tick"); }
  function armTimer() {
    if (timer) { clearInterval(timer); timer = null; }
    if (state.paused) return;
    timer = setInterval(() => {
      // subticks de ≤30 min simulados p/ estabilidade do movimento
      let dt = 250 * state.speed;
      while (dt > 0) { const step = Math.min(dt, 30 * 60e3); tick(step); dt -= step; }
    }, 250);
  }
  function reset() {
    if (timer) { clearInterval(timer); timer = null; }
    state = buildState();
    emit("incidents"); emit("cargas"); emit("tick");
  }
  /** Gancho de teste: avança N horas simuladas em subticks de 30 min. */
  function fastForward(hours) {
    let ms = hours * H;
    while (ms > 0) { const step = Math.min(ms, 30 * 60e3); tick(step); ms -= step; }
  }

  state = buildState();

  window.AgentRouterSim = {
    get state() { return state; },
    start, pause, setSpeed, reset, tick, fastForward, on, kpis,
    edgeKm, edgeMid,
    isPaused: () => state.paused,
    N_DOCAS_REC, N_DOCAS_EXP, N_PATIO,
  };
})();
