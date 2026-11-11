// Card Studio interface layer on top of the card engine (creator-23.js).
(function () {
	'use strict';

	var $ = function (sel, root) { return (root || document).querySelector(sel); };
	var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
	function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
	function waitFor(test, timeout) {
		var start = Date.now();
		timeout = timeout || 8000;
		return new Promise(function (resolve, reject) {
			(function check() {
				var ok = false;
				try { ok = test(); } catch (e) { ok = false; }
				if (ok) return resolve(ok);
				if (Date.now() - start > timeout) return reject(new Error('timeout'));
				setTimeout(check, 40);
			})();
		});
	}
	function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
	function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

	/* ------------------------------------------------------------------
	 * Dialogs (prompt/confirm replacements that work in every webview)
	 * ------------------------------------------------------------------ */
	var dialogQueue = Promise.resolve();
	function dialog(opts) {
		var run = function () {
			return new Promise(function (resolve) {
				var box = $('#dialog');
				$('#dialog-title').textContent = opts.title || '';
				$('#dialog-text').textContent = opts.text || '';
				$('#dialog-text').classList.toggle('hidden', !opts.text);
				var fields = $('#dialog-fields');
				fields.innerHTML = '';
				(opts.fields || []).forEach(function (f) {
					var label = document.createElement('label');
					label.className = 'labeled';
					var span = document.createElement('span');
					span.textContent = f.label;
					label.appendChild(span);
					var input = document.createElement('input');
					input.className = 'input';
					input.type = f.type || 'text';
					input.value = f.value || '';
					input.dataset.field = f.id;
					if (f.placeholder) input.placeholder = f.placeholder;
					if (f.list && f.list.length) {
						var dl = document.createElement('datalist');
						dl.id = 'dl-' + f.id;
						f.list.forEach(function (v) { var o = document.createElement('option'); o.value = v; dl.appendChild(o); });
						label.appendChild(dl);
						input.setAttribute('list', dl.id);
					}
					label.appendChild(input);
					fields.appendChild(label);
				});
				var ok = $('#dialog-ok'), cancel = $('#dialog-cancel');
				ok.textContent = opts.ok || 'OK';
				cancel.textContent = opts.cancel || 'Cancel';
				cancel.classList.toggle('hidden', opts.cancel === false);
				var extra = $('#dialog-extra');
				if (extra) extra.remove();
				if (opts.extra) {
					extra = document.createElement('button');
					extra.type = 'button';
					extra.id = 'dialog-extra';
					extra.className = 'input';
					extra.textContent = opts.extra;
					cancel.after(extra);
				}
				function close(result) {
					box.classList.add('hidden');
					ok.onclick = cancel.onclick = null;
					if (extra) extra.onclick = null;
					document.removeEventListener('keydown', onKey, true);
					resolve(result);
				}
				function values() {
					var v = {};
					$$('input', fields).forEach(function (i) { v[i.dataset.field] = i.value; });
					return v;
				}
				function onKey(e) {
					if (e.key === 'Escape') { e.preventDefault(); close(null); }
					if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); close(values()); }
				}
				ok.onclick = function () { close(values()); };
				cancel.onclick = function () { close(null); };
				if (extra) extra.onclick = function () { close('extra'); };
				document.addEventListener('keydown', onKey, true);
				box.classList.remove('hidden');
				var first = $('input', fields);
				setTimeout(function () { (first || ok).focus(); if (first) first.select(); }, 30);
			});
		};
		var p = dialogQueue.then(run);
		dialogQueue = p.catch(function () {});
		return p;
	}
	window.dialog = dialog;
	window.dialogConfirm = function (title, text, okLabel) {
		return dialog({ title: title, text: text, ok: okLabel || 'OK' }).then(function (r) { return r !== null; });
	};
	window.askCardName = async function (defaultName) {
		var cats = await getCategories();
		var current = window.currentCardKey ? await CardStore.get(window.currentCardKey) : null;
		var r = await dialog({
			title: 'Save to gallery',
			fields: [
				{ id: 'name', label: 'Card name', value: (current && current.key) || defaultName || 'My card' },
				{ id: 'category', label: 'Category (optional)', value: (current && current.category) || '', list: cats, placeholder: 'ex: My set, Commander deck...' }
			],
			ok: 'Save'
		});
		if (!r || !r.name || !r.name.trim()) return null;
		return { name: r.name.trim(), category: (r.category || '').trim() };
	};
	// The engine uses confirm() for big uploads; keep it but never block the app.
	window.confirm = (function (nativeConfirm) {
		return function (msg) { try { return nativeConfirm.call(window, msg); } catch (e) { return true; } };
	})(window.confirm);

	/* ------------------------------------------------------------------
	 * Theme and views
	 * ------------------------------------------------------------------ */
	window.toggleTheme = function () {
		var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
		document.documentElement.dataset.theme = next;
		lsSet('cs-theme', next);
	};
	window.showView = function (name) {
		['editor', 'gallery', 'print'].forEach(function (v) {
			$('#view-' + v).classList.toggle('hidden', v !== name);
		});
		$$('.topnav a').forEach(function (a) { a.classList.toggle('active', a.dataset.view === name); });
		$('#mini-preview-toggle').classList.toggle('hidden', name !== 'editor');
		if (name !== 'editor') $('#mini-preview').classList.add('hidden');
		if (name === 'gallery') renderGallery();
		if (name === 'print') renderPrintList();
		window.scrollTo(0, 0);
		if (history.replaceState) history.replaceState(null, '', '#' + name);
	};

	/* ------------------------------------------------------------------
	 * Rendering: coalesce redraws to one per animation frame
	 * ------------------------------------------------------------------ */
	var engineDrawCard = window.drawCard;
	var drawPending = false;
	var rotation = 0;
	window.drawCardNow = function () {
		drawPending = false;
		engineDrawCard();
		afterDraw();
	};
	window.drawCard = function () {
		if (drawPending) return;
		drawPending = true;
		var fire = function () { if (drawPending) drawCardNow(); };
		requestAnimationFrame(fire);
		setTimeout(fire, 120); // in case animation frames are throttled
	};
	// Faster text refresh than the engine's 500 ms debounce.
	window.drawTextBuffer = function () {
		clearTimeout(writingText);
		writingText = setTimeout(drawText, 90);
	};
	// Script loads are tracked so we know when a frame pack is ready.
	window.pendingScripts = 0;
	window.loadScript = function (scriptPath) {
		return new Promise(function (resolve) {
			var script = document.createElement('script');
			script.type = 'text/javascript';
			pendingScripts++;
			script.onload = function () { pendingScripts--; resolve(true); };
			script.onerror = function () { pendingScripts--; notify('A frame file failed to load: ' + scriptPath, 6); resolve(false); };
			script.src = scriptPath;
			document.head.appendChild(script);
		});
	};

	function afterDraw() {
		if (rotation) paintRotatedPreview();
		if (!$('#mini-preview').classList.contains('hidden')) paintMiniPreview();
		scheduleAutosave();
	}

	/* ------------------------------------------------------------------
	 * Rotate frame (view and export rotated by 90° steps)
	 * ------------------------------------------------------------------ */
	function setPreviewSize() {
		var landscape = rotation % 180 !== 0;
		var w = landscape ? 1407 : 1005, h = landscape ? 1005 : 1407;
		if (previewCanvas.width !== w || previewCanvas.height !== h) {
			previewCanvas.width = w;
			previewCanvas.height = h;
		}
		previewCanvas.style.aspectRatio = w + ' / ' + h;
	}
	function paintRotatedPreview() {
		var ctx = previewContext;
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
		ctx.translate(previewCanvas.width / 2, previewCanvas.height / 2);
		ctx.rotate(rotation * Math.PI / 180);
		var landscape = rotation % 180 !== 0;
		var dw = landscape ? previewCanvas.height : previewCanvas.width;
		var dh = landscape ? previewCanvas.width : previewCanvas.height;
		ctx.drawImage(cardCanvas, -dw / 2, -dh / 2, dw, dh);
		ctx.restore();
	}
	function applyRotation(r) {
		rotation = ((r || 0) % 360 + 360) % 360;
		card.csRotation = rotation;
		setPreviewSize();
		$('#rotateFrame').textContent = rotation ? 'Rotate Frame (' + rotation + '°)' : 'Rotate Frame';
		drawCard();
	}
	window.rotateFrame = function () { applyRotation(rotation + 90); };
	window.exportCanvas = function () {
		if (!rotation) return cardCanvas;
		var c = document.createElement('canvas');
		var landscape = rotation % 180 !== 0;
		c.width = landscape ? cardCanvas.height : cardCanvas.width;
		c.height = landscape ? cardCanvas.width : cardCanvas.height;
		var ctx = c.getContext('2d');
		ctx.translate(c.width / 2, c.height / 2);
		ctx.rotate(rotation * Math.PI / 180);
		ctx.drawImage(cardCanvas, -cardCanvas.width / 2, -cardCanvas.height / 2);
		return c;
	};

	/* ------------------------------------------------------------------
	 * Transparency highlight, branding, downloads
	 * ------------------------------------------------------------------ */
	window.toggleCardBackgroundColor = function (on) {
		previewCanvas.classList.toggle('show-transparency', !!on);
		lsSet('cs-transparency', on ? '1' : '0');
	};
	var engineLoadBottomInfo = window.loadBottomInfo;
	window.loadBottomInfo = function (textObjects) {
		Object.keys(textObjects || {}).forEach(function (k) {
			var t = textObjects[k];
			if (t && typeof t.text === 'string') t.text = t.text.replace(/CardConjurer\.com/gi, '');
		});
		return engineLoadBottomInfo(textObjects);
	};

	// Collector info: same as the engine, plus the "NOT FOR SALE" / copyright
	// lines (optional) and protection against overlapping redraws.
	var bottomGen = 0;
	window.bottomInfoEdited = async function () {
		var gen = ++bottomGen;
		bottomInfoContext.clearRect(0, 0, bottomInfoCanvas.width, bottomInfoCanvas.height);
		card.infoNumber = $('#info-number').value;
		card.infoRarity = $('#info-rarity').value;
		card.infoSet = $('#info-set').value;
		card.infoLanguage = $('#info-language').value;
		card.infoArtist = $('#info-artist').value;
		card.infoYear = $('#info-year').value;
		card.infoNote = $('#info-note').value;
		if ($('#enableCollectorInfo').checked) {
			var legal = $('#show-legal-lines').checked;
			var entries = Object.entries(card.bottomInfo || {});
			for (var i = 0; i < entries.length; i++) {
				if (gen !== bottomGen) return;
				var t = entries[i][1];
				if (!t || typeof t.text !== 'string') continue;
				if (/cardconjurer\.com/i.test(t.text)) continue;
				if (!legal && /NOT FOR SALE|Wizards of the Coast/.test(t.text)) continue;
				t.name = entries[i][0];
				await writeText(t, bottomInfoContext);
			}
		}
		if (gen === bottomGen) drawCard();
	};

	async function flushRender() {
		if (writingText) {
			clearTimeout(writingText);
			writingText = null;
			try { await drawText(); } catch (e) { /* keep going */ }
		}
		drawCardNow();
	}
	window.flushRender = flushRender;
	function canvasToBlob(canvas, type, quality) {
		return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
	}
	window.downloadCard = async function (alt, jpeg) {
		await flushRender();
		var artistMissing = (card.infoArtist || '').replace(/ /g, '') === '' && card.artSource && card.artSource.indexOf('/img/blank.png') === -1 && card.artZoom != 0;
		if (artistMissing) notify('Tip: credit the artist in the Art tab.', 4);
		var name = getCardName() || 'card';
		var blob = await canvasToBlob(exportCanvas(), jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.92 : undefined);
		await saveBlob(name + (jpeg ? '.jpg' : '.png'), blob);
	};
	window.renderCurrentCard = async function () {
		await flushRender();
		var full = exportCanvas();
		var image = await canvasToBlob(full, 'image/jpeg', 0.95);
		var t = document.createElement('canvas');
		t.width = 320;
		t.height = Math.round(320 * full.height / full.width);
		var tctx = t.getContext('2d');
		tctx.imageSmoothingQuality = 'high';
		tctx.drawImage(full, 0, 0, t.width, t.height);
		return { image: image, thumb: t.toDataURL('image/jpeg', 0.85) };
	};

	/* ------------------------------------------------------------------
	 * Art: drag, pinch-zoom and trackpad zoom on the preview
	 * ------------------------------------------------------------------ */
	function cardPerScreenPixel() {
		var rect = previewCanvas.getBoundingClientRect();
		var shown = rotation % 180 === 0 ? rect.width : rect.height;
		return cardCanvas.width / shown;
	}
	function screenDeltaToCard(dx, dy) {
		var lx, ly;
		switch (rotation) {
			case 90: lx = dy; ly = -dx; break;
			case 180: lx = -dx; ly = -dy; break;
			case 270: lx = -dy; ly = dx; break;
			default: lx = dx; ly = dy;
		}
		var k = cardPerScreenPixel();
		lx *= k; ly *= k;
		if (card.landscape) { var t = lx; lx = -ly; ly = t; }
		return [lx, ly];
	}
	function screenPointToCard(px, py) {
		var rect = previewCanvas.getBoundingClientRect();
		var u = (px - rect.left) / rect.width, v = (py - rect.top) / rect.height, cu, cv;
		switch (rotation) {
			case 90: cu = v; cv = 1 - u; break;
			case 180: cu = 1 - u; cv = 1 - v; break;
			case 270: cu = 1 - v; cv = u; break;
			default: cu = u; cv = v;
		}
		return [cu * cardCanvas.width - card.marginX * card.width, cv * cardCanvas.height - card.marginY * card.height];
	}
	function readArt() {
		return {
			x: parseFloat($('#art-x').value) || 0, y: parseFloat($('#art-y').value) || 0,
			zoom: parseFloat($('#art-zoom').value) || 100, rotate: parseFloat($('#art-rotate').value) || 0
		};
	}
	function writeArt(a) {
		$('#art-x').value = Math.round(a.x);
		$('#art-y').value = Math.round(a.y);
		$('#art-zoom').value = Math.round(a.zoom * 10) / 10;
		$('#art-rotate').value = Math.round(a.rotate * 10) / 10;
		artEdited();
	}
	function zoomArtAround(start, factor, point) {
		var z = Math.max(0.5, start.zoom * factor);
		var f = z / start.zoom;
		writeArt({ x: point[0] - (point[0] - start.x) * f, y: point[1] - (point[1] - start.y) * f, zoom: z, rotate: start.rotate });
	}
	function initArtGestures() {
		previewCanvas.onmousedown = previewCanvas.onmousemove = previewCanvas.onmouseout = previewCanvas.onmouseup = null;
		var pointers = new Map();
		var gesture = null;
		function begin() {
			var pts = Array.from(pointers.values());
			gesture = { art: readArt(), pts: pts.map(function (p) { return { x: p.x, y: p.y }; }) };
			if (pts.length >= 2) {
				gesture.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
				gesture.mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
			}
		}
		previewCanvas.addEventListener('pointerdown', function (e) {
			if (e.button !== undefined && e.button > 0) return;
			e.preventDefault();
			try { previewCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			begin();
		});
		var frameQueued = false, lastMove = null;
		previewCanvas.addEventListener('pointermove', function (e) {
			if (!pointers.has(e.pointerId) || !gesture) return;
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			lastMove = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
			if (frameQueued) return;
			frameQueued = true;
			requestAnimationFrame(function () {
				frameQueued = false;
				if (!gesture) return;
				var pts = Array.from(pointers.values());
				if (pts.length >= 2 && gesture.dist) {
					var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
					var mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
					var d = screenDeltaToCard(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
					var start = { x: gesture.art.x + d[0], y: gesture.art.y + d[1], zoom: gesture.art.zoom, rotate: gesture.art.rotate };
					zoomArtAround(start, dist / gesture.dist, screenPointToCard(mid[0], mid[1]));
				} else if (pts.length === 1) {
					var p = pts[0], s = gesture.pts[0];
					if (lastMove.shift) {
						writeArt({ x: gesture.art.x, y: gesture.art.y, zoom: gesture.art.zoom * Math.pow(1.002, s.y - p.y), rotate: gesture.art.rotate });
					} else if (lastMove.ctrl) {
						writeArt({ x: gesture.art.x, y: gesture.art.y, zoom: gesture.art.zoom, rotate: (gesture.art.rotate - (s.y - p.y) / 10) % 360 });
					} else {
						var dd = screenDeltaToCard(p.x - s.x, p.y - s.y);
						writeArt({ x: gesture.art.x + dd[0], y: gesture.art.y + dd[1], zoom: gesture.art.zoom, rotate: gesture.art.rotate });
					}
				}
			});
		});
		function end(e) {
			if (!pointers.has(e.pointerId)) return;
			pointers.delete(e.pointerId);
			if (pointers.size) begin(); else gesture = null;
		}
		previewCanvas.addEventListener('pointerup', end);
		previewCanvas.addEventListener('pointercancel', end);
		previewCanvas.addEventListener('wheel', function (e) {
			if (!e.ctrlKey && !e.altKey) return; // trackpad pinch sends ctrl+wheel
			e.preventDefault();
			zoomArtAround(readArt(), Math.pow(0.998, e.deltaY), screenPointToCard(e.clientX, e.clientY));
		}, { passive: false });
	}

	/* ------------------------------------------------------------------
	 * Text: quick symbol bar
	 * ------------------------------------------------------------------ */
	function initSymbolBar() {
		var bar = $('#symbol-bar');
		var symbols = ['w', 'u', 'b', 'r', 'g', 'c', 'x', '1', '2', '3', '4', '5', 't', 'untap', 's', 'e'];
		symbols.forEach(function (s) {
			var b = document.createElement('button');
			b.type = 'button';
			b.title = '{' + s + '}';
			var img = document.createElement('img');
			img.alt = s;
			img.src = '/img/manaSymbols/' + s + '.svg';
			b.appendChild(img);
			b.onclick = function () { insertText('{' + s + '}'); };
			bar.appendChild(b);
		});
		[['{flavor}', 'Flavor'], ['{-}', '—'], ['{i}', 'i'], ['{/i}', '/i'], ['~', '~']].forEach(function (t) {
			var b = document.createElement('button');
			b.type = 'button';
			b.title = t[0];
			b.innerHTML = '<span class="txt">' + escapeHtml(t[1]) + '</span>';
			b.onclick = function () { insertText(t[0]); };
			bar.appendChild(b);
		});
	}
	function insertText(str) {
		var ta = $('#text-editor');
		var s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
		ta.value = ta.value.slice(0, s) + str + ta.value.slice(e);
		ta.selectionStart = ta.selectionEnd = s + str.length;
		ta.focus();
		textEdited();
	}

	/* ------------------------------------------------------------------
	 * Watermark gallery
	 * ------------------------------------------------------------------ */
	var watermarks = [];
	function initWatermarks() {
		var group = 'General';
		var groups = [];
		$$('#watermark-lore option').forEach(function (o) {
			if (o.disabled) { group = o.textContent; groups.push(group); return; }
			watermarks.push({ name: o.textContent, src: o.value, group: group });
		});
		var cat = $('#watermark-category');
		cat.innerHTML = '<option value="">None</option>' + groups.map(function (g) { return '<option>' + escapeHtml(g) + '</option>'; }).join('') +
			'<option value="__sets">Set symbols (by set code)</option>';
		renderWatermarkGallery();
	}
	window.renderWatermarkGallery = function () {
		var q = ($('#watermark-search').value || '').trim().toLowerCase();
		var cat = $('#watermark-category').value;
		var list = [];
		if (cat !== '__sets') {
			list = watermarks.filter(function (w) {
				if (cat && w.group !== cat) return false;
				return !q || w.name.toLowerCase().indexOf(q) !== -1 || w.group.toLowerCase().indexOf(q) !== -1;
			});
		}
		var codes = (window.CS_DATA && CS_DATA.keyrune) || [];
		if (cat === '__sets' || (q && !cat)) {
			var sets = codes.filter(function (c) { return !q || c.indexOf(q) === 0; });
			if (cat !== '__sets') sets = sets.slice(0, 40);
			list = list.concat(sets.map(function (c) { return { name: c.toUpperCase(), src: '/img/keyrune/' + c + '.svg', group: 'Set symbols' }; }));
		}
		var grid = $('#watermark-gallery');
		grid.innerHTML = '';
		if (!list.length) {
			grid.innerHTML = '<p class="hint">No watermark found.</p>';
			return;
		}
		var frag = document.createDocumentFragment();
		list.forEach(function (w) {
			var b = document.createElement('button');
			b.type = 'button';
			b.className = 'watermark-item';
			b.title = w.group + ' — ' + w.name;
			var img = document.createElement('img');
			img.loading = 'lazy';
			img.alt = '';
			img.src = w.src;
			var span = document.createElement('span');
			span.textContent = w.name;
			b.appendChild(img);
			b.appendChild(span);
			b.onclick = function () {
				$$('.watermark-item.selected').forEach(function (x) { x.classList.remove('selected'); });
				b.classList.add('selected');
				getSetSymbolWatermark(w.src);
			};
			frag.appendChild(b);
		});
		grid.appendChild(frag);
	};

	/* ------------------------------------------------------------------
	 * Loading a card object into the editor (shared by gallery, presets,
	 * imports and autosave). Mirrors the engine's loadCard().
	 * ------------------------------------------------------------------ */
	window.loadCardFromObject = async function (obj) {
		if (!obj) return;
		$('#frame-list').innerHTML = null;
		card = JSON.parse(JSON.stringify(obj));
		card.text = card.text || {};
		card.frames = card.frames || [];
		card.manaSymbols = card.manaSymbols || [];
		$('#info-number').value = card.infoNumber || '';
		$('#info-rarity').value = card.infoRarity || '';
		$('#info-set').value = card.infoSet || '';
		$('#info-language').value = card.infoLanguage || '';
		$('#info-note').value = card.infoNote || '';
		$('#info-year').value = card.infoYear || new Date().getFullYear();
		artistEdited(card.infoArtist || '');
		var textKeys = Object.keys(card.text);
		if (textKeys.length) {
			if (selectedTextIndex >= textKeys.length) selectedTextIndex = 0;
			$('#text-editor').value = card.text[textKeys[selectedTextIndex]].text || '';
			$('#text-editor-font-size').value = card.text[textKeys[selectedTextIndex]].fontSize || 0;
			loadTextOptions(card.text);
		} else {
			$('#text-options').innerHTML = '';
			$('#text-editor').value = '';
		}
		$('#art-x').value = scaleX(card.artX) - scaleWidth(card.marginX);
		$('#art-y').value = scaleY(card.artY) - scaleHeight(card.marginY);
		$('#art-zoom').value = card.artZoom * 100;
		$('#art-rotate').value = card.artRotate || 0;
		uploadArt(card.artSource);
		$('#setSymbol-x').value = scaleX(card.setSymbolX) - scaleWidth(card.marginX);
		$('#setSymbol-y').value = scaleY(card.setSymbolY) - scaleHeight(card.marginY);
		$('#setSymbol-zoom').value = card.setSymbolZoom * 100;
		uploadSetSymbol(card.setSymbolSource);
		$('#watermark-x').value = scaleX(card.watermarkX) - scaleWidth(card.marginX);
		$('#watermark-y').value = scaleY(card.watermarkY) - scaleHeight(card.marginY);
		$('#watermark-zoom').value = card.watermarkZoom * 100;
		$('#watermark-opacity').value = card.watermarkOpacity * 100;
		$('#rounded-corners').checked = !card.noCorners;
		uploadWatermark(card.watermarkSource);
		$('#serial-number').value = card.serialNumber || '';
		$('#serial-total').value = card.serialTotal || '';
		$('#serial-x').value = card.serialX || 172;
		$('#serial-y').value = card.serialY || 1383;
		$('#serial-scale').value = card.serialScale || 1;
		serialInfoEdited();
		card.frames.reverse();
		card.frames.forEach(function (item) { addFrame([], item); });
		card.frames.reverse();
		if (card.onload) await loadScript(card.onload);
		card.manaSymbols.forEach(function (item) { loadScript(item); });
		var resized = false;
		canvasList.forEach(function (name) {
			var c = window[name + 'Canvas'];
			if (c.width != card.width * (1 + card.marginX) || c.height != card.height * (1 + card.marginY)) {
				sizeCanvas(name);
				resized = true;
			}
		});
		if (resized) {
			drawTextBuffer();
			drawFrames();
			bottomInfoEdited();
			watermarkEdited();
		}
		applyRotation(card.csRotation || 0);
	};

	/* ------------------------------------------------------------------
	 * Autosave of the card being edited
	 * ------------------------------------------------------------------ */
	var autosaveTimer = null, lastAutosave = '', autosaveReady = false;
	function scheduleAutosave() {
		if (!autosaveReady) return;
		clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(doAutosave, 1500);
	}
	function doAutosave() {
		var json;
		try { json = JSON.stringify(serializeCard()); } catch (e) { return; }
		if (json === lastAutosave) return;
		lastAutosave = json;
		CardStore.setState('autosave', { json: json, key: window.currentCardKey || null, time: Date.now() }).catch(function () {});
	}
	window.addEventListener('pagehide', function () { if (autosaveReady) doAutosave(); });
	document.addEventListener('visibilitychange', function () { if (document.hidden && autosaveReady) doAutosave(); });

	window.newCard = async function (action) {
		if (action !== 'cardback' && !(await dialogConfirm('Start a new card', 'The current card will be cleared (save it to your gallery first if you want to keep it).', 'New card'))) return;
		autosaveReady = false;
		clearTimeout(autosaveTimer);
		await CardStore.delState('autosave').catch(function () {});
		try { sessionStorage.setItem('cs-after-load', action || 'new'); } catch (e) { /* ignore */ }
		location.reload();
	};
	window.createCardBack = async function () {
		var r = await dialog({
			title: 'Create card back',
			text: 'Save the current card (the front) to your gallery before starting its back?',
			ok: 'Save, then create back', extra: 'Create back without saving', cancel: 'Cancel'
		});
		if (r === null) return;
		if (r !== 'extra') {
			var key = await saveToGallery();
			if (!key) return;
		}
		newCard('cardback');
	};
	async function applyCardBack() {
		var group = $('#selectFrameGroup');
		group.value = 'Misc-2';
		await loadScript('/js/frames/groupMisc-2.js');
		await waitFor(function () { return pendingScripts === 0; });
		var pack = $('#selectFramePack');
		pack.value = 'Cardback';
		await loadScript('/js/frames/packCardback.js');
		await waitFor(function () { return availableFrames[0] && availableFrames[0].name === 'Cardback' && $('#frame-picker .frame-option'); });
		if (card.version !== 'cardback') $('#loadFrameVersion').click();
		await waitFor(function () { return card.version === 'cardback'; }, 4000).catch(function () {});
		addFrame();
		notify('Card back ready: change the art, frame or text as you like.', 4);
	}

	/* ------------------------------------------------------------------
	 * Gallery, presets and print list
	 * ------------------------------------------------------------------ */
	async function getCategories() {
		var list = await CardStore.all();
		var set = {};
		list.forEach(function (e) { if (e.category) set[e.category] = 1; });
		return Object.keys(set).sort();
	}
	function fillCategorySelect(select, cats, label) {
		var v = select.value;
		select.innerHTML = '<option value="">' + label + '</option>' + cats.map(function (c) { return '<option>' + escapeHtml(c) + '</option>'; }).join('');
		if (cats.indexOf(v) !== -1) select.value = v;
	}
	window.saveToGallery = async function () {
		var answer = await askCardName(getCardName());
		if (!answer) return null;
		var data = serializeCard();
		var renders = await renderCurrentCard();
		await CardStore.put({ key: answer.name, data: data, category: answer.category, updated: Date.now(), image: renders.image, thumb: renders.thumb });
		window.currentCardKey = answer.name;
		await loadAvailableCards();
		notify('Gallery updated: "' + answer.name + '".', 3);
		return answer.name;
	};
	var galleryUrls = [];
	window.renderGallery = async function () {
		var list = await CardStore.all();
		fillCategorySelect($('#gallery-category'), await getCategories(), 'All categories');
		var q = ($('#gallery-search').value || '').trim().toLowerCase();
		var cat = $('#gallery-category').value;
		list = list.filter(function (e) {
			return (!cat || e.category === cat) && (!q || e.key.toLowerCase().indexOf(q) !== -1 || (e.category || '').toLowerCase().indexOf(q) !== -1);
		});
		var grid = $('#gallery-grid');
		grid.innerHTML = '';
		$('#gallery-empty').classList.toggle('hidden', list.length > 0);
		list.forEach(function (e) {
			var div = document.createElement('div');
			div.className = 'gallery-card';
			var img = document.createElement('img');
			img.alt = e.key;
			img.src = e.thumb || '/img/blank.png';
			img.onclick = function () { openFromGallery(e.key); };
			var h = document.createElement('h4');
			h.textContent = e.key;
			var meta = document.createElement('div');
			meta.className = 'meta';
			meta.textContent = (e.category ? e.category + ' · ' : '') + (e.updated ? new Date(e.updated).toLocaleDateString() : '') + (e.thumb ? '' : ' · open & save to render');
			var row = document.createElement('div');
			row.className = 'row';
			row.innerHTML = '<button class="input btn-red">Edit</button><button class="input btn-red">Image</button><button class="input btn-red">Delete</button>';
			var btns = row.querySelectorAll('button');
			btns[0].onclick = function () { openFromGallery(e.key); };
			btns[1].disabled = !e.image;
			btns[1].onclick = function () { saveBlob(e.key + '.jpg', e.image); };
			btns[2].onclick = async function () {
				if (!(await dialogConfirm('Delete card', 'Delete "' + e.key + '" from your gallery?', 'Delete'))) return;
				await CardStore.remove(e.key);
				if (window.currentCardKey === e.key) window.currentCardKey = null;
				loadAvailableCards();
				renderGallery();
			};
			div.appendChild(img);
			div.appendChild(h);
			div.appendChild(meta);
			div.appendChild(row);
			grid.appendChild(div);
		});
	};
	async function openFromGallery(key) {
		showView('editor');
		await loadCard(key);
	}
	window.refreshPresetList = async function () {
		var cats = await getCategories();
		var catSel = $('#preset-category');
		fillCategorySelect(catSel, cats, 'All categories');
		var list = await CardStore.all();
		var cat = catSel.value;
		var sel = $('#preset-card');
		sel.innerHTML = '<option value="" disabled selected>Choose a card...</option>';
		list.filter(function (e) { return !cat || e.category === cat; }).forEach(function (e) {
			var o = document.createElement('option');
			o.value = e.key;
			o.textContent = e.key + (e.category ? ' (' + e.category + ')' : '');
			sel.appendChild(o);
		});
	};
	window.loadPreset = async function (key) {
		var entry = await CardStore.get(key);
		if (!entry) return;
		window.currentCardKey = null; // saving creates a new card, the preset stays untouched
		await loadCardFromObject(entry.data);
		notify('Preset loaded: "' + key + '". Save it under a new name to keep the original.', 4);
	};
	document.addEventListener('cards-changed', function () { refreshPresetList(); });

	window.renderPrintList = async function () {
		var list = (await CardStore.all()).filter(function (e) { return e.image; });
		galleryUrls.forEach(URL.revokeObjectURL);
		galleryUrls = [];
		var box = $('#print-list');
		box.innerHTML = list.length ? '' : '<p class="hint">Save cards to your gallery first (the Print tool uses the images saved with them).</p>';
		list.forEach(function (e) {
			var div = document.createElement('div');
			div.className = 'print-item';
			var img = document.createElement('img');
			img.src = e.thumb || '';
			var label = document.createElement('label');
			label.innerHTML = '<span></span><input class="input" type="number" min="0" max="99" value="0">';
			label.querySelector('span').textContent = e.key;
			label.querySelector('input').dataset.key = e.key;
			div.appendChild(img);
			div.appendChild(label);
			box.appendChild(div);
		});
	};

	/* ------------------------------------------------------------------
	 * Mobile mini preview
	 * ------------------------------------------------------------------ */
	function paintMiniPreview() {
		var c = $('#mini-preview-canvas');
		if (c.width !== Math.round(previewCanvas.width / 2.5) || c.height !== Math.round(previewCanvas.height / 2.5)) {
			c.width = Math.round(previewCanvas.width / 2.5);
			c.height = Math.round(previewCanvas.height / 2.5);
		}
		var ctx = c.getContext('2d');
		ctx.clearRect(0, 0, c.width, c.height);
		ctx.drawImage(previewCanvas, 0, 0, c.width, c.height);
	}
	window.toggleMiniPreview = function () {
		var mp = $('#mini-preview');
		mp.classList.toggle('hidden');
		if (!mp.classList.contains('hidden')) paintMiniPreview();
	};
	// Hide the floating preview while the real card is visible on screen.
	if ('IntersectionObserver' in window) {
		new IntersectionObserver(function (entries) {
			var visible = entries[0].isIntersecting;
			$('#mini-preview-toggle').style.opacity = visible ? '0' : '';
			$('#mini-preview-toggle').style.pointerEvents = visible ? 'none' : '';
			if (visible) $('#mini-preview').classList.add('hidden');
		}, { threshold: 0.25 }).observe(previewCanvas);
	}

	/* ------------------------------------------------------------------
	 * Fonts: make sure card fonts are ready before drawing text
	 * ------------------------------------------------------------------ */
	function preloadCardFonts() {
		if (!document.fonts || !document.fonts.load) return Promise.resolve();
		var fams = ['belerenb', 'belerenbsc', 'mplantin', 'mplantini', 'gothammedium', 'gothambold', 'matrix', 'matrixb', 'plantinsemibold'];
		return Promise.all(fams.map(function (f) { return document.fonts.load('40px "' + f + '"').catch(function () {}); }));
	}

	/* ------------------------------------------------------------------
	 * Init
	 * ------------------------------------------------------------------ */
	async function init() {
		var after = null;
		try { after = sessionStorage.getItem('cs-after-load'); sessionStorage.removeItem('cs-after-load'); } catch (e) { /* ignore */ }

		toggleCardBackgroundColor($('#highlight-transparencies').checked = lsGet('cs-transparency') !== '0');
		$('#show-legal-lines').checked = lsGet('cs-legal-lines') !== '0';
		initArtGestures();
		initSymbolBar();
		initWatermarks();
		var dl = $('#set-code-list');
		((window.CS_DATA && CS_DATA.setCodes) || []).forEach(function (c) { var o = document.createElement('option'); o.value = c; dl.appendChild(o); });
		$('#autoLoadFrameVersion').checked = lsGet('autoLoadFrameVersion') !== 'false';

		await migrateLocalStorageCards().catch(function () {});
		await loadAvailableCards();
		await preloadCardFonts();

		// wait for the default frame pack to be ready
		await waitFor(function () { return $('#frame-picker .frame-option') && card.text && pendingScripts === 0; }, 10000).catch(function () {});
		drawTextBuffer();
		bottomInfoEdited();

		if (after === 'cardback') {
			await applyCardBack().catch(function (e) { notify('Could not set up the card back: ' + e.message, 6); });
		} else if (after !== 'new') {
			var saved = await CardStore.getState('autosave').catch(function () { return null; });
			if (saved && saved.json) {
				try {
					window.currentCardKey = saved.key || null;
					lastAutosave = saved.json;
					await loadCardFromObject(JSON.parse(saved.json));
				} catch (e) { console.warn('autosave restore failed', e); }
			}
		}
		autosaveReady = true;
		var view = (location.hash || '').replace('#', '');
		if (view === 'gallery' || view === 'print') showView(view);
		document.documentElement.classList.add('ready');
		if (!window.isApp && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== '127.0.0.1') {
			navigator.serviceWorker.register('/sw.js').catch(function () {});
		}
	}
	init();
})();
