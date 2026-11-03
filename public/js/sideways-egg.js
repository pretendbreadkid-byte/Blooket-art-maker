/*
 * Sideways easter egg for Blook Art Maker.
 * Click the logo five times quickly and the game opens full screen.
 * The game has its own Exit buttons (title screen, main menu, pause menu).
 *
 * Setup: put sideways.html next to your index.html, then add before </body>:
 *   <script src="sideways-egg.js" defer></script>
 * For a guaranteed match, add data-sideways-logo to your logo element:
 *   <img src="logo.png" alt="Blook Art Maker" data-sideways-logo>
 * Optional settings (put this before the script tag above):
 *   <script>window.SIDEWAYS_EGG = { logo: '#my-logo', src: 'games/sideways.html', name: 'Blook Art Maker' };</script>
 */
(function () {
  'use strict';
  var cfg = window.SIDEWAYS_EGG || {};
  var GAME_URL = cfg.src || 'sideways.html';
  var SITE_NAME = cfg.name || 'Blook Art Maker';
  var CLICKS = cfg.clicks || 5;
  var GAP_MS = cfg.gapMs || 1500; // longest pause allowed between clicks
  var SELECTORS = cfg.logo ? [cfg.logo] : [
    '[data-sideways-logo]', '#logo', '.logo', '.site-logo', '.brand',
    'img[alt*="logo" i]', 'img[src*="logo" i]', 'header img', 'header h1', 'h1'
  ];
  var ORIGIN = location.origin && location.origin !== 'null' ? location.origin : '*';

  var count = 0, last = 0, overlay = null, frame = null, closeBtn = null, logoEl = null, readyTimer = 0, prevOverflow = '';

  function findLogo(target) {
    if (!target || !target.closest) return null;
    for (var i = 0; i < SELECTORS.length; i++) {
      try { var el = target.closest(SELECTORS[i]); if (el) return el; } catch (e) { /* bad selector */ }
    }
    return null;
  }

  function logoImage(el) {
    var img = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (img && (img.currentSrc || img.src)) return img.currentSrc || img.src;
    var svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
    if (svg) {
      try { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)); } catch (e) { /* skip */ }
    }
    var canvas = el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
    if (canvas) { try { return canvas.toDataURL('image/png'); } catch (e) { /* tainted canvas */ } }
    return null;
  }

  function goFullscreen(node) {
    var req = node.requestFullscreen || node.webkitRequestFullscreen;
    if (!req) return;
    try { var p = req.call(node); if (p && p.catch) p.catch(function () {}); } catch (e) { /* not allowed */ }
  }

  function leaveFullscreen() {
    var d = document;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) return;
    var ex = d.exitFullscreen || d.webkitExitFullscreen;
    try { var p = ex.call(d); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
  }

  function open(el) {
    logoEl = el;
    overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Sideways');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#1d1830;';

    frame = document.createElement('iframe');
    frame.src = GAME_URL + (GAME_URL.indexOf('?') < 0 ? '?' : '&') + 'egg=1';
    frame.title = 'Sideways';
    frame.allow = 'fullscreen; autoplay; gamepad';
    frame.setAttribute('allowfullscreen', '');
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;';
    overlay.appendChild(frame);

    // Backup exit, shown only if the game hasn't loaded after a few seconds.
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Exit';
    closeBtn.style.cssText = 'position:absolute;top:calc(env(safe-area-inset-top, 0px) + 14px);left:calc(env(safe-area-inset-left, 0px) + 14px);' +
      'display:none;font:600 16px system-ui,sans-serif;padding:10px 18px;border:0;border-radius:8px;background:#ff7a3d;color:#1d1830;cursor:pointer;';
    closeBtn.addEventListener('click', close);
    overlay.appendChild(closeBtn);

    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    goFullscreen(overlay);
    readyTimer = setTimeout(function () { if (closeBtn) closeBtn.style.display = 'block'; }, 6000);
    frame.focus();
  }

  function close() {
    if (!overlay) return;
    clearTimeout(readyTimer);
    leaveFullscreen();
    overlay.remove();
    overlay = frame = closeBtn = null;
    document.documentElement.style.overflow = prevOverflow;
    if (logoEl && logoEl.focus) { try { logoEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  document.addEventListener('click', function (e) {
    if (overlay) return;
    var el = findLogo(e.target);
    if (!el) { count = 0; return; }
    var now = Date.now();
    count = now - last < GAP_MS ? count + 1 : 1;
    last = now;
    if (count >= CLICKS) {
      count = 0;
      e.preventDefault();
      e.stopPropagation();
      open(el);
    }
  }, true);

  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow) return;
    if (ORIGIN !== '*' && e.origin !== ORIGIN) return;
    var d = e.data || {};
    if (d.type === 'sideways:ready') {
      clearTimeout(readyTimer);
      if (closeBtn) closeBtn.style.display = 'none';
      // Hand the keyboard to the game now it's loaded, so Enter and the arrows work straight away.
      frame.focus();
      frame.contentWindow.focus();
      frame.contentWindow.postMessage({ type: 'sideways:hello', logo: logoImage(logoEl), site: SITE_NAME }, ORIGIN);
    } else if (d.type === 'sideways:exit') {
      close();
    }
  });

  // If the game never loaded, Escape on the page itself closes the overlay.
  document.addEventListener('keydown', function (e) {
    if (overlay && e.key === 'Escape' && closeBtn && closeBtn.style.display === 'block') close();
  });
})();
