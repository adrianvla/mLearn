// Contract
// - Attach dragover/dragenter/leave/drop to the provided document `d`
// - Accept drops of: a single PDF file OR a folder (or multiple) containing images
// - Convert PDF pages to images (PNG) using pdf.js (loaded at runtime from node_modules)
// - Traverse dropped directories recursively and collect image files
// - Sort images by name (natural sort) for folders; keep page order for PDFs
// - Emit a CustomEvent "reader:images-dropped" on `d` with { images: Array<ImageInfo> }
// - Return a Promise that resolves with the same array when the next drop completes
//   ImageInfo = { name: string, url: string, blob: Blob, source: 'pdf'|'file', index: number }
import "../../../lib/pdf.js.mjs";


const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']);

const isImageFileName = (name) => {
	const dot = name.lastIndexOf('.');
	if (dot < 0) return false;
	const ext = name.slice(dot).toLowerCase();
	return IMAGE_EXTS.has(ext);
};

const naturalNameSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const stripExt = (name) => {
	const i = name.lastIndexOf('.');
	return i > 0 ? name.slice(0, i) : name;
};

async function loadPdfJs(doc) {
    return window.pdfjsLib;
}

async function pdfFileToImages(doc, file, options = {}) {
	const scale = options.scale || 2; // 2x for readability
	const pdfjsLib = await loadPdfJs(doc);
	const data = await file.arrayBuffer();
	const loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: false });
	const pdf = await loadingTask.promise;
	const images = [];
	for (let i = 1; i <= pdf.numPages; i++) {
		const page = await pdf.getPage(i);
		const viewport = page.getViewport({ scale });
		const canvas = doc.createElement('canvas');
		const ctx = canvas.getContext('2d');
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		await page.render({ canvasContext: ctx, viewport }).promise;
		const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
		const url = URL.createObjectURL(blob);
		images.push({ name: `page-${String(i).padStart(3, '0')}.png`, url, blob, source: options.sourceName || stripExt(file.name), index: i - 1 });
	}
	try { pdf.cleanup(); } catch(_) {}
	return images;
}

async function getDroppedEntries(dataTransfer) {
	const items = Array.from(dataTransfer.items || []);
	const entries = [];
	for (const item of items) {
		if (item.kind === 'file' && typeof item.webkitGetAsEntry === 'function') {
			const entry = item.webkitGetAsEntry();
			if (entry) entries.push(entry);
		}
	}
	// Fallback: if no entries API, use files directly
	if (entries.length === 0 && dataTransfer.files && dataTransfer.files.length) {
		for (const f of Array.from(dataTransfer.files)) {
			entries.push({ isFile: true, isDirectory: false, file: (cb) => cb(f), name: f.name });
		}
	}
	return entries;
}

async function readAllFilesFromDirectoryEntry(dirEntry) {
	const files = [];
	const reader = dirEntry.createReader();
	async function readBatch() {
		return await new Promise((resolve, reject) => {
			reader.readEntries(resolve, reject);
		});
	}
	while (true) {
		const batch = await readBatch();
		if (!batch.length) break;
		for (const entry of batch) {
			if (entry.isDirectory) {
				const nested = await readAllFilesFromDirectoryEntry(entry);
				files.push(...nested);
			} else if (entry.isFile) {
				const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
				files.push(file);
			}
		}
	}
	return files;
}

async function collectImagesFromEntries(entries, sourceName) {
	const imageFiles = [];
	for (const entry of entries) {
		if (entry.isDirectory) {
			const files = await readAllFilesFromDirectoryEntry(entry);
			for (const f of files) if (isImageFileName(f.name)) imageFiles.push(f);
		} else if (entry.isFile) {
			const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
			if (isImageFileName(file.name)) imageFiles.push(file);
			// If it's a PDF, we will handle separately elsewhere
		}
	}
	// Sort by name, natural
	imageFiles.sort((a, b) => naturalNameSort(a.name, b.name));
	// Convert to ImageInfo objects
	const images = [];
	imageFiles.forEach((file, idx) => {
		const url = URL.createObjectURL(file);
		images.push({ name: file.name, url, blob: file, source: sourceName || stripExt(file.name), index: idx });
	});
	return images;
}

function dispatchImagesEvent(doc, images) {
	const event = new CustomEvent('reader:images-dropped', { detail: { images } });
	doc.dispatchEvent(event);
}

export const initDragAndDrop = (d) => {
	let resolveNextDrop;
	let nextDropPromise = new Promise((res) => { resolveNextDrop = res; });

	const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };

	d.addEventListener('dragenter', prevent);
	d.addEventListener('dragover', prevent);
	d.addEventListener('dragleave', prevent);

	d.addEventListener('drop', async (e) => {
		prevent(e);
		try {
			const entries = await getDroppedEntries(e.dataTransfer);
			const files = Array.from(e.dataTransfer.files || []);
			// If a single PDF file is dropped (no directories), prefer PDF path
			const pdfFile = files.find((f) => f.name && f.name.toLowerCase().endsWith('.pdf'));
			let images = [];
			if (pdfFile && !entries.some(en => en.isDirectory)) {
				const sourceName = stripExt(pdfFile.name);
				images = await pdfFileToImages(d, pdfFile, { sourceName });
			} else {
				// Determine source name: prefer first dropped directory name; otherwise first file base name
				let sourceName = undefined;
				const firstDir = entries.find(en => en.isDirectory);
				if (firstDir && firstDir.name) {
					sourceName = firstDir.name;
				} else if (files.length) {
					sourceName = stripExt(files[0].name);
				} else if (entries.length && entries[0].name) {
					sourceName = stripExt(entries[0].name);
				}

				images = await collectImagesFromEntries(entries, sourceName);
				// If no entries API and only files provided, also check files list
				if (images.length === 0 && files.length) {
					const imgFiles = files.filter((f) => isImageFileName(f.name)).sort((a,b)=>naturalNameSort(a.name,b.name));
					const fallbackSource = stripExt(files[0].name);
					images = imgFiles.map((f, idx)=>({ name: f.name, url: URL.createObjectURL(f), blob: f, source: fallbackSource, index: idx }));
				}
			}
			dispatchImagesEvent(d, images);
			// Fulfill current promise and create a new one for subsequent drops
			resolveNextDrop(images);
			nextDropPromise = new Promise((res) => { resolveNextDrop = res; });
		} catch (err) {
			console.error('Drop handling error:', err);
		}
	});

	// Provide a simple API to await the next drop
	return {
		waitForNextDrop: () => nextDropPromise
	};
}
