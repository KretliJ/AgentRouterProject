// ============================================================================
// AgentRouter — Mundo F2: grafo, Dijkstra, incidentes, cargas, caminhões
// ============================================================================
// Migração do sim.js para o núcleo Java, consumindo o grafo compartilhado
// (data/grafo.json) escrito pelo ETL Python.
//
// Sem bibliotecas externas: parser JSON próprio (suficiente p/ o schema fixo
// do grafo). RNG semeado por subsistema (mundo/cargas) p/ determinismo.
// ============================================================================

package br.ufop.agentrouter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

final class Mundo {

    // --- grafo ---------------------------------------------------------------
    static final class No {
        final String id, nome, classe;
        final double lon, lat;
        final boolean hub;
        No(String id, String nome, double lon, double lat, String classe, boolean hub) {
            this.id = id; this.nome = nome; this.lon = lon; this.lat = lat;
            this.classe = classe; this.hub = hub;
        }
    }

    static final class Aresta {
        final String id, br, a, b;
        final double km;
        Aresta(String id, String br, String a, String b, double km) {
            this.id = id; this.br = br; this.a = a; this.b = b; this.km = km;
        }
    }

    // --- incidente ------------------------------------------------------------
    static final class Incidente {
        final String edgeId;
        final long ateMs;
        final double penalty;
        final boolean grave;
        Incidente(String edgeId, long ateMs, double penalty, boolean grave) {
            this.edgeId = edgeId; this.ateMs = ateMs; this.penalty = penalty; this.grave = grave;
        }
    }

    // --- carga ------------------------------------------------------------------
    static final class Carga {
        final String id, empresaId, classe, origem, destino, prioridade, receptorId;
        final double pesoTon;
        final long criadaMs, prazoMs;
        String status = "aguardando_coleta";
        String fase = "coleta";
        String hub = "BHZ";
        long hubDesdeMs = -1, despachoMs = -1, hubSaiuMs = -1;
        Carga(String id, String empresaId, String receptorId, String classe, double pesoTon,
              String origem, String destino, long criadaMs, long prazoMs, String prioridade) {
            this.id = id; this.empresaId = empresaId; this.receptorId = receptorId;
            this.classe = classe; this.pesoTon = pesoTon; this.origem = origem;
            this.destino = destino; this.criadaMs = criadaMs; this.prazoMs = prazoMs;
            this.prioridade = prioridade;
        }
    }

    // --- caminhão -----------------------------------------------------------------
    static final class Caminhao {
        final String id, empresaId, tipo, noSede;
        final double velKmh, pesoMaxTon, capCombL, consKmL;
        double combL;
        double jornadaH;
        String status = "disponivel";
        String noAtual;
        // rota ativa
        List<Perna> pernas;
        int pernaIdx;
        double pernaKm;
        String cargaId;
        long untilMs;
        boolean reposition;

        Caminhao(String id, String empresaId, String tipo, String noSede,
                 double velKmh, double pesoMaxTon, double capCombL, double consKmL) {
            this.id = id; this.empresaId = empresaId; this.tipo = tipo;
            this.noSede = noSede; this.velKmh = velKmh; this.pesoMaxTon = pesoMaxTon;
            this.capCombL = capCombL; this.consKmL = consKmL;
            this.combL = capCombL; this.noAtual = noSede;
        }
    }

    static final class Perna {
        final String de, para, edgeId;
        final double km;
        boolean reabastecer;
        Perna(String de, String para, String edgeId, double km) {
            this.de = de; this.para = para; this.edgeId = edgeId; this.km = km;
        }
    }

    // --- estado geral -----------------------------------------------------------
    final Map<String, No> nos = new HashMap<>();
    final List<No> nosOrdem = new ArrayList<>();
    final Map<String, Aresta> arestas = new HashMap<>();
    final Map<String, List<int[]>> adj = new HashMap<>();  // noId → [idxAresta, direção]
    final List<Aresta> arestasOrdem = new ArrayList<>();

