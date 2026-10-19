(function () {
    'use strict';

    function initSidebarToggle() {
        var body = document.body;
        var btn = document.querySelector('.docs-toggler');
        if (btn) {
            btn.addEventListener('click', function () {
                if (window.innerWidth <= 900) {
                    body.classList.toggle('docs-sidebar-open');
                }
            });
        }
        var backdrop = document.getElementById('docs-sidebar-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', function () {
                body.classList.remove('docs-sidebar-open');
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                body.classList.remove('docs-sidebar-open');
            }
        });
    }

    function initScrollSpy() {
        var links = Array.prototype.slice.call(document.querySelectorAll('.docs-sidebar-link[href^="#"]'));
        if (!links.length) return;
        var map = {};
        links.forEach(function (link) {
            var target = link.getAttribute('href').slice(1);
            var el = document.getElementById(target);
            if (el) map[target] = link;
        });
        var ids = Object.keys(map);
        if (!ids.length) return;
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    links.forEach(function (l) { l.classList.remove('active'); });
                    var link = map[entry.target.id];
                    if (link) link.classList.add('active');
                }
            });
        }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) observer.observe(el);
        });
    }

    function initCopyButtons() {
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.docs-copy');
            if (!btn) return;
            var codeBlock = btn.closest('.bd-code');
            if (!codeBlock) return;
            var pre = codeBlock.querySelector('pre');
            if (!pre) return;
            var text = pre.textContent;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    flashCopied(btn);
                }, function () { fallbackCopy(btn, text); });
            } else {
                fallbackCopy(btn, text);
            }
        });
    }

    function flashCopied(btn) {
        var original = btn.textContent;
        btn.textContent = 'Copiado';
        btn.classList.add('docs-copy--done');
        setTimeout(function () {
            btn.innerHTML = original;
            btn.classList.remove('docs-copy--done');
        }, 1600);
    }

    function fallbackCopy(btn, text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            flashCopied(btn);
        } catch (err) {
            btn.textContent = 'Error';
        }
        document.body.removeChild(ta);
    }

    document.addEventListener('DOMContentLoaded', function () {
        initSidebarToggle();
        initScrollSpy();
        initCopyButtons();
    });
})();