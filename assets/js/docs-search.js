/*
====================================================================
 BUSCADOR DE LA DOCUMENTACIÓN
====================================================================

 Sin dependencias. Lee window.DOCS_SEARCH_INDEX (generado por
 build-search-index.mjs) y filtra en memoria.

 Por qué el índice es un .js y no un .json: la documentación se
 abre también con doble clic (file://), donde fetch() a un JSON
 local está bloqueado por CORS. Un <script> sí carga.

 Atajos
   /            abrir
   Ctrl/⌘ + K   abrir
   Esc          cerrar
   ↑ ↓          navegar
   Enter        abrir resultado

==================================================================== */

(function () {
    'use strict';

    var MAX_RESULTADOS = 20;

    var raiz = null;      // .docs-search
    var input = null;     // campo
    var lista = null;     // contenedor de resultados
    var contador = null;  // "n resultados"
    var indice = [];      // window.DOCS_SEARCH_INDEX
    var resultados = [];  // resultados de la consulta actual
    var activo = -1;      // índice del resultado resaltado
    var anteriorFoco = null;

    /* ------------------------------------------------------------
       Normalización: sin acentos y en minúsculas, para que
       "informacion" encuentre "Información".
    ------------------------------------------------------------ */

    function normalizar(texto) {
        return (texto || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '');
    }

    /* ------------------------------------------------------------
       Puntuación
    ------------------------------------------------------------ */

    function puntuar(entrada, termino) {
        var titulo = normalizar(entrada.t);
        var desc = normalizar(entrada.d);
        var cuerpo = normalizar(entrada.b);
        var claves = normalizar(entrada.k);

        var puntos = 0;

        if (titulo === termino) {
            puntos += 120;
        } else if (titulo.indexOf(termino) === 0) {
            puntos += 80;
        } else if (titulo.indexOf(termino) > -1) {
            puntos += 55;
        }

        if (claves.indexOf(termino) > -1) {
            puntos += 40;
        }

        if (desc.indexOf(termino) > -1) {
            puntos += 22;
        }

        if (cuerpo.indexOf(termino) > -1) {
            puntos += 10;
        }

        /* Todos los términos deben aparecer en algún sitio */
        var palabras = termino.split(/\s+/).filter(Boolean);
        for (var i = 0; i < palabras.length; i++) {
            var p = palabras[i];
            var encontrado = titulo.indexOf(p) > -1 ||
                claves.indexOf(p) > -1 ||
                desc.indexOf(p) > -1 ||
                cuerpo.indexOf(p) > -1;
            if (!encontrado) return 0;
        }

        /* Cuantos más términos pegados, mejor */
        if (palabras.length > 1) puntos += palabras.length * 5;

        /* La página actual tiene prioridad suave */
        if (entrada.p === paginaActual()) puntos += 4;

        return puntos;
    }

    function paginaActual() {
        var m = window.location.pathname.match(/([^/]+)\.html$/);
        return m ? m[1] : '';
    }

    function buscar(consulta) {
        var q = normalizar(consulta).trim();
        if (!q) return [];

        var encontrados = [];
        for (var i = 0; i < indice.length; i++) {
            var puntos = puntuar(indice[i], q);
            if (puntos > 0) {
                encontrados.push({ entrada: indice[i], puntos: puntos });
            }
        }

        encontrados.sort(function (a, b) {
            if (b.puntos !== a.puntos) return b.puntos - a.puntos;
            return (a.entrada.t || '').localeCompare(b.entrada.t || '', 'es');
        });

        return encontrados.slice(0, MAX_RESULTADOS).map(function (r) { return r.entrada; });
    }

    /* ------------------------------------------------------------
       Resaltado de coincidencias
    ------------------------------------------------------------ */

    function resaltar(texto, consulta) {
        if (!texto) return '';

        var base = normalizar(texto);
        var termino = normalizar(consulta).trim();
        if (!termino) return escapar(texto);

        /* Resaltar palabra por palabra (soporta "btn block") */
        var palabras = termino.split(/\s+/).filter(Boolean);
        var rangos = [];

        for (var w = 0; w < palabras.length; w++) {
            var palabra = palabras[w];
            if (!palabra) continue;

            var desde = 0;
            /* pos se recalcula en cada vuelta: si no, el while nunca
               termina porque pos no cambia y el rango se repite. */
            var pos = base.indexOf(palabra, desde);
            while (pos > -1) {
                rangos.push([pos, pos + palabra.length]);
                desde = pos + palabra.length;
                pos = base.indexOf(palabra, desde);
            }
        }

        if (!rangos.length) return escapar(texto);

        /* Fusionar rangos solapados y contiguos */
        rangos.sort(function (a, b) { return a[0] - b[0]; });
        var fusionados = [rangos[0]];
        for (var i = 1; i < rangos.length; i++) {
            var ultimo = fusionados[fusionados.length - 1];
            if (rangos[i][0] <= ultimo[1]) {
                ultimo[1] = Math.max(ultimo[1], rangos[i][1]);
            } else {
                fusionados.push(rangos[i]);
            }
        }

        var out = '';
        var cursor = 0;
        for (var j = 0; j < fusionados.length; j++) {
            var ini = fusionados[j][0];
            var fin = fusionados[j][1];
            out += escapar(texto.slice(cursor, ini));
            out += '<mark>' + escapar(texto.slice(ini, fin)) + '</mark>';
            cursor = fin;
        }
        out += escapar(texto.slice(cursor));

        return out;
    }

    function escapar(texto) {
        return (texto || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ------------------------------------------------------------
       Render
    ------------------------------------------------------------ */

    var ETIQUETAS = {
        'index.html': 'Fundamentos',
        'componentes.html': 'Componentes',
        'botones-formularios.html': 'Botones',
        'utilidades.html': 'Utilidades'
    };

    function pintar() {
        var consulta = input.value;

        if (!consulta.trim()) {
            resultados = [];
            activo = -1;
            pintarSugerencia();
            return;
        }

        resultados = buscar(consulta);
        activo = resultados.length ? 0 : -1;

        if (!resultados.length) {
            lista.innerHTML = '<p class="docs-search__empty">Sin resultados para <strong>' +
                escapar(consulta) + '</strong>.</p>';
            contador.textContent = '';
            return;
        }

        var html = '';
        for (var i = 0; i < resultados.length; i++) {
            var e = resultados[i];
            var url = e.a ? e.p + '#' + e.a : e.p;
            var pagina = ETIQUETAS[e.p] || e.p;
            var enEstaPagina = e.p === paginaActual();

            html += '<a class="docs-search__item' + (i === 0 ? ' is-active' : '') +
                '" role="option" aria-selected="' + (i === 0) + '" href="' + escapar(url) + '">' +
                '<span class="docs-search__item-head">' +
                    '<span class="docs-search__item-title">' + resaltar(e.t, consulta) + '</span>' +
                    '<span class="docs-search__item-page">' + escapar(pagina) +
                        (enEstaPagina ? ' · aquí' : '') + '</span>' +
                '</span>' +
                (e.d ? '<span class="docs-search__item-desc">' + resaltar(e.d, consulta) + '</span>' : '') +
                '</a>';
        }

        lista.innerHTML = html;
        contador.textContent = resultados.length + (resultados.length === 1 ? ' resultado' : ' resultados');
    }

    /* Cuando no hay consulta se listan atajos útiles */
    function pintarSugerencia() {
        contador.textContent = '';
        lista.innerHTML =
            '<p class="docs-search__hint">Secciones frecuentes</p>' +
            '<a class="docs-search__item" role="option" aria-selected="false" href="componentes.html#proyectos">' +
                '<span class="docs-search__item-head">' +
                    '<span class="docs-search__item-title">Proyectos</span>' +
                    '<span class="docs-search__item-page">Componentes</span>' +
                '</span>' +
            '</a>' +
            '<a class="docs-search__item" role="option" aria-selected="false" href="botones-formularios.html#btn-icon">' +
                '<span class="docs-search__item-head">' +
                    '<span class="docs-search__item-title">Icon (btn-icon)</span>' +
                    '<span class="docs-search__item-page">Botones</span>' +
                '</span>' +
            '</a>' +
            '<a class="docs-search__item" role="option" aria-selected="false" href="index.html#variables">' +
                '<span class="docs-search__item-head">' +
                    '<span class="docs-search__item-title">Variables / Design tokens</span>' +
                    '<span class="docs-search__item-page">Fundamentos</span>' +
                '</span>' +
            '</a>' +
            '<a class="docs-search__item" role="option" aria-selected="false" href="componentes.html#info-relevante">' +
                '<span class="docs-search__item-head">' +
                    '<span class="docs-search__item-title">Info relevante</span>' +
                    '<span class="docs-search__item-page">Componentes</span>' +
                '</span>' +
            '</a>';
    }

    function mover(delta) {
        if (!resultados.length) return;

        var items = lista.querySelectorAll('.docs-search__item');
        if (!items.length) return;

        if (activo > -1 && items[activo]) {
            items[activo].classList.remove('is-active');
            items[activo].setAttribute('aria-selected', 'false');
        }

        activo = (activo + delta + resultados.length) % resultados.length;

        if (items[activo]) {
            items[activo].classList.add('is-active');
            items[activo].setAttribute('aria-selected', 'true');
            /* behavior:instant anula el scroll-behavior:smooth global,
               que si no hace animar la página en cada flecha */
            items[activo].scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
    }

    function abrir() {
        if (!raiz) return;
        anteriorFoco = document.activeElement;
        raiz.hidden = false;

        pintarSugerencia();

        if (input) {
            input.value = '';
            input.focus();
        }
    }

    function cerrar() {
        if (!raiz || raiz.hidden) return;
        raiz.hidden = true;

        if (anteriorFoco && typeof anteriorFoco.focus === 'function') {
            anteriorFoco.focus();
        }
    }

    function estaAbierto() {
        return raiz && !raiz.hidden;
    }

    /* ------------------------------------------------------------
       Init
    ------------------------------------------------------------ */

    function init() {
        raiz = document.getElementById('docsSearch');
        input = document.getElementById('docsSearchInput');
        lista = document.getElementById('docsSearchResults');
        contador = document.getElementById('docsSearchCount');

        if (!raiz || !input || !lista) return;

        indice = (window.DOCS_SEARCH_INDEX || []).filter(function (e) {
            return e && e.p && (e.t || e.b);
        });

        /* Botón del navbar */
        var btn = document.querySelector('.docs-search-btn');
        if (btn) btn.addEventListener('click', abrir);

        /* Cerrar por backdrop o botón */
        var cerradores = raiz.querySelectorAll('[data-docs-search-close]');
        for (var i = 0; i < cerradores.length; i++) {
            cerradores[i].addEventListener('click', cerrar);
        }

        /* Escribir filtra */
        input.addEventListener('input', pintar);

        /* Navegación con teclado */
        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                mover(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                mover(-1);
            } else if (e.key === 'Enter') {
                if (activo > -1 && resultados[activo]) {
                    e.preventDefault();
                    var e2 = resultados[activo];
                    window.location.href = e2.a ? e2.p + '#' + e2.a : e2.p;
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cerrar();
            }
        });

        /* Ratón. Sin throttle, mousemove dispara decenas de reflows por
           segundo sobre una lista larga; se limita a un repintado por frame. */
        var hoverRaf = 0;
        lista.addEventListener('mousemove', function (e) {
            var item = e.target.closest('.docs-search__item');
            if (!item) return;

            if (hoverRaf) return;
            hoverRaf = requestAnimationFrame(function () {
                hoverRaf = 0;
                var items = lista.querySelectorAll('.docs-search__item');
                for (var i = 0; i < items.length; i++) {
                    if (items[i] === item) {
                        activo = i;
                        items[i].classList.add('is-active');
                        items[i].setAttribute('aria-selected', 'true');
                    } else {
                        items[i].classList.remove('is-active');
                        items[i].setAttribute('aria-selected', 'false');
                    }
                }
            });
        });

        /* Atajos globales */
        document.addEventListener('keydown', function (e) {
            var enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(
                (e.target.tagName || '').toUpperCase()
            ) || e.target.isContentEditable;

            if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                estaAbierto() ? cerrar() : abrir();
                return;
            }

            if (e.key === '/' && !enCampo && !estaAbierto()) {
                e.preventDefault();
                abrir();
                return;
            }

            if (e.key === 'Escape' && estaAbierto()) {
                e.preventDefault();
                cerrar();
            }
        });

        /* Al cerrar con el mouse se cierra también el sidebar móvil */
        document.body.classList.remove('docs-sidebar-open');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