    final List<Caminhao> caminhoes = new ArrayList<>();
    final List<Carga> cargas = new ArrayList<>();
    final Map<String, Incidente> incidentes = new HashMap<>();
    final java.util.PriorityQueue<Evento> fila = new java.util.PriorityQueue<>();
    final java.util.ArrayDeque<String> log = new java.util.ArrayDeque<>();

    static final class Evento implements Comparable<Evento> {
        final long quandoMs;
        final String tipo;
        Evento(long quandoMs, String tipo) { this.quandoMs = quandoMs; this.tipo = tipo; }
        @Override public int compareTo(Evento o) {
            int c = Long.compare(quandoMs, o.quandoMs);
            return c != 0 ? c : tipo.compareTo(o.tipo);
        }
    }

    void log(String msg) {
        log.addFirst(simMs + " | " + msg);
        while (log.size() > 60) log.removeLast();
    }


    long simMs, proxIncidenteMs, proxCargaMs;
    long velocidade = 60;
    boolean pausado = true;
    final long seed;
    final Random rngMundo, rngCargas;
    int seqCarga = 100;

    static final long T0 = 0; // referência interna (prazos relativos ao simMs)
    static final long H = 3_600_000L;
    static final double PENAL_INC = 2.5, PENAL_GRAVE = 6.0;
    static final long TEMPO_COLETA = (long) (0.75 * H), TEMPO_DESCARGA = H / 2;
    static final long TEMPO_REABAST = H / 2, TEMPO_DESCANSO = 8 * H, TRANSBORDO = (long) (1.5 * H);
    static final long TEMPO_DOCA_REC = (long) (0.75 * H);
    static final int LIMITE_JORNADA_H = 10;
    static final int N_DOCAS_REC = 3, N_DOCAS_EXP = 3;
    static final Map<String, Integer> SLA_H = Map.of("critica", 24, "alta", 48, "padrao", 72);

    Mundo(long seed) {
        this.seed = seed;
        this.rngMundo = new Random(seed);
        this.rngCargas = new Random(seed + 1);
    }

    // ------------------------------------------------------------------
    // Parser JSON mínimo para o schema fixo do grafo (sem libs externas)
    // ------------------------------------------------------------------
    static String str(String s, String chave) {
        int i = s.indexOf("\"" + chave + "\"");
        if (i < 0) return null;
        int d = s.indexOf(':', i + chave.length() + 2);
        int a = s.indexOf('"', d);
        int f = s.indexOf('"', a + 1);
        return (a >= 0 && f > a) ? s.substring(a + 1, f) : null;
    }

    static double num(String s, String chave, int aPartirDe) {
        int i = s.indexOf("\"" + chave + "\"", aPartirDe);
        if (i < 0) return Double.NaN;
        int d = s.indexOf(':', i + chave.length() + 2);
        if (d < 0) return Double.NaN;
        int f = d + 1;
        while (f < s.length() && s.charAt(f) == ' ') f++;   // pula espaços após ":"
        int ini = f;
        if (f < s.length() && (s.charAt(f) == '-' || s.charAt(f) == '+')) f++;
        while (f < s.length() && (Character.isDigit(s.charAt(f)) || s.charAt(f) == '.')) f++;
        if (f == ini) return Double.NaN;
        try { return Double.parseDouble(s.substring(ini, f)); } catch (Exception e) { return Double.NaN; }
    }

