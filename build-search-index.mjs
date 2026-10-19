/*
====================================================================
 GENERADOR DEL ÍNDICE DE BÚSQUEDA
====================================================================

 Recorre los HTML de la documentación y genera
 assets/js/docs-search-index.js

 El índice se exporta como un <script> (no JSON) a propósito: la
 documentación se abre también con doble clic (file://), donde
 fetch() está bloqueado por CORS. Un <script> sí carga en file://.

 USO
   node build-search-index.mjs

 Se ejecuta manualmente después de modificar el contenido de la
 documentación. No hace falta tocar nada más.
==================================================================== */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(HERE, "assets", "js", "docs-search-index.js");

const PAGINAS = [
    { archivo: "index.html", etiqueta: "Fundamentos" },
    { archivo: "componentes.html", etiqueta: "Componentes" },
    { archivo: "botones-formularios.html", etiqueta: "Botones y Formularios" },
    { archivo: "utilidades.html", etiqueta: "Utilidades" }
];

/* -----------------------------------------------------------------
   Helpers de extracción
----------------------------------------------------------------- */

/* Quita bloques que no aportan texto buscable */
function limpiar(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ");
}

/* Texto visible: sin etiquetas, entidades resueltas, espacios colapsados */
function aTexto(html) {
    return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/\s+/g, " ")
        .trim();
}

/* Familias de clases que el buscador reconoce, para poder buscar
   "proyecto-card" o "rounded-pill" sin escribir la sección completa.
   El sufijo comun cubre los hijos: --card__body, --info-relevante__logo, etc. */
const FAMILIAS_CLASES = [
    /* Componentes */
    "proyecto(?:s)?", "barra-equipo", "info-relevante", "explora-categoria",
    "publicaciones-recientes", "banner-desafio", "btn", "form", "card", "hero",
    "banner", "chip(?:s)?", "timeline", "ticker", "modal", "tabla", "gallery",
    "galeria", "partners", "features", "read-more", "acorde(?:on)?", "msg",
    "mensaje", "evento", "listado", "contacto", "edicion", "social", "nav",
    "menu", "breadcrumb", "paginacion", "load", "education-stats", "topic-list",
    "breakpoint-row", "divider", "token",

    /* Border radius */
    "rounded",

    /* Color */
    "color-", "border-color-", "bg-color-",

    /* Flex y alineacion */
    "align-(?:self|items|content)-", "justify-(?:content|items|self)-", "flex-",

    /* Espaciado. Exige guion y escala (0-5) o auto, con breakpoint opcional,
       para no capturar palabras sueltas como "margin" o "padding". */
    "(?:m|p)(?:t|e|s|b|x|y)?-(?:[a-z]{1,3}-)?(?:[0-5]|auto|none)"
];

/* Clases CSS mentioned: sirven para buscar "proyecto-card".
   Se leen de los atributos class="..." en vez de escanear el HTML entero:
   asi solo entran nombres de clase reales y no palabras de la prosa
   ("navegación" no genera "navegaci"). Los ejemplos de codigo tambien
   cuentan, porque alli el class va igual: &lt;div class="rounded-pill"&gt; */
function clasesMencionadas(html) {
    const out = new Set();
    /* Anclado a la clase completa: evita cortes parciales y acepta tanto
       los hijos BEM (info-relevante__logo) como los modificadores (--aliados). */
    const esFamilia = new RegExp(
        "^(?:" + FAMILIAS_CLASES.join("|") + ")[a-z0-9_-]*$",
        "i"
    );
    const reClass = /class=(?:"([^"]*)"|'([^']*)')/g;
    let m;

    while ((m = reClass.exec(html)) !== null) {
        const valor = m[1] !== undefined ? m[1] : m[2];
        for (const c of valor.split(/\s+/)) {
            if (c.length > 2 && esFamilia.test(c)) out.add(c);
        }
    }

    /* Segunda fuente: las tablas documentan clases que no aparecen en ningun
       ejemplo, escritas como <code>.rounded-none</code>. Sin esto, buscar una
       clase que solo esta en la tabla daria 0 resultados. */
    const reCode = /<code>([^<]*)<\/code>/g;
    while ((m = reCode.exec(html)) !== null) {
        for (const c of m[1].split(/[\s,]+/)) {
            if (!c.startsWith(".")) continue;
            const nombre = c.slice(1);
            if (nombre.length > 2 && esFamilia.test(nombre)) out.add(nombre);
        }
    }

    return [...out].join(" ");
}

/* Corta un texto largo alrededor de la primera aparición de `term` */
function recorte(texto, term, largo = 165) {
    if (!term) return texto.slice(0, largo);
    const pos = texto.toLowerCase().indexOf(term.toLowerCase());
    if (pos < 0) return texto.slice(0, largo);
    const desde = Math.max(0, pos - Math.floor(largo / 3));
    const hasta = desde + largo;
    return (desde > 0 ? "…" : "") +
        texto.slice(desde, hasta).trim() +
        (hasta < texto.length ? "…" : "");
}

