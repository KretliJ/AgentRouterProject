// ============================================================================
// AgentRouter — Empresas + frota (F2): carregados de data/empresas.json
// ============================================================================
// Fluxo funcional: carga de classe X é absorvida por empresa receptora
// cujo TIPO está em DESTINO_POR_CLASSE. Exclui a própria expedidora e
// empresas da mesma cidade-sede.

package br.ufop.agentrouter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

final class Empresas {

    static final class Empresa {
        final String id, nome, tipo, no, porte;
        final String[] cargasTipos;
        final double volumeMensalTn;
        Empresa(String id, String nome, String tipo, String no, String porte,
                String[] cargasTipos, double volumeMensalTn) {
            this.id = id; this.nome = nome; this.tipo = tipo; this.no = no;
            this.porte = porte; this.cargasTipos = cargasTipos;
            this.volumeMensalTn = volumeMensalTn;
        }
    }

    static final class Caminhao {
        final String id, empresaId, tipo, noSede;
        final double velKmh, pesoMaxTon, capCombL, consKmL;
        Caminhao(String id, String empresaId, String tipo, String noSede,
                 double velKmh, double pesoMaxTon, double capCombL, double consKmL) {
            this.id = id; this.empresaId = empresaId; this.tipo = tipo;
            this.noSede = noSede; this.velKmh = velKmh; this.pesoMaxTon = pesoMaxTon;
            this.capCombL = capCombL; this.consKmL = consKmL;
        }
    }

    static final String[] TIPOS_POR_CLASSE_GRANEL = {"siderurgia", "agroindustria", "frigorifico"};

    static final List<Empresa> empresas = new ArrayList<>();
    static final List<Caminhao> frota = new ArrayList<>();

    /** Fluxo funcional: classe → tipos de empresa receptora. */
    static String[] receptorasDe(String classe) {
        return switch (classe) {
            case "seca" -> new String[]{"atacado_varejo", "operador_logistico", "textil", "bebidas", "farmaceutica"};
            case "refrigerada" -> new String[]{"frigorifico", "farmaceutica", "atacado_varejo"};
            case "perigosa" -> new String[]{"quimica"};
            case "granel" -> new String[]{"siderurgia", "agroindustria", "frigorifico"};
            case "superdimensionada" -> new String[]{"automotiva", "operador_logistico"};
            default -> new String[]{"atacado_varejo"};
        };
    }

    /** Sorteia empresa receptora pela função, fora da cidade da origem. */
    static Empresa sortearReceptor(String classe, Empresa origem, Random rng) {
        String[] funcoes = receptorasDe(classe);
        List<Empresa> cand = new ArrayList<>();
        for (Empresa e : empresas) {
            if (e.id.equals(origem.id) || e.no.equals(origem.no)) continue;
            for (String f : funcoes) if (f.equals(e.tipo)) { cand.add(e); break; }
        }
        return cand.isEmpty() ? null : cand.get(rng.nextInt(cand.size()));
    }

    /** Carrega data/empresas.json (gerado pelo ETL Python). */
    static void carregar(Path caminho) throws IOException {
        String s = Files.readString(caminho, StandardCharsets.UTF_8);
        // empresas
        int iEmp = s.indexOf("\"empresas\"");
        int iFimEmp = s.indexOf("\"frota\"");
        String bloco = s.substring(iEmp, iFimEmp);
        for (String obj : bloco.split("\\{")) {
            String id = str(obj, "id");
            if (id == null || obj.indexOf("nome") < 0) continue;
            String nome = str(obj, "nome"), tipo = str(obj, "tipo"),
                   no = str(obj, "no"), porte = str(obj, "porte");
            if (nome == null || tipo == null || no == null) continue;
            // cargasTipos: array de strings
            List<String> tipos = new ArrayList<>();
            int it = obj.indexOf("cargasTipos");
            if (it >= 0) {
                String seg = obj.substring(it);
                var m = java.util.regex.Pattern.compile("\"(\\w+)\"").matcher(seg);
                while (m.find()) tipos.add(m.group(1));
            }
            double vol = num(obj, "volumeMensalTn", 0);
            empresas.add(new Empresa(id, nome, tipo, no, porte,
                    tipos.toArray(new String[0]), vol));
        }
        // frota
        String blocoFrota = s.substring(iFimEmp);
        for (String obj : blocoFrota.split("\\{")) {
            String id = str(obj, "id");
            if (id == null || obj.indexOf("empresaId") < 0) continue;
            String empresaId = str(obj, "empresaId"), tipo = str(obj, "tipo"),
                   noSede = str(obj, "noSede");
            if (empresaId == null || tipo == null || noSede == null) continue;
            frota.add(new Caminhao(id, empresaId, tipo, noSede,
                    num(obj, "velKmh", 70), num(obj, "pesoMaxTon", 14),
                    num(obj, "capCombL", 300), num(obj, "consKmL", 2.5)));
        }
    }

    // --- helpers de parse (duplicados de Mundo por simplicidade F2) ----------
    static String str(String s, String chave) {
        int i = s.indexOf("\"" + chave + "\"");
        if (i < 0) return null;
        int d = s.indexOf(':', i + chave.length() + 2);
        if (d < 0) return null;
        int a = s.indexOf('"', d);
        int f = s.indexOf('"', a + 1);
        return (a >= 0 && f > a) ? s.substring(a + 1, f) : null;
    }

    static double num(String s, String chave, double def) {
        int i = s.indexOf("\"" + chave + "\"");
        if (i < 0) return def;
        int d = s.indexOf(':', i + chave.length() + 2);
        if (d < 0) return def;
        int f = d + 1;
        while (f < s.length() && (Character.isDigit(s.charAt(f)) || "-+.eE".indexOf(s.charAt(f)) >= 0)) f++;
        try { return Double.parseDouble(s.substring(d + 1, f)); } catch (Exception e) { return def; }
    }

    private Empresas() {}
}