    /** Carrega data/grafo.json (gerado pelo ETL Python). */
    void carregarGrafo(Path caminho) throws IOException {
        String s = Files.readString(caminho, StandardCharsets.UTF_8);
        // nós: split heurístico pelos objetos "{...}" dentro do array "nos"
        int iNos = s.indexOf("\"nos\"");
        int iFimNos = s.indexOf("\"arestas\"");
        String blocoNos = s.substring(iNos, iFimNos);
        MatcherNos:
        for (String obj : blocoNos.split("\\{")) {
            String id = str(obj, "id");
            if (id == null || obj.indexOf("nome") < 0) continue;
            double lon = num(obj, "lon", 0), lat = num(obj, "lat", 0);
            if (Double.isNaN(lon)) continue;
            String nome = str(obj, "nome");
            String classe = str(obj, "classe");
            boolean hub = obj.contains("\"hub\": true") || obj.contains("\"hub\":true");
            nos.put(id, new No(id, nome, lon, lat, classe, hub));
            nosOrdem.add(new No(id, nome, lon, lat, classe, hub));
        }
        String blocoArestas = s.substring(iFimNos);
        for (String obj : blocoArestas.split("\\{")) {
            String id = str(obj, "id");
            if (id == null || obj.indexOf("\"br\"") < 0) continue;
            String br = str(obj, "br"), a = str(obj, "a"), b = str(obj, "b");
            double km = num(obj, "km", 0);
            if (Double.isNaN(km) || !nos.containsKey(a) || !nos.containsKey(b)) continue;
            Aresta aresta = new Aresta(id, br, a, b, km);
            arestas.put(id, aresta);
            arestasOrdem.add(aresta);
        }
        // adjacência
        for (int i = 0; i < arestasOrdem.size(); i++) {
            Aresta a = arestasOrdem.get(i);
            adj.computeIfAbsent(a.a, k -> new ArrayList<>()).add(new int[]{i, 1});
            adj.computeIfAbsent(a.b, k -> new ArrayList<>()).add(new int[]{i, -1});
        }
    }

