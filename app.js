const $ = (selector) => document.querySelector(selector);

const ui = {
  dropZone: $('#dropZone'),
  epubInput: $('#epubInput'),
  browseButton: $('#browseButton'),
  working: $('#workingState'),
  workingTitle: $('#workingTitle'),
  workingDetail: $('#workingDetail'),
  result: $('#resultState'),
  resultTitle: $('#resultTitle'),
  resultBadge: $('#resultBadge'),
  resultSummary: $('#resultSummary'),
  diagnosticSummary: $('#diagnosticSummary'),
  checkList: $('#checkList'),
  coverPanel: $('#coverUploadPanel'),
  coverInput: $('#coverInput'),
  coverFilename: $('#coverFilename'),
  resultNote: $('#resultNote'),
  repairButton: $('#repairButton'),
  startOverButton: $('#startOverButton'),
  download: $('#downloadState'),
  downloadSummary: $('#downloadSummary'),
  downloadButton: $('#downloadButton'),
  repairAnotherButton: $('#repairAnotherButton'),
  steps: [...document.querySelectorAll('.step')]
};

let session = null;

function track(eventName, parameters = {}) {
  if (typeof window.gtag === 'function') window.gtag('event', eventName, parameters);
}

document.querySelectorAll('[data-video-id]').forEach((card) => {
  const trigger = card.querySelector('.video-trigger');
  if (!trigger) return;
  trigger.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(card.dataset.videoId)}?autoplay=1&rel=0`;
    frame.title = 'Send to Kindle: No Cover or Failed Upload? I Built a Fix';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    card.replaceChildren(frame);
    track('demo_video_played', { video_provider: 'youtube' });
  }, { once: true });
});

ui.browseButton.addEventListener('click', (event) => {
  event.stopPropagation();
  ui.epubInput.click();
});
ui.dropZone.addEventListener('click', () => ui.epubInput.click());
ui.dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') ui.epubInput.click();
});
ui.epubInput.addEventListener('change', () => inspectSelectedFile(ui.epubInput.files[0]));
['dragenter', 'dragover'].forEach((name) => ui.dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  ui.dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => ui.dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  ui.dropZone.classList.remove('dragging');
}));
ui.dropZone.addEventListener('drop', (event) => inspectSelectedFile(event.dataTransfer.files[0]));
ui.startOverButton.addEventListener('click', resetTool);
ui.repairAnotherButton.addEventListener('click', resetTool);
ui.coverInput.addEventListener('change', async () => {
  const file = ui.coverInput.files[0];
  if (!file || !session) return;
  session.replacementCover = file;
  ui.coverFilename.textContent = file.name;
  ui.repairButton.disabled = session.diagnosis.deliveryStatus === 'blocked';
  ui.repairButton.textContent = session.diagnosis.deliveryStatus === 'blocked' ? 'Resolve delivery blockers first' : 'Add cover and repair EPUB →';
});
ui.repairButton.addEventListener('click', repairEpub);
ui.downloadButton.addEventListener('click', () => {
  if (!session?.outputUrl) return;
  track('repair_downloaded', {
    cover_added: Boolean(session.replacementCover)
  });
  const link = document.createElement('a');
  link.href = session.outputUrl;
  link.download = session.outputName;
  link.click();
});

// Local-only smoke-test hook. It is intentionally unavailable on deployed domains.
if ((location.hostname === '127.0.0.1' || location.hostname === 'localhost') && new URLSearchParams(location.search).get('fixture') === 'missing-cover') {
  fetch('/downloads/fixmyepub-missing-cover-reference.epub')
    .then((response) => response.blob())
    .then((blob) => inspectSelectedFile(new File([blob], 'missing-cover-test.epub', { type: 'application/epub+zip' })))
    .catch((error) => showFatal('The local test fixture could not be loaded.', error.message));
}

function setStep(active) {
  ui.steps.forEach((step, index) => {
    step.classList.toggle('active', index + 1 === active);
    step.classList.toggle('complete', index + 1 < active);
    if (index + 1 < active) step.querySelector('span').textContent = '✓';
    else step.querySelector('span').textContent = String(index + 1);
  });
}

function resetTool() {
  if (session?.outputUrl) URL.revokeObjectURL(session.outputUrl);
  session = null;
  ui.epubInput.value = '';
  ui.coverInput.value = '';
  ui.coverFilename.textContent = '';
  ui.dropZone.hidden = false;
  ui.working.hidden = true;
  ui.result.hidden = true;
  ui.download.hidden = true;
  setStep(1);
  document.querySelector('#fixer').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function inspectSelectedFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.epub')) {
    showFatal('That is not an EPUB file.', 'Choose a DRM-free file ending in .epub and try again.');
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    showFatal('This EPUB is too large for a safe browser repair.', 'Try a file under 100 MB. Large fixed-layout books are not supported yet.');
    return;
  }

  track('epub_selected', {
    size_band: file.size < 5 * 1024 * 1024 ? 'under_5mb' : file.size < 25 * 1024 * 1024 ? '5_to_25mb' : '25_to_100mb'
  });

  ui.dropZone.hidden = true;
  ui.result.hidden = true;
  ui.download.hidden = true;
  ui.working.hidden = false;
  ui.workingTitle.textContent = `Inspecting ${file.name}`;
  ui.workingDetail.textContent = 'Opening the EPUB package and tracing its cover references.';
  setStep(2);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const archive = await ZipArchive.open(bytes);
    const diagnosis = await diagnoseCover(archive);
    session = { file, archive, diagnosis, replacementCover: null, outputUrl: null };
    track('diagnosis_complete', {
      delivery_status: diagnosis.deliveryStatus,
      cover_status: diagnosis.isHealthy ? 'healthy' : diagnosis.hasCoverImage ? 'repairable' : 'missing'
    });
    renderDiagnosis(diagnosis);
  } catch (error) {
    console.error(error);
    showFatal('Send to Kindle is likely to reject this EPUB.', error.message || 'The file may be encrypted, damaged, or use an unsupported ZIP method.');
  }
}

function showFatal(title, detail) {
  ui.dropZone.hidden = true;
  ui.working.hidden = true;
  ui.download.hidden = true;
  ui.result.hidden = false;
  ui.resultTitle.textContent = title;
  ui.resultBadge.textContent = 'Could not inspect';
  ui.resultBadge.classList.add('warning');
  ui.resultSummary.textContent = detail;
  ui.diagnosticSummary.innerHTML = '';
  ui.checkList.innerHTML = '';
  ui.coverPanel.hidden = true;
  ui.repairButton.hidden = true;
  ui.resultNote.textContent = 'Your original file has not been changed.';
}

function addCheck(label, state, detail) {
  const symbols = { good: '✓', fix: '!', bad: '×' };
  return `<div class="check-item ${state}"><i>${symbols[state]}</i><span><b>${escapeHtml(label)}</b>${detail ? `<br><small>${escapeHtml(detail)}</small>` : ''}</span></div>`;
}

function renderDiagnosis(d) {
  ui.working.hidden = true;
  ui.result.hidden = false;
  ui.repairButton.hidden = false;
  ui.resultBadge.classList.toggle('warning', d.deliveryStatus === 'blocked' || (!d.canRepair && !d.isHealthy));
  ui.coverPanel.hidden = d.hasCoverImage;

  if (d.deliveryStatus === 'blocked') {
    ui.resultTitle.textContent = 'Send to Kindle may reject this EPUB.';
    ui.resultBadge.textContent = 'Delivery blocked';
    ui.resultSummary.textContent = `${d.deliveryBlockers.length} structural ${d.deliveryBlockers.length === 1 ? 'problem needs' : 'problems need'} attention before this file is likely to pass Amazon’s conversion checks.`;
    ui.repairButton.textContent = 'No safe automatic repair';
    ui.repairButton.disabled = true;
  } else if (d.isHealthy && d.deliveryStatus === 'ready') {
    ui.resultTitle.textContent = 'Your EPUB cover metadata looks healthy.';
    ui.resultBadge.textContent = 'Ready to send';
    ui.resultSummary.textContent = 'The cover artwork and the main Kindle-facing metadata agree. A missing thumbnail is more likely caused by download state, caching, the delivery method, or device firmware.';
    ui.repairButton.textContent = 'Download a normalized copy →';
  } else if (d.isHealthy && d.deliveryStatus === 'repairable') {
    ui.resultTitle.textContent = 'The EPUB package needs normalization.';
    ui.resultBadge.textContent = 'Repairable';
    ui.resultSummary.textContent = 'The cover metadata is healthy, but the EPUB ZIP container is not packaged in the strict form expected by conversion services. We can rebuild it safely.';
    ui.repairButton.textContent = 'Normalize EPUB package →';
  } else if (d.hasCoverImage) {
    ui.resultTitle.textContent = 'We found a repairable cover issue.';
    ui.resultBadge.textContent = 'Repairable';
    ui.resultSummary.textContent = `The artwork exists inside the book, but ${d.issueSummary} We can repair the package metadata in a new EPUB copy.`;
    ui.repairButton.textContent = 'Repair cover metadata →';
  } else {
    ui.resultTitle.textContent = 'This EPUB has no identifiable cover image.';
    ui.resultBadge.textContent = 'Cover needed';
    ui.resultSummary.textContent = 'We could not find a safe existing image to designate as the cover. Choose a JPG or PNG to add one without changing the book’s text.';
    ui.repairButton.textContent = 'Choose a cover to continue';
    ui.repairButton.disabled = true;
  }

  const coverState = d.isHealthy ? ['Cover check', 'Ready', 'good'] : d.hasCoverImage ? ['Cover check', 'Repairable', 'fix'] : ['Cover check', 'Cover needed', 'bad'];
  const deliveryState = d.deliveryStatus === 'ready' ? ['Delivery check', 'Ready', 'good'] : d.deliveryStatus === 'repairable' ? ['Delivery check', 'Repairable', 'fix'] : ['Delivery check', 'Blocked', 'bad'];
  ui.diagnosticSummary.innerHTML = [coverState, deliveryState].map(([label, value, state]) =>
    `<div class="diagnostic-card ${state}"><span>${label}</span><b>${value}</b></div>`
  ).join('');

  const checks = [
    addCheck('EPUB container', d.containerHealthy ? 'good' : 'fix', d.containerHealthy ? 'Packaged correctly' : 'Will be normalized'),
    addCheck('Required metadata', d.requiredMetadataValid ? 'good' : 'bad', d.requiredMetadataValid ? 'Title, language and identifier found' : d.missingMetadata.join(', ') + ' missing'),
    addCheck('Manifest resources', d.missingManifest.length ? 'bad' : 'good', d.missingManifest.length ? `${d.missingManifest.length} missing` : 'All local resources found'),
    addCheck('Spine references', d.brokenSpine.length ? 'bad' : 'good', d.brokenSpine.length ? `${d.brokenSpine.length} broken` : 'Reading order resolves'),
    addCheck('Content XML', d.xmlProblems.length ? 'bad' : 'good', d.xmlProblems.length ? `${d.xmlProblems.length} malformed files` : 'Parseable'),
    addCheck('Cover artwork', d.hasCoverImage ? 'good' : 'bad', d.coverPath || 'No image identified'),
    addCheck('EPUB 3 cover marker', d.hasEpub3Marker ? 'good' : 'fix', d.hasEpub3Marker ? 'Present' : 'Missing or incomplete'),
    addCheck('EPUB 2 fallback marker', d.hasEpub2Marker ? 'good' : 'fix', d.hasEpub2Marker ? 'Present' : 'Missing or incomplete'),
    addCheck('Cover file reference', d.referenceValid ? 'good' : 'fix', d.referenceValid ? 'Points to an existing file' : 'Missing or broken')
  ];
  ui.checkList.innerHTML = checks.join('');
  ui.resultNote.textContent = d.deliveryStatus === 'blocked'
    ? `Blocking issues: ${d.deliveryBlockers.join('; ')}. We do not guess when a structural repair could change the book.`
    : d.isHealthy
    ? 'A normalized copy can still improve compatibility, but no browser tool can guarantee a Kindle-side thumbnail.'
    : 'Only deterministic cover and package changes will be written. Your original EPUB remains untouched.';
}

async function repairEpub() {
  if (!session) return;
  track('repair_started', {
    cover_added: Boolean(session.replacementCover),
    delivery_status: session.diagnosis.deliveryStatus
  });
  ui.result.hidden = true;
  ui.working.hidden = false;
  ui.workingTitle.textContent = 'Building a repaired copy…';
  ui.workingDetail.textContent = 'Updating cover references and rebuilding a valid EPUB container.';

  try {
    const files = new Map();
    for (const entry of session.archive.entries) {
      if (entry.name.endsWith('/')) continue;
      files.set(entry.name, await session.archive.read(entry.name));
    }

    let { opfPath, opfText, coverPath, coverId } = session.diagnosis;
    if (session.replacementCover) {
      const ext = session.replacementCover.type === 'image/png' ? 'png' : 'jpg';
      const opfDir = dirname(opfPath);
      const relativePath = `Images/fixmyepub-cover.${ext}`;
      coverPath = joinPath(opfDir, relativePath);
      coverId = uniqueId(opfText, 'fixmyepub-cover');
      files.set(coverPath, new Uint8Array(await session.replacementCover.arrayBuffer()));
      opfText = addManifestCover(opfText, coverId, relativePath, session.replacementCover.type || 'image/jpeg');
    }

    if (!coverId || !coverPath) throw new Error('No safe cover resource is available to repair.');
    opfText = normalizeCoverMetadata(opfText, coverId, inferMediaType(coverPath));
    files.set(opfPath, new TextEncoder().encode(opfText));

    const outputBytes = await createEpubZip(files);
    const verification = await diagnoseCover(await ZipArchive.open(outputBytes));
    if (!verification.hasCoverImage || !verification.hasEpub2Marker || !verification.hasEpub3Marker || !verification.referenceValid || !verification.mediaTypeValid || verification.deliveryStatus !== 'ready') {
      throw new Error('The rebuilt EPUB did not pass its post-repair cover and delivery checks. No download was created.');
    }
    const blob = new Blob([outputBytes], { type: 'application/epub+zip' });
    if (session.outputUrl) URL.revokeObjectURL(session.outputUrl);
    session.outputUrl = URL.createObjectURL(blob);
    session.outputName = session.file.name.replace(/\.epub$/i, '') + '-kindle-cover-fixed.epub';

    ui.working.hidden = true;
    ui.download.hidden = false;
    ui.downloadSummary.textContent = session.replacementCover
      ? 'The selected artwork was added and marked with EPUB 2 and EPUB 3 cover metadata in a new copy.'
      : 'The existing artwork was normalized with EPUB 2 and EPUB 3 cover metadata in a new copy.';
    setStep(3);
  } catch (error) {
    console.error(error);
    showFatal('The repair could not be completed safely.', error.message);
  }
}

async function diagnoseCover(archive) {
  const containerEntry = archive.findCaseInsensitive('META-INF/container.xml');
  if (!containerEntry) throw new Error('META-INF/container.xml is missing.');
  const containerText = decodeText(await archive.read(containerEntry.name));
  const containerDoc = parseXml(containerText, 'container.xml');
  const rootfile = [...containerDoc.getElementsByTagNameNS('*', 'rootfile')][0];
  const opfPath = normalizePath(rootfile?.getAttribute('full-path') || '');
  if (!opfPath) throw new Error('The EPUB package document is not declared.');
  const opfEntry = archive.findCaseInsensitive(opfPath);
  if (!opfEntry) throw new Error(`The package document ${opfPath} is missing.`);

  const opfText = decodeText(await archive.read(opfEntry.name));
  const doc = parseXml(opfText, opfPath);
  const manifestItems = [...doc.getElementsByTagNameNS('*', 'item')];
  const byId = new Map(manifestItems.map((item) => [item.getAttribute('id'), item]));
  const epub3Item = manifestItems.find((item) => tokenList(item.getAttribute('properties')).includes('cover-image'));
  const metaItems = [...doc.getElementsByTagNameNS('*', 'meta')];
  const epub2Meta = metaItems.find((meta) => (meta.getAttribute('name') || '').toLowerCase() === 'cover');
  const epub2Item = epub2Meta ? byId.get(epub2Meta.getAttribute('content')) : null;
  let coverItem = epub3Item || epub2Item || null;

  if (!coverItem) {
    coverItem = manifestItems.find((item) => {
      const href = item.getAttribute('href') || '';
      const type = item.getAttribute('media-type') || '';
      return type.startsWith('image/') && /(^|[\/_-])cover([._-]|$)/i.test(decodeURIComponentSafe(href));
    }) || null;
  }

  const coverId = coverItem?.getAttribute('id') || null;
  const href = coverItem?.getAttribute('href') || '';
  const coverPath = href ? resolvePath(opfEntry.name, decodeURIComponentSafe(href.split('#')[0])) : null;
  const coverEntry = coverPath ? archive.findCaseInsensitive(coverPath) : null;
  const mediaType = coverItem?.getAttribute('media-type') || '';
  const inferred = inferMediaType(coverPath || '');
  const mediaTypeValid = !!mediaType && (!inferred || inferred === mediaType || (inferred === 'image/jpeg' && mediaType === 'image/jpg'));
  const referenceValid = !!coverEntry;
  const hasCoverImage = !!coverEntry && (mediaType.startsWith('image/') || !!inferred);
  const hasEpub3Marker = !!epub3Item && epub3Item === coverItem && referenceValid;
  const hasEpub2Marker = !!epub2Meta && epub2Item === coverItem && referenceValid;
  const issues = [];
  if (!hasEpub3Marker) issues.push('the EPUB 3 cover marker is missing');
  if (!hasEpub2Marker) issues.push('the EPUB 2 fallback marker is missing');
  if (!referenceValid) issues.push('the declared cover file cannot be found');
  if (coverItem && !mediaTypeValid) issues.push('the image media type is incorrect');

  const mimetypeEntry = archive.findCaseInsensitive('mimetype');
  const mimetypeText = mimetypeEntry ? decodeText(await archive.read(mimetypeEntry.name)).trim() : '';
  const containerHealthy = !!mimetypeEntry && mimetypeText === 'application/epub+zip' && mimetypeEntry.method === 0 && mimetypeEntry.localOffset === 0;
  const missingMetadata = [];
  if (![...doc.getElementsByTagNameNS('*', 'title')].some((element) => element.textContent?.trim())) missingMetadata.push('title');
  if (![...doc.getElementsByTagNameNS('*', 'language')].some((element) => element.textContent?.trim())) missingMetadata.push('language');
  if (![...doc.getElementsByTagNameNS('*', 'identifier')].some((element) => element.textContent?.trim())) missingMetadata.push('identifier');
  const missingManifest = [];
  const xmlProblems = [];
  for (const item of manifestItems) {
    const itemHref = decodeURIComponentSafe((item.getAttribute('href') || '').split('#')[0]);
    if (!itemHref || /^(?:[a-z]+:|\/\/)/i.test(itemHref)) continue;
    const itemPath = resolvePath(opfEntry.name, itemHref);
    const entry = archive.findCaseInsensitive(itemPath);
    if (!entry) {
      missingManifest.push(itemPath);
      continue;
    }
    const type = item.getAttribute('media-type') || '';
    if (/\b(?:xhtml|xml|svg\+xml)\b/i.test(type)) {
      try { parseXml(decodeText(await archive.read(entry.name)), entry.name); }
      catch { xmlProblems.push(entry.name); }
    }
  }
  const brokenSpine = [...doc.getElementsByTagNameNS('*', 'itemref')]
    .map((item) => item.getAttribute('idref'))
    .filter((id) => !id || !byId.has(id));
  const deliveryFixes = [];
  const deliveryBlockers = [];
  if (!containerHealthy) deliveryFixes.push('EPUB ZIP packaging needs normalization');
  if (missingMetadata.length) deliveryBlockers.push(`required metadata missing: ${missingMetadata.join(', ')}`);
  if (missingManifest.length) deliveryBlockers.push(`${missingManifest.length} manifest resources are missing`);
  if (brokenSpine.length) deliveryBlockers.push(`${brokenSpine.length} spine references are broken`);
  if (xmlProblems.length) deliveryBlockers.push(`${xmlProblems.length} XML content files are malformed`);
  const deliveryStatus = deliveryBlockers.length ? 'blocked' : deliveryFixes.length ? 'repairable' : 'ready';

  return {
    opfPath: opfEntry.name,
    opfText,
    coverId,
    coverPath: coverEntry?.name || coverPath,
    hasCoverImage,
    hasEpub3Marker,
    hasEpub2Marker,
    referenceValid,
    mediaTypeValid,
    mediaType,
    containerHealthy,
    requiredMetadataValid: missingMetadata.length === 0,
    missingMetadata,
    missingManifest,
    brokenSpine,
    xmlProblems,
    deliveryFixes,
    deliveryBlockers,
    deliveryStatus,
    isHealthy: hasCoverImage && hasEpub3Marker && hasEpub2Marker && referenceValid && mediaTypeValid,
    canRepair: hasCoverImage,
    issueSummary: humanJoin(issues) + '.'
  };
}

function normalizeCoverMetadata(opf, coverId, mediaType) {
  let output = opf;
  const escapedId = escapeRegExp(coverId);
  const itemPattern = new RegExp(`(<(?:\\w+:)?item\\b[^>]*\\bid=["']${escapedId}["'][^>]*?)\\s*(/?>)`, 'i');
  output = output.replace(itemPattern, (full, start, end) => {
    let updated = start;
    const propertiesMatch = start.match(/\bproperties=["']([^"']*)["']/i);
    if (propertiesMatch) {
      const tokens = tokenList(propertiesMatch[1]);
      if (!tokens.includes('cover-image')) tokens.push('cover-image');
      updated = updated.replace(propertiesMatch[0], `properties="${tokens.join(' ')}"`);
    } else {
      updated += ' properties="cover-image"';
    }
    if (mediaType) {
      const typeMatch = updated.match(/\bmedia-type=["'][^"']*["']/i);
      updated = typeMatch
        ? updated.replace(typeMatch[0], `media-type="${mediaType}"`)
        : `${updated} media-type="${mediaType}"`;
    }
    return updated + end;
  });

  const coverMetaPattern = /<(?:\w+:)?meta\b[^>]*\bname=["']cover["'][^>]*\/?\s*>/i;
  const coverMeta = `<meta name="cover" content="${coverId}" />`;
  if (coverMetaPattern.test(output)) output = output.replace(coverMetaPattern, coverMeta);
  else output = output.replace(/(<\/(?:\w+:)?metadata\s*>)/i, `  ${coverMeta}\n$1`);
  return output;
}

function addManifestCover(opf, id, href, mediaType) {
  const item = `<item id="${id}" href="${href}" media-type="${mediaType}" properties="cover-image" />`;
  return opf.replace(/(<\/(?:\w+:)?manifest\s*>)/i, `  ${item}\n$1`);
}

function uniqueId(text, base) {
  let id = base;
  let count = 2;
  while (new RegExp(`\\bid=["']${escapeRegExp(id)}["']`, 'i').test(text)) id = `${base}-${count++}`;
  return id;
}

class ZipArchive {
  constructor(bytes, entries) { this.bytes = bytes; this.entries = entries; }

  static async open(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const min = Math.max(0, bytes.length - 65557);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('The ZIP directory could not be found.');
    const count = view.getUint16(eocd + 10, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const entries = [];
    let cursor = directoryOffset;
    for (let i = 0; i < count; i++) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The ZIP directory is malformed.');
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const size = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const name = decoder.decode(nameBytes);
      entries.push({ name: normalizePath(name), flags, method, crc, compressedSize, size, localOffset });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return new ZipArchive(bytes, entries);
  }

  findCaseInsensitive(path) {
    const target = normalizePath(path).toLowerCase();
    return this.entries.find((entry) => entry.name.toLowerCase() === target);
  }

  async read(path) {
    const entry = typeof path === 'string' ? this.findCaseInsensitive(path) : path;
    if (!entry) throw new Error(`Missing EPUB resource: ${path}`);
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const offset = entry.localOffset;
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`Invalid ZIP entry: ${entry.name}`);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = this.bytes.slice(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return compressed;
    if (entry.method !== 8) throw new Error(`Unsupported compression method in ${entry.name}.`);
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress EPUB files. Try a recent version of Chrome, Edge, Firefox, or Safari.');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}

async function createEpubZip(files) {
  const ordered = [];
  const mimetype = new TextEncoder().encode('application/epub+zip');
  ordered.push({ name: 'mimetype', data: mimetype, store: true });
  for (const [name, data] of files) {
    if (normalizePath(name).toLowerCase() === 'mimetype') continue;
    ordered.push({ name: normalizePath(name), data, store: false });
  }

  const parts = [];
  const central = [];
  let offset = 0;
  for (const item of ordered) {
    const nameBytes = new TextEncoder().encode(item.name);
    const crc = crc32(item.data);
    let method = 0;
    let packed = item.data;
    if (!item.store && typeof CompressionStream !== 'undefined') {
      try {
        const compressedStream = new Blob([item.data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        packed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
        method = 8;
      } catch { method = 0; packed = item.data; }
    }
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, item.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, packed);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, item.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length + packed.length;
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, ordered.length, true);
  ev.setUint16(10, ordered.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concatBytes([...parts, ...central, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(arrays) {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) { output.set(array, offset); offset += array.length; }
  return output;
}

function parseXml(text, label) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(`${label} is not valid XML.`);
  return doc;
}
function decodeText(bytes) { return new TextDecoder('utf-8').decode(bytes); }
function tokenList(value = '') { return String(value || '').trim().split(/\s+/).filter(Boolean); }
function normalizePath(path) {
  const output = [];
  String(path).replace(/\\/g, '/').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') output.pop(); else output.push(part);
  });
  return output.join('/');
}
function dirname(path) { const parts = normalizePath(path).split('/'); parts.pop(); return parts.join('/'); }
function joinPath(...parts) { return normalizePath(parts.filter(Boolean).join('/')); }
function resolvePath(baseFile, relative) { return joinPath(dirname(baseFile), relative); }
function inferMediaType(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' })[ext] || '';
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function humanJoin(items) {
  if (!items.length) return 'the cover metadata is incomplete';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
