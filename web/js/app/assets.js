// Loaded first, before the card engine.
// 1. The engine asks for "/img/....png"; the app ships those images as WebP.
//    Requests are rewritten here, so frame packs and saved cards keep their
//    original paths (and stay compatible with files exported elsewhere).
// 2. Image URLs pointing at known hosting of the same assets (or at this app on
//    another device/platform) are served from the local copy instead.
// 3. Keyrune set symbols come from the local copy instead of a CDN.
(function () {
  'use strict';

  var KEEP_PNG = { '/img/blank.png': 1, '/img/black.png': 1, '/img/blankThumb.png': 1, '/img/blackThumb.png': 1 };
  var LOCAL_HOSTS = {
    'localhost': 1, 'tauri.localhost': 1, '127.0.0.1': 1,
    'cardconjurer.com': 1, 'www.cardconjurer.com': 1, 'card-conjurer.storage.googleapis.com': 1,
    'mtgcardbuilder.com': 1, 'www.mtgcardbuilder.com': 1
  };
  var KEYRUNE_CDN = /^https?:\/\/cdn\.jsdelivr\.net\/npm\/keyrune(@[^/]+)?\/svg\/([a-z0-9_-]+\.svg)$/i;
  var base = location.protocol + '//' + location.host;

  function mapAsset(value) {
    if (typeof value !== 'string' || value === '') return value;
    if (value.indexOf('data:') === 0 || value.indexOf('blob:') === 0) return value;
    var k = KEYRUNE_CDN.exec(value);
    if (k) return '/img/keyrune/' + k[2].toLowerCase();
    var url;
    try { url = new URL(value, location.href); } catch (e) { return value; }
    var path = url.pathname;
    if (path.indexOf('/img/') !== 0) return value;
    var sameApp = (url.protocol + '//' + url.host) === base;
    if (!sameApp && !LOCAL_HOSTS[url.hostname]) return value;
    // decode %20 etc. once, re-encode on the way out
    try { path = decodeURI(path); } catch (e) { /* keep raw */ }
    if (/\.png$/i.test(path) && !KEEP_PNG[path]) path = path.slice(0, -4) + '.webp';
    return encodeURI(path);
  }
  window.mapAsset = mapAsset;

  var srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: srcDesc.enumerable,
    get: srcDesc.get,
    set: function (v) { srcDesc.set.call(this, mapAsset(v)); }
  });
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') value = mapAsset(value);
    return setAttr.call(this, name, value);
  };
  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = mapAsset(String(url));
    return xhrOpen.apply(this, args);
  };
})();
