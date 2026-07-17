/* Bullwinkle's clone — shared interactions. Progressive enhancement only. */
(function () {
  'use strict';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Hero background video pause/play (WCAG 2.2.2) ---- */
  (function () {
    var toggle = document.querySelector('[data-hero-toggle]');
    var video = document.querySelector('.hero-video');
    if (!toggle || !video) return;
    function set() {
      var playing = !video.paused;
      toggle.setAttribute('aria-label', playing ? 'Pause background video' : 'Play background video');
      toggle.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    }
    toggle.addEventListener('click', function () { video.paused ? video.play() : video.pause(); set(); });
    video.addEventListener('play', set); video.addEventListener('pause', set);
    set();
  })();

  /* ---- Eat-Play-Repeat carousel: manual dots + pause/play, no auto under reduced-motion ---- */
  (function () {
    var car = document.querySelector('.carousel');
    if (!car) return;
    var slides = [].slice.call(car.querySelectorAll('.slide'));
    var dots = car.querySelector('.carousel-dots');
    var toggle = car.querySelector('[data-car-toggle]');
    var i = 0, timer = null;
    slides.forEach(function (_, n) {
      var b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-label', 'Show photo ' + (n + 1) + ' of ' + slides.length);
      b.addEventListener('click', function () { go(n); });
      dots.appendChild(b);
    });
    var dotEls = [].slice.call(dots.children);
    function render() {
      slides.forEach(function (s, n) { var on = n === i; s.classList.toggle('active', on); s.setAttribute('aria-hidden', on ? 'false' : 'true'); });
      dotEls.forEach(function (d, n) { if (n === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    }
    function go(n) { i = (n + slides.length) % slides.length; render(); }
    function setBtn() { if (!toggle) return; var playing = !!timer; toggle.setAttribute('aria-label', playing ? 'Pause photo slideshow' : 'Play photo slideshow'); toggle.innerHTML = playing ? PAUSE_ICON : PLAY_ICON; }
    function start() { if (timer) return; timer = setInterval(function () { go(i + 1); }, 5000); setBtn(); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } setBtn(); }
    if (toggle) toggle.addEventListener('click', function () { timer ? stop() : start(); });
    render();
    if (REDUCE) { setBtn(); } else { start(); }
  })();

  /* ---- Location picker modal: focus in, ESC + backdrop close, focus returns, Tab trapped ---- */
  (function () {
    var modal = document.getElementById('locModal');
    if (!modal) return;
    var opener = null;
    var openers = [].slice.call(document.querySelectorAll('[data-open-modal]'));
    var closers = [].slice.call(modal.querySelectorAll('[data-close-modal]'));
    function focusables() { return [].slice.call(modal.querySelectorAll('a[href],button:not([disabled])')); }
    function open(e) {
      opener = e.currentTarget; modal.hidden = false;
      var f = focusables(); if (f[0]) f[0].focus();
      document.addEventListener('keydown', onKey);
    }
    function close() {
      modal.hidden = true; document.removeEventListener('keydown', onKey);
      if (opener) opener.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        var f = focusables(); if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    openers.forEach(function (b) { b.addEventListener('click', open); });
    closers.forEach(function (b) { b.addEventListener('click', close); });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  })();

  /* ---- Mobile nav toggle ---- */
  (function () {
    var btn = document.querySelector('.nav-toggle');
    var menu = document.getElementById('navMobile');
    if (!btn || !menu) return;
    btn.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  })();

  /* ---- FAQ accordion ---- */
  (function () {
    var qs = [].slice.call(document.querySelectorAll('.faq-q'));
    qs.forEach(function (q) {
      q.addEventListener('click', function () {
        var open = q.getAttribute('aria-expanded') === 'true';
        q.setAttribute('aria-expanded', open ? 'false' : 'true');
        var a = q.nextElementSibling;
        a.style.maxHeight = open ? '0' : a.scrollHeight + 'px';
      });
    });
  })();
})();
