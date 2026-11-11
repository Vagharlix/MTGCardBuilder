// Platform glue: saving files from the desktop/mobile app or from a browser.
(function () {
	'use strict';
	var tauri = window.__TAURI__ && window.__TAURI__.core;
	window.isApp = !!tauri;

	function blobFromHref(href) {
		return fetch(href).then(function (r) { return r.blob(); });
	}

	// Save a Blob as a file. In the app: native "Save as" dialog on desktop,
	// Downloads folder on Android. In a browser: regular download.
	window.saveBlob = async function (name, blob) {
		if (tauri) {
			try {
				var bytes = new Uint8Array(await blob.arrayBuffer());
				var savedTo = await tauri.invoke('save_file', bytes, { headers: { 'x-file-name': encodeURIComponent(name) } });
				if (savedTo) notify('Saved to ' + savedTo, 5);
				return savedTo;
			} catch (e) {
				notify('Could not save the file: ' + e, 8);
				return null;
			}
		}
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.rel = 'noopener';
		document.body.appendChild(a);
		nativeClick.call(a);
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
		return name;
	};

	// The engine downloads through <a download> elements: route them through saveBlob.
	var nativeClick = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = function () {
		if (this.hasAttribute('download') && this.href && (tauri || this.href.indexOf('data:') === 0)) {
			var name = this.getAttribute('download') || 'download';
			blobFromHref(this.href).then(function (blob) { saveBlob(name, blob); });
			return;
		}
		return nativeClick.call(this);
	};

	// Links meant for a browser tab open in the system browser inside the app.
	document.addEventListener('click', function (e) {
		var a = e.target.closest && e.target.closest('a[target=_blank]');
		if (a && tauri && /^https?:/i.test(a.href)) {
			e.preventDefault();
			tauri.invoke('open_url', { url: a.href }).catch(function () {});
		}
	});
})();