/* -----------------------------------------------------------------
   Parseo
----------------------------------------------------------------- */

function seccionesDe(html) {
    /* Cada <section id="..."> es una entrada. Se toma hasta el
       siguiente <section para no anidar contenido de otra sección. */
    const out = [];
    const re = /<section\b([^>]*)>/gi;
    const marcas = [];
    let m;

    while ((m = re.exec(html)) !== null) {
        const id = (m[1].match(/\bid="([^"]+)"/i) || [])[1];
        marcas.push({ id: id || null, ini: m.index, fin: m.index + m[0].length });
    }

    for (let i = 0; i < marcas.length; i++) {
        const actual = marcas[i];
        const cuerpo = html.slice(actual.fin, marcas[i + 1] ? marcas[i + 1].ini : html.length);
        out.push({ id: actual.id, cuerpo });
    }

    return out;
}

function tituloDe(cuerpo) {
    const h = cuerpo.match(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (!h) return "";
    return aTexto(h[2]);
}

function indice() {
    const entradas = [];

    for (const pag of PAGINAS) {
        const ruta = join(HERE, pag.archivo);
        let html;
        try {
            html = readFileSync(ruta, "utf8");
        } catch (err) {
            console.error(`  ! no se pudo leer ${pag.archivo}`);
            continue;
        }

        const limpio = limpiar(html);

        /* Entrada de la página completa (sin ancla) */
        const h1 = tituloDe(limpio) || pag.etiqueta;
        const cuerpoLimpio = limpio
            .replace(/<header[\s\S]*?<\/header>/i, " ")
            .replace(/<aside[\s\S]*?<\/aside>/i, " ");
        entradas.push({
            p: pag.archivo,
            a: "",
            t: h1,
            d: pag.etiqueta,
            b: recorte(aTexto(cuerpoLimpio), "", 200),
            k: clasesMencionadas(limpio)
        });

        for (const sec of seccionesDe(limpio)) {
            if (!sec.id) continue;
            const titulo = tituloDe(sec.cuerpo);
            const texto = aTexto(sec.cuerpo);
            if (!titulo && !texto) continue;

            /* Descripción corta: primer párrafo con contenido */
            const parrafo = sec.cuerpo.match(/<p>([\s\S]*?)<\/p>/i);
            const desc = parrafo ? aTexto(parrafo[1]).slice(0, 180) : "";

            entradas.push({
                p: pag.archivo,
                a: sec.id,
                t: titulo || desc.slice(0, 60),
                d: desc,
                b: recorte(texto, titulo || desc),
                k: clasesMencionadas(sec.cuerpo)
            });

            /* Subsecciones: un h2-h4 con id es un punto de anclaje
               navegable (variaciones, sub-bloques). Sin esto quedan
               fuera del buscador. */
            for (const sub of subseccionesDe(sec.cuerpo, sec.id)) {
                entradas.push({
                    p: pag.archivo,
                    a: sub.id,
                    t: sub.titulo,
                    d: sub.desc,
                    b: recorte(sub.texto, sub.titulo),
                    k: clasesMencionadas(sub.cuerpo)
                });
            }
        }
    }

    return entradas;
}

/* Encabezados h2-h4 con id dentro de una sección */
function subseccionesDe(cuerpo, idPadre) {
    const out = [];
    const re = /<h([2-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
    const marcas = [];
    let m;

    while ((m = re.exec(cuerpo)) !== null) {
        const id = (m[2].match(/\bid="([^"]+)"/i) || [])[1];
        if (!id || id === idPadre) continue;
        marcas.push({ id, titulo: aTexto(m[3]), ini: m.index, fin: re.lastIndex });
    }

    for (let i = 0; i < marcas.length; i++) {
        const contenido = cuerpo.slice(marcas[i].fin, marcas[i + 1] ? marcas[i + 1].ini : cuerpo.length);
        const parrafo = contenido.match(/<p>([\s\S]*?)<\/p>/i);
        out.push({
            id: marcas[i].id,
            titulo: marcas[i].titulo,
            desc: parrafo ? aTexto(parrafo[1]).slice(0, 180) : "",
            texto: aTexto(contenido),
            cuerpo: contenido
        });
    }

    return out;
}

/* -----------------------------------------------------------------
   Salida
----------------------------------------------------------------- */

const entradas = indice();
const json = JSON.stringify(entradas);

const contenido = `/*
 * Índice de búsqueda de la documentación — ARCHIVO GENERADO.
 *
 * Regenerar con:  node build-search-index.mjs
 * Editar a mano no tiene efecto: se sobrescribe.
 *
 * ${entradas.length} entradas.
 */

window.DOCS_SEARCH_INDEX = ${json};
`;

writeFileSync(SALIDA, contenido, "utf8");

console.log(`Índice generado: ${entradas.length} entradas`);
console.log(`  ${SALIDA}`);
for (const pag of PAGINAS) {
    const n = entradas.filter((e) => e.p === pag.archivo).length;
    console.log(`    ${pag.archivo.padEnd(24)} ${n}`);
}
