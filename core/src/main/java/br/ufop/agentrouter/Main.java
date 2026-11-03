// ============================================================================
// AgentRouter — Núcleo Java (F1/F2): relógio, scheduler, mundo, protocolo
// ============================================================================
// Protocolo: JSON Lines no stdin/stdout (uma mensagem por linha).
//   → comandos: {"cmd":"ping"|"status"|"carregarGrafo"|"rota"|"tick"|...}
//   ← eventos:  {"evt":..., ...}
//
// F1: relógio paced, scheduler determinístico, mundo exógeno mínimo.
// F2: grafo real (data/grafo.json via ETL Python), Dijkstra de menor tempo.
//
// Build: javac -d core/build core/src/main/java/br/ufop/agentrouter/*.java
// Run:   java -cp core/build br.ufop.agentrouter.Main
// ============================================================================

package br.ufop.agentrouter;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

public final class Main {

    static final Mundo mundo = new Mundo(424242L);
    static volatile boolean rodando = true;

    // ------------------------------------------------------------------
    // Saída JSON Lines (stdout) — sem dependências externas
    // ------------------------------------------------------------------
    static synchronized void emitir(String json) {
        System.out.println(json);
        System.out.flush();
    }

    static String escapar(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }

    static String evento(String tipo, String corpo) {
        return "{\"evt\":\"" + tipo + "\"" + (corpo.isEmpty() ? "" : "," + corpo) + "}";
    }

    // ------------------------------------------------------------------
    // Parser mínimo (schema conhecido; substitui por lib se necessário)
    // ------------------------------------------------------------------
    static String extrair(String linha, String chave) {
        int i = linha.indexOf("\"" + chave + "\"");
        if (i < 0) return null;
        int d = linha.indexOf(':', i + chave.length() + 2);
        if (d < 0) return null;
        int a = linha.indexOf('"', d);
        int f = linha.indexOf('"', a + 1);
        return (a >= 0 && f > a) ? linha.substring(a + 1, f) : null;
    }

