// "Print PDF": lays out gallery cards at real size (63 x 88 mm) on A4/Letter pages.
// Small self-contained PDF writer: card images are embedded as JPEG (DCTDecode).
(function () {
	'use strict';
	var MM = 72 / 25.4;
	var PAPER = { a4: [210, 297], letter: [215.9, 279.4] };

	function jpegSize(bytes) {
		var i = 2;
		while (i < bytes.length) {
			if (bytes[i] !== 0xFF) { i++; continue; }
			var marker = bytes[i + 1];
			var len = (bytes[i + 2] << 8) | bytes[i + 3];
			if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
				return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
			}
			i += 2 + len;
		}
		throw new Error('Unreadable JPEG');
	}

	function PdfWriter() {
		this.chunks = [];
		this.length = 0;
		this.offsets = [];
		this.enc = new TextEncoder();
	}
	PdfWriter.prototype.raw = function (data) {
		var bytes = typeof data === 'string' ? this.enc.encode(data) : data;
		this.chunks.push(bytes);
		this.length += bytes.length;
	};
	PdfWriter.prototype.obj = function (id, body, stream) {
		this.offsets[id] = this.length;
		this.raw(id + ' 0 obj\n' + body + '\n');
		if (stream) {
			this.raw('stream\n');
			this.raw(stream);
			this.raw('\nendstream\n');
		}
		this.raw('endobj\n');
	};

	function f(n) { return (Math.round(n * 1000) / 1000).toString(); }

	async function buildPdf(items, opts) {
		var paper = PAPER[opts.paper] || PAPER.a4;
		var pageW = paper[0] * MM, pageH = paper[1] * MM;
		var cw = 63 * MM, ch = 88 * MM, gap = opts.gap * MM, bleed = opts.bleed * MM;
		var margin = 5 * MM;
		var cols = Math.max(1, Math.floor((pageW - 2 * margin + gap) / (cw + gap)));
		var rows = Math.max(1, Math.floor((pageH - 2 * margin + gap) / (ch + gap)));
		var gridW = cols * cw + (cols - 1) * gap, gridH = rows * ch + (rows - 1) * gap;
		var x0 = (pageW - gridW) / 2, y0 = (pageH - gridH) / 2;
		var perPage = cols * rows;

		// unique images
		var images = [], byKey = {};
		for (var i = 0; i < items.length; i++) {
			var it = items[i];
			if (!byKey[it.key]) {
				var bytes = new Uint8Array(await it.blob.arrayBuffer());
				var size = jpegSize(bytes);
				byKey[it.key] = { name: 'Im' + images.length, bytes: bytes, w: size.width, h: size.height };
				images.push(byKey[it.key]);
			}
		}
		var pages = [];
		for (var p = 0; p < items.length; p += perPage) pages.push(items.slice(p, p + perPage));

		var pdf = new PdfWriter();
		pdf.raw('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
		var nextId = 3;
		images.forEach(function (im) { im.id = nextId++; });
		var pageIds = pages.map(function () { var ids = { page: nextId, content: nextId + 1 }; nextId += 2; return ids; });

		pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
		pdf.obj(2, '<< /Type /Pages /Kids [' + pageIds.map(function (x) { return x.page + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>');
		images.forEach(function (im) {
			pdf.obj(im.id, '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
				' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>', im.bytes);
		});
		var xobjects = '<< ' + images.map(function (im) { return '/' + im.name + ' ' + im.id + ' 0 R'; }).join(' ') + ' >>';

		pages.forEach(function (list, pi) {
			var s = [];
			list.forEach(function (it, idx) {
				var col = idx % cols, row = Math.floor(idx / cols);
				var x = x0 + col * (cw + gap);
				var y = pageH - y0 - (row + 1) * ch - row * gap;
				var im = byKey[it.key];
				if (bleed > 0) s.push('0 0 0 rg ' + f(x - bleed) + ' ' + f(y - bleed) + ' ' + f(cw + 2 * bleed) + ' ' + f(ch + 2 * bleed) + ' re f');
				s.push('q');
				if (im.w > im.h) {
					// landscape image (rotated card): turn it to fit the portrait slot
					s.push('0 ' + f(ch) + ' ' + f(-cw) + ' 0 ' + f(x + cw) + ' ' + f(y) + ' cm');
				} else {
					s.push(f(cw) + ' 0 0 ' + f(ch) + ' ' + f(x) + ' ' + f(y) + ' cm');
				}
				s.push('/' + im.name + ' Do Q');
			});
			if (opts.marks) {
				var len = 4 * MM, off = Math.max(1 * MM, bleed + 0.5 * MM);
				s.push('0.4 w 0 0 0 RG');
				var xs = [], ys = [];
				for (var c = 0; c < cols; c++) { xs.push(x0 + c * (cw + gap)); xs.push(x0 + c * (cw + gap) + cw); }
				for (var r = 0; r < rows; r++) { var yy = pageH - y0 - (r + 1) * ch - r * gap; ys.push(yy); ys.push(yy + ch); }
				var top = pageH - y0, bottom = pageH - y0 - gridH, left = x0, right = x0 + gridW;
				xs.forEach(function (x) {
					s.push(f(x) + ' ' + f(top + off) + ' m ' + f(x) + ' ' + f(top + off + len) + ' l S');
					s.push(f(x) + ' ' + f(bottom - off) + ' m ' + f(x) + ' ' + f(bottom - off - len) + ' l S');
				});
				ys.forEach(function (y) {
					s.push(f(left - off) + ' ' + f(y) + ' m ' + f(left - off - len) + ' ' + f(y) + ' l S');
					s.push(f(right + off) + ' ' + f(y) + ' m ' + f(right + off + len) + ' ' + f(y) + ' l S');
				});
			}
			var content = new TextEncoder().encode(s.join('\n'));
			pdf.obj(pageIds[pi].page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pageW) + ' ' + f(pageH) + '] /Resources << /XObject ' + xobjects + ' >> /Contents ' + pageIds[pi].content + ' 0 R >>');
			pdf.obj(pageIds[pi].content, '<< /Length ' + content.length + ' >>', content);
		});

		var xref = pdf.length;
		var lines = ['xref', '0 ' + nextId, '0000000000 65535 f '];
		for (var id = 1; id < nextId; id++) lines.push(String(pdf.offsets[id]).padStart(10, '0') + ' 00000 n ');
		pdf.raw(lines.join('\n') + '\ntrailer\n<< /Size ' + nextId + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
		return new Blob(pdf.chunks, { type: 'application/pdf' });
	}
	window.buildPdf = buildPdf;

	window.makePrintPdf = async function () {
		var inputs = Array.prototype.slice.call(document.querySelectorAll('#print-list input[data-key]'));
		var items = [];
		for (var i = 0; i < inputs.length; i++) {
			var n = Math.min(99, parseInt(inputs[i].value, 10) || 0);
			if (!n) continue;
			var entry = await CardStore.get(inputs[i].dataset.key);
			if (!entry || !entry.image) continue;
			for (var k = 0; k < n; k++) items.push({ key: entry.key, blob: entry.image });
		}
		if (!items.length) { notify('Set the number of copies for at least one card.', 4); return; }
		var pdf = await buildPdf(items, {
			paper: document.querySelector('#print-paper').value,
			gap: Math.max(0, parseFloat(document.querySelector('#print-gap').value) || 0),
			bleed: Math.max(0, Math.min(3, parseFloat(document.querySelector('#print-bleed').value) || 0)),
			marks: document.querySelector('#print-marks').checked
		});
		await saveBlob('cards-to-print.pdf', pdf);
	};
})();
