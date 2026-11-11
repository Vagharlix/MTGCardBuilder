// Card storage in IndexedDB (no 5 MB localStorage limit).
// Replaces the engine's localStorage-based save/load functions while keeping
// the same ".cardconjurer" export format, so files can move between apps.
(function () {
	'use strict';
	var DB_NAME = 'card-studio';
	var DB_VERSION = 1;
	var dbPromise = null;

	function openDb() {
		if (dbPromise) return dbPromise;
		dbPromise = new Promise(function (resolve, reject) {
			var req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = function () {
				var db = req.result;
				if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'key' });
				if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
			};
			req.onsuccess = function () { resolve(req.result); };
			req.onerror = function () { reject(req.error); };
		});
		return dbPromise;
	}
	function tx(store, mode, fn) {
		return openDb().then(function (db) {
			return new Promise(function (resolve, reject) {
				var t = db.transaction(store, mode);
				var s = t.objectStore(store);
				var result = fn(s);
				t.oncomplete = function () { resolve(result && 'result' in result ? result.result : result); };
				t.onerror = function () { reject(t.error); };
				t.onabort = function () { reject(t.error); };
			});
		});
	}

	var Store = {
		all: function () {
			return tx('cards', 'readonly', function (s) { return s.getAll(); }).then(function (list) {
				return (list || []).sort(function (a, b) { return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }); });
			});
		},
		get: function (key) { return tx('cards', 'readonly', function (s) { return s.get(key); }); },
		put: function (entry) { return tx('cards', 'readwrite', function (s) { s.put(entry); }); },
		remove: function (key) { return tx('cards', 'readwrite', function (s) { s.delete(key); }); },
		clear: function () { return tx('cards', 'readwrite', function (s) { s.clear(); }); },
		keys: function () { return tx('cards', 'readonly', function (s) { return s.getAllKeys(); }); },
		getState: function (k) { return tx('state', 'readonly', function (s) { return s.get(k); }); },
		setState: function (k, v) { return tx('state', 'readwrite', function (s) { s.put(v, k); }); },
		delState: function (k) { return tx('state', 'readwrite', function (s) { s.delete(k); }); }
	};
	window.CardStore = Store;

	// Serializable copy of the current card (same as the engine's saveCard).
	window.serializeCard = function () {
		var copy = JSON.parse(JSON.stringify(card));
		(copy.frames || []).forEach(function (frame) {
			delete frame.image;
			(frame.masks || []).forEach(function (mask) { delete mask.image; });
		});
		return copy;
	};

	function uniqueKey(key, existing) {
		var base = key, n = 1;
		while (existing.indexOf(key) !== -1) { key = base + ' (' + n + ')'; n++; }
		return key;
	}
	window.uniqueCardKey = uniqueKey;

	// ---- engine overrides ----
	window.loadAvailableCards = function () {
		return Store.all().then(function (list) {
			var select = document.querySelector('#load-card-options');
			if (select) {
				select.innerHTML = '<option selected="selected" disabled>None selected</option>';
				list.forEach(function (entry) {
					var o = document.createElement('option');
					o.textContent = entry.key;
					o.value = entry.key;
					select.appendChild(o);
				});
			}
			document.dispatchEvent(new CustomEvent('cards-changed', { detail: list }));
			return list;
		});
	};

	// saveCard(): Import/Preset tab "Save Card" and file imports.
	window.saveCard = async function (saveFromFile) {
		var keys = await Store.keys();
		var cardKey, data, category = '';
		if (saveFromFile) {
			cardKey = String(saveFromFile.key || 'Imported card').trim();
			data = saveFromFile.data;
			cardKey = uniqueKey(cardKey, keys);
		} else {
			var answer = await askCardName(getCardName());
			if (!answer) return null;
			cardKey = answer.name;
			category = answer.category;
			if (keys.indexOf(cardKey) !== -1) {
				var overwrite = await dialogConfirm('Overwrite?', 'A card is already saved as "' + cardKey + '".\nOverwrite it? (Cancel adds a version number.)', 'Overwrite');
				if (!overwrite) cardKey = uniqueKey(cardKey, keys);
			}
			data = serializeCard();
		}
		var entry = { key: cardKey, data: data, category: category, updated: Date.now() };
		if (!saveFromFile) {
			var renders = await renderCurrentCard();
			entry.thumb = renders.thumb;
			entry.image = renders.image;
		} else {
			var previous = await Store.get(cardKey);
			if (previous && previous.category) entry.category = previous.category;
		}
		await Store.put(entry);
		window.currentCardKey = saveFromFile ? window.currentCardKey : cardKey;
		await loadAvailableCards();
		if (!saveFromFile) notify('Saved "' + cardKey + '" to your gallery.', 3);
		return cardKey;
	};

	window.loadCard = async function (selectedCardKey) {
		var entry = await Store.get(selectedCardKey);
		if (!entry) { notify(selectedCardKey + ' failed to load.', 5); return; }
		window.currentCardKey = entry.key;
		await loadCardFromObject(entry.data);
	};

	window.deleteCard = async function () {
		var key = document.querySelector('#load-card-options').value;
		if (!key || key === 'None selected') return;
		if (!(await dialogConfirm('Delete card', 'Delete "' + key + '"?', 'Delete'))) return;
		await Store.remove(key);
		if (window.currentCardKey === key) window.currentCardKey = null;
		loadAvailableCards();
	};

	window.deleteSavedCards = async function () {
		var ok = await dialogConfirm('Delete ALL saved cards',
			'All of your saved cards will be deleted. Export them first if you want to keep them.\nThis cannot be undone.', 'Delete all');
		if (!ok) return;
		await Store.clear();
		window.currentCardKey = null;
		loadAvailableCards();
	};

	window.downloadSavedCards = async function () {
		var list = await Store.all();
		if (!list.length) { notify('No saved cards to export.', 3); return; }
		var out = list.map(function (e) { return { key: e.key, data: e.data, category: e.category || undefined }; });
		saveBlob('saved-cards.cardconjurer', new Blob([JSON.stringify(out)], { type: 'application/json' }));
	};

	window.uploadSavedCards = function (event) {
		var file = event.target.files && event.target.files[0];
		if (!file) return;
		var reader = new FileReader();
		reader.onload = async function () {
			var items;
			try { items = JSON.parse(reader.result); } catch (e) { notify('This file is not a saved cards file.', 5); return; }
			if (!Array.isArray(items)) items = [items];
			var count = 0;
			for (var i = 0; i < items.length; i++) {
				var it = items[i];
				if (!it || !it.data) continue;
				var key = await saveCard({ key: it.key, data: it.data });
				if (key && it.category) {
					var entry = await Store.get(key);
					entry.category = it.category;
					await Store.put(entry);
				}
				count++;
			}
			event.target.value = '';
			await loadAvailableCards();
			notify('Imported ' + count + ' card' + (count === 1 ? '' : 's') + '. Open them from the Gallery.', 4);
		};
		reader.readAsText(file);
	};

	// One-time migration of cards saved by the engine in localStorage.
	window.migrateLocalStorageCards = async function () {
		var keys;
		try { keys = JSON.parse(localStorage.getItem('cardKeys') || '[]'); } catch (e) { keys = []; }
		if (!keys.length) return;
		for (var i = 0; i < keys.length; i++) {
			try {
				var data = JSON.parse(localStorage.getItem(keys[i]));
				if (data) await saveCard({ key: keys[i], data: data });
				localStorage.removeItem(keys[i]);
			} catch (e) { /* skip broken entry */ }
		}
		localStorage.setItem('cardKeys', '[]');
	};
})();