    Aresta arestaEntre(String a, String b) {
        for (int[] ref : adj.get(a)) {
            Aresta ar = arestasOrdem.get(ref[0]);
            if ((ref[1] == 1 && ar.b.equals(b)) || (ref[1] == -1 && ar.a.equals(b))) return ar;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Dijkstra com peso = tempo (h) × penalidade de incidente
    // ------------------------------------------------------------------
    double peso(Aresta a, double velKmh) {
        Incidente inc = incidentes.get(a.id);
        double mult = inc == null ? 1.0 : inc.penalty;
        return (a.km / velKmh) * mult;
    }

    /** Rota de menor tempo from→to. Devolve lista de arestas ou null. */
    List<Aresta> dijkstra(String from, String to, double velKmh) {
        Map<String, Double> dist = new HashMap<>();
        Map<String, Aresta> prev = new HashMap<>();
        List<String> abertos = new ArrayList<>();
        for (String id : nos.keySet()) dist.put(id, Double.POSITIVE_INFINITY);
        dist.put(from, 0.0);
        abertos.add(from);
        List<String> fechados = new ArrayList<>();
        while (!abertos.isEmpty()) {
            String u = null; double du = Double.POSITIVE_INFINITY;
            for (String id : abertos) {
                double d = dist.get(id);
                if (d < du) { du = d; u = id; }
            }
            if (u == null || u.equals(to)) break;
            abertos.remove(u); fechados.add(u);
            for (int[] ref : adj.get(u)) {
                Aresta ar = arestasOrdem.get(ref[0]);
                String v = ref[1] == 1 ? ar.b : ar.a;
                if (fechados.contains(v)) continue;
                double nd = du + peso(ar, velKmh);
                if (nd < dist.get(v)) { dist.put(v, nd); prev.put(v, ar); abertos.add(v); }
            }
        }
        if (!prev.containsKey(to) && !from.equals(to)) return null;
        List<Aresta> rota = new ArrayList<>();
        String cur = to;
        while (!cur.equals(from)) {
            Aresta ar = prev.get(cur);
            if (ar == null) return null;
            rota.add(0, ar);
            cur = ar.a.equals(cur) ? ar.b : ar.a;
            if (cur.equals(from)) break;
            if (ar.a.equals(cur)) break;
            // anda para trás no encadeamento
            String prox = null;
            for (Map.Entry<String, Aresta> e : prev.entrySet()) {
                Aresta r = e.getValue();
                String destino = r.a.equals(r.a) && (r.b.equals(cur)) ? r.a : (r.a.equals(cur) ? r.b : null);
                if (destino != null) { prox = e.getKey(); break; }
            }
            if (prox == null) break;
            cur = prox;
        }
        return rota;
    }

    // ------------------------------------------------------------------
    // Ground truth exógena: incidentes e cargas
    // ------------------------------------------------------------------
    void talvezIncidente() {
        if (simMs < proxIncidenteMs) return;
        proxIncidenteMs = simMs + (20 + rngMundo.nextInt(60)) * 60_000L;
        // aresta proporcional ao km
        double total = 0;
        for (Aresta a : arestasOrdem) total += a.km;
        double r = rngMundo.nextDouble() * total;
        Aresta escolhida = arestasOrdem.get(0);
        for (Aresta a : arestasOrdem) { r -= a.km; if (r <= 0) { escolhida = a; break; } }
        boolean grave = rngMundo.nextInt(100) < 12;
        long durH = 2 + rngMundo.nextInt(6);
        incidentes.put(escolhida.id, new Incidente(escolhida.id, simMs + durH * H,
                grave ? PENAL_GRAVE : PENAL_INC, grave));
    }

    void expirarIncidentes() {
        incidentes.values().removeIf(inc -> simMs >= inc.ateMs);
    }

    /** Injeção manual (comando incidenteEm / testes). */
    void forcarIncidente(String edgeId, boolean grave, long duracaoMs) {
        incidentes.put(edgeId, new Incidente(edgeId, simMs + duracaoMs,
                grave ? PENAL_GRAVE : PENAL_INC, grave));
    }

    /** Reinicia o mundo mantendo o grafo carregado. */
    void reiniciar(long novaSeed) {
        fila.clear(); log.clear();
        simMs = 0;
        incidentes.clear();
        cargas.clear();
        caminhoes.clear();
        proxIncidenteMs = (20 + rngMundo.nextInt(60)) * 60_000L;
        proxCargaMs = 2 * H;
        seqCarga = 100;
        rngMundo.setSeed(novaSeed);
        rngCargas.setSeed(novaSeed + 1);
        log("mundo reiniciado com seed " + novaSeed);
    }

    // ------------------------------------------------------------------
    // Avanço do relógio (paced): eventos na ordem + ground truth + despacho
    // ------------------------------------------------------------------
    void avancar(long dtMs) {
        long fim = simMs + dtMs;
        while (!fila.isEmpty() && fila.peek().quandoMs <= fim) {
            Evento ev = fila.poll();
            simMs = ev.quandoMs;
            log("evento agendado: " + ev.tipo);
        }
        simMs = Math.max(simMs, fim);
        expirarIncidentes();
        talvezIncidente();
        talvezCarga();
        despachar();
        moverCaminhoes(dtMs);
    }

    void talvezCarga() {
        if (simMs < proxCargaMs) return;
        proxCargaMs = simMs + (90 + rngCargas.nextInt(90)) * 60_000L;
        if (cargas.stream().filter(c -> !"entregue".equals(c.status) && !"atrasada".equals(c.status)).count() >= 80) return;
        // empresa aleatória da lista de empresas carregadas (data/empresas.json)
        if (Empresas.empresas.isEmpty()) return;
        var emp = Empresas.empresas.get(rngCargas.nextInt(Empresas.empresas.size()));
        String classe = emp.cargasTipos[rngCargas.nextInt(emp.cargasTipos.length)];
        var receptor = Empresas.sortearReceptor(classe, emp, rngCargas);
        if (receptor == null) return;
        double pr = rngCargas.nextDouble();
        String prioridade = pr < 0.1 ? "critica" : pr < 0.4 ? "alta" : "padrao";
        double peso = switch (classe) {
            case "refrigerada" -> 3 + rngCargas.nextDouble() * 12;
            case "perigosa" -> 10 + rngCargas.nextDouble() * 14;
            case "granel" -> 20 + rngCargas.nextDouble() * 18;
            case "superdimensionada" -> 12 + rngCargas.nextDouble() * 26;
            default -> 4 + rngCargas.nextDouble() * 20;
        };
        peso = Math.round(peso * 10) / 10.0;
        seqCarga++;
        long prazoH = switch (prioridade) { case "critica" -> 24; case "alta" -> 48; default -> 72; };
        cargas.add(new Carga("CARGA-" + seqCarga, emp.id, receptor.id, classe, peso,
                emp.no, receptor.no, simMs, simMs + prazoH * H, prioridade));
    }

    void despachar() { /* F3: migração do despacho do sim.js */ }
    void moverCaminhoes(long dtMs) { /* F3: migração do movimento do sim.js */ }

}