    static double num(String s, String chave, double def) {
        int i = s.indexOf("\"" + chave + "\"");
        if (i < 0) return def;
        int d = s.indexOf(':', i + chave.length() + 2);
        if (d < 0) return def;
        int f = d + 1;
        while (f < s.length() && s.charAt(f) == ' ') f++;
        int ini = f;
        if (f < s.length() && (s.charAt(f) == '-' || s.charAt(f) == '+')) f++;
        while (f < s.length() && (Character.isDigit(s.charAt(f)) || s.charAt(f) == '.')) f++;
        if (f == ini) return def;
        try { return Double.parseDouble(s.substring(ini, f)); } catch (Exception e) { return def; }
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------
    static void status() {
        String corpo = "\"simMs\":" + mundo.simMs +
            ",\"velocidade\":" + mundo.velocidade +
            ",\"pausado\":" + mundo.pausado +
            ",\"nos\":" + mundo.nos.size() +
            ",\"arestas\":" + mundo.arestas.size() +
            ",\"incidentes\":" + mundo.incidentes.size() +
            ",\"cargas\":" + mundo.cargas.size() +
            ",\"caminhoes\":" + mundo.caminhoes.size() +
            ",\"seed\":" + mundo.seed;
        emitir(evento("status", corpo));
    }

    // ------------------------------------------------------------------
    // Comandos
    // ------------------------------------------------------------------
    static void processar(String linha) {
        linha = linha.trim();
        if (linha.isEmpty()) return;
        String cmd = extrair(linha, "cmd");
        switch (cmd == null ? "" : cmd) {
            case "ping" -> emitir(evento("pong", "\"t\":" + Instant.now().toEpochMilli()));
            case "status" -> status();

            case "carregarGrafo" -> {
                String caminho = extrair(linha, "caminho");
                try {
                    mundo.carregarGrafo(Path.of(caminho));
                    String caminhoEmpresas = extrair(linha, "empresas");
                    if (caminhoEmpresas != null) Empresas.carregar(Path.of(caminhoEmpresas));
                    // frota → caminhões do mundo
                    mundo.caminhoes.clear();
                    for (var c : Empresas.frota) {
                        mundo.caminhoes.add(new Mundo.Caminhao(c.id, c.empresaId, c.tipo,
                                c.noSede, c.velKmh, c.pesoMaxTon, c.capCombL, c.consKmL));
                    }
                    emitir(evento("grafo", "\"nos\":" + mundo.nos.size() +
                        ",\"arestas\":" + mundo.arestas.size() +
                        ",\"empresas\":" + Empresas.empresas.size() +
                        ",\"caminhoes\":" + mundo.caminhoes.size()));
                } catch (Exception e) {
                    emitir(evento("erro", "{\"msg\":\"" + escapar(String.valueOf(e.getMessage())) + "\"}"));
                }
            }

            case "rota" -> {
                String de = extrair(linha, "de"), para = extrair(linha, "para");
                double vel = num(linha, "vel", 70);
                List<Mundo.Aresta> rota = mundo.dijkstra(de, para, vel);
                if (rota == null) {
                    emitir(evento("rota", "{\"de\":\"" + de + "\",\"para\":\"" + para +
                        "\",\"existe\":false}"));
                    return;
                }
                double km = 0, horas = 0;
                StringBuilder ids = new StringBuilder("[");
                for (Mundo.Aresta a : rota) {
                    km += a.km;
                    horas += mundo.peso(a, vel);
                    if (ids.length() > 1) ids.append(",");
                    ids.append("\"").append(a.id).append("\"");
                }
                ids.append("]");
                emitir(evento("rota", "{\"de\":\"" + de + "\",\"para\":\"" + para +
                    "\",\"km\":" + (int) km + ",\"horas\":" + (int) horas +
                    ",\"arestas\":" + ids + ",\"existe\":true}"));
            }

            case "incidenteEm" -> {
                // injeção de teste: {"cmd":"incidenteEm","edge":"...","grave":true,"horas":4}
                String edge = extrair(linha, "edge");
                boolean grave = linha.contains("\"grave\":true");
                long horas = (long) num(linha, "horas", 4);
                mundo.forcarIncidente(edge, grave, horas * Mundo.H);
                emitir(evento("incidenteInjetado", "{\"edge\":\"" + escapar(edge) +
                    "\",\"grave\":" + grave + "}"));
            }

            case "setSpeed" -> {
                mundo.velocidade = (long) num(linha, "valor", 60);
                status();
            }
            case "pause" -> { mundo.pausado = true; status(); }
            case "run" -> { mundo.pausado = false; status(); }
            case "tick" -> {
                long horas = (long) num(linha, "valor", 1);
                mundo.avancar(horas * Mundo.H);
                status();
            }
            case "seed" -> {
                long s = (long) num(linha, "valor", 424242);
                mundo.reiniciar(s);
                status();
            }
            case "sair" -> rodando = false;
            default -> emitir(evento("erro", "{\"msg\":\"comando desconhecido\"}"));
        }
    }

    // ------------------------------------------------------------------
    public static void main(String[] args) throws IOException {
        emitir(evento("pronto", "\"versao\":\"F2\",\"java\":\"" + System.getProperty("java.version") + "\""));

        // relógio paced em thread própria
        Thread relogio = new Thread(() -> {
            long ultimo = System.nanoTime();
            while (rodando) {
                try { Thread.sleep(250); } catch (InterruptedException e) { return; }
                long agora = System.nanoTime();
                double dtRealMs = (agora - ultimo) / 1_000_000.0;
                ultimo = agora;
                if (!mundo.pausado) mundo.avancar((long) (dtRealMs * mundo.velocidade));
            }
        }, "relogio-paced");
        relogio.setDaemon(true);
        relogio.start();

        try (BufferedReader in = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String linha;
            while (rodando && (linha = in.readLine()) != null) {
                processar(linha);
            }
        }
        emitir(evento("adeus", ""));
    }
}
