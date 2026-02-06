// ============================================================
// Crimson Circle Library Scraper - Browser Console Edition
// ============================================================
//
// HOW TO USE:
// 1. Go to https://www.crimsoncircle.com/library in your browser
// 2. Press F12 to open Developer Tools
// 3. Click the "Console" tab
// 4. Paste this ENTIRE script and press Enter
// 5. Wait while it runs (watch progress in the console)
// 6. A .zip file will automatically download when done
//
// NO external dependencies. Everything is self-contained.
// Runs inside YOUR browser session - no Cloudflare issues.
// ============================================================

(async () => {
    "use strict";

    // --- Configuration ---
    const DELAY_BETWEEN_SHOUDS = 2000;  // ms
    const DELAY_BETWEEN_SERIES = 3000;  // ms
    const BASE = "https://www.crimsoncircle.com";

    // --- Helpers ---
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const parseHTML = html => new DOMParser().parseFromString(html, "text/html");

    async function fetchPage(url, retries = 3) {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const resp = await fetch(url);
                if (resp.ok) return await resp.text();
                console.warn(`  HTTP ${resp.status} for ${url} (attempt ${attempt + 1})`);
            } catch (e) {
                console.warn(`  Network error for ${url} (attempt ${attempt + 1}): ${e.message}`);
            }
            await delay(3000);
        }
        return null;
    }

    function cleanText(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll("nav, header, footer, script, style, noscript, button, svg, img").forEach(e => e.remove());

        const blockTags = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "LI", "UL", "OL", "BLOCKQUOTE", "SECTION", "ARTICLE", "TR"]);

        let text = "";
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
        let prevWasBlock = true;
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const parent = node.parentElement;
            const isBlock = parent ? blockTags.has(parent.tagName) : false;
            const chunk = node.textContent;
            if (!chunk.trim()) continue;
            if (isBlock && !prevWasBlock) text += "\n\n";
            text += chunk.trim() + " ";
            prevWasBlock = isBlock;
        }

        if (text.trim().length < 100) text = clone.textContent || "";

        text = text.replace(/[ \t]+/g, " ");
        text = text.replace(/\n /g, "\n");
        text = text.replace(/\n{3,}/g, "\n\n");
        return text.trim();
    }

    // ============================================================
    // Minimal ZIP builder (STORE method, no compression)
    // No external dependencies needed.
    // ============================================================
    class SimpleZip {
        constructor() {
            this.files = []; // {name, data}
        }

        addFile(name, content) {
            const encoder = new TextEncoder();
            this.files.push({ name: name, data: encoder.encode(content) });
        }

        _dosDateTime(date) {
            const d = date || new Date();
            const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
            const dateVal = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
            return { time, date: dateVal };
        }

        _crc32(data) {
            let crc = 0xFFFFFFFF;
            // Build table
            if (!SimpleZip._crcTable) {
                SimpleZip._crcTable = new Uint32Array(256);
                for (let i = 0; i < 256; i++) {
                    let c = i;
                    for (let j = 0; j < 8; j++) {
                        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                    }
                    SimpleZip._crcTable[i] = c;
                }
            }
            for (let i = 0; i < data.length; i++) {
                crc = SimpleZip._crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
            }
            return (crc ^ 0xFFFFFFFF) >>> 0;
        }

        generate() {
            const parts = [];
            const centralDir = [];
            let offset = 0;
            const dt = this._dosDateTime();

            for (const file of this.files) {
                const nameBytes = new TextEncoder().encode(file.name);
                const crc = this._crc32(file.data);
                const size = file.data.length;

                // Local file header (30 bytes + name + data)
                const local = new ArrayBuffer(30 + nameBytes.length);
                const lv = new DataView(local);
                lv.setUint32(0, 0x04034B50, true);  // signature
                lv.setUint16(4, 20, true);           // version needed
                lv.setUint16(6, 0, true);            // flags
                lv.setUint16(8, 0, true);            // compression: STORE
                lv.setUint16(10, dt.time, true);     // mod time
                lv.setUint16(12, dt.date, true);     // mod date
                lv.setUint32(14, crc, true);         // crc32
                lv.setUint32(18, size, true);        // compressed size
                lv.setUint32(22, size, true);        // uncompressed size
                lv.setUint16(26, nameBytes.length, true); // name length
                lv.setUint16(28, 0, true);           // extra length
                new Uint8Array(local, 30).set(nameBytes);

                parts.push(new Uint8Array(local));
                parts.push(file.data);

                // Central directory entry (46 bytes + name)
                const central = new ArrayBuffer(46 + nameBytes.length);
                const cv = new DataView(central);
                cv.setUint32(0, 0x02014B50, true);  // signature
                cv.setUint16(4, 20, true);           // version made by
                cv.setUint16(6, 20, true);           // version needed
                cv.setUint16(8, 0, true);            // flags
                cv.setUint16(10, 0, true);           // compression: STORE
                cv.setUint16(12, dt.time, true);     // mod time
                cv.setUint16(14, dt.date, true);     // mod date
                cv.setUint32(16, crc, true);         // crc32
                cv.setUint32(20, size, true);        // compressed size
                cv.setUint32(24, size, true);        // uncompressed size
                cv.setUint16(28, nameBytes.length, true); // name length
                cv.setUint16(30, 0, true);           // extra length
                cv.setUint16(32, 0, true);           // comment length
                cv.setUint16(34, 0, true);           // disk start
                cv.setUint16(36, 0, true);           // internal attrs
                cv.setUint32(38, 0, true);           // external attrs
                cv.setUint32(42, offset, true);      // local header offset
                new Uint8Array(central, 46).set(nameBytes);

                centralDir.push(new Uint8Array(central));
                offset += 30 + nameBytes.length + size;
            }

            // End of central directory
            const centralDirOffset = offset;
            let centralDirSize = 0;
            for (const cd of centralDir) {
                parts.push(cd);
                centralDirSize += cd.length;
            }

            const eocd = new ArrayBuffer(22);
            const ev = new DataView(eocd);
            ev.setUint32(0, 0x06054B50, true);  // signature
            ev.setUint16(4, 0, true);            // disk number
            ev.setUint16(6, 0, true);            // central dir disk
            ev.setUint16(8, this.files.length, true);  // entries on disk
            ev.setUint16(10, this.files.length, true); // total entries
            ev.setUint32(12, centralDirSize, true);    // central dir size
            ev.setUint32(16, centralDirOffset, true);  // central dir offset
            ev.setUint16(20, 0, true);           // comment length

            parts.push(new Uint8Array(eocd));

            // Combine all parts into one blob
            return new Blob(parts, { type: "application/zip" });
        }
    }

    // ============================================================
    // Main scraper
    // ============================================================

    console.log("%c=== Crimson Circle Library Scraper ===", "font-size:16px; font-weight:bold; color:#4CAF50;");
    console.log("No external dependencies needed. Starting...\n");

    // --- Step 1: Discover series ---
    console.log("Step 1: Discovering series from /library ...");

    const libraryHTML = await fetchPage(`${BASE}/library`);
    if (!libraryHTML) {
        console.error("Failed to fetch the library page. Make sure you're on crimsoncircle.com.");
        return;
    }
    const libraryDoc = parseHTML(libraryHTML);

    const series = [];
    const seenSeries = new Set();
    for (const a of libraryDoc.querySelectorAll('a[href*="/library/"]')) {
        const href = a.getAttribute("href");
        if (!href) continue;
        const url = new URL(href, BASE);
        const parts = url.pathname.replace(/^\/|\/$/g, "").split("/");
        if (parts.length !== 2 || parts[0] !== "library") continue;
        if (seenSeries.has(parts[1])) continue;
        seenSeries.add(parts[1]);
        series.push({
            name: a.textContent.trim() || parts[1],
            slug: parts[1],
            url: url.href,
        });
    }

    console.log(`Found ${series.length} series:\n`);
    series.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));

    // --- Step 2: Discover shouds in each series ---
    console.log("\nStep 2: Discovering shouds in each series...\n");

    const allShouds = [];

    for (let i = 0; i < series.length; i++) {
        const s = series[i];
        console.log(`[${i + 1}/${series.length}] ${s.name}`);

        const html = await fetchPage(s.url);
        if (!html) {
            console.warn(`  FAILED to fetch series page`);
            await delay(DELAY_BETWEEN_SERIES);
            continue;
        }

        const doc = parseHTML(html);
        const seenShouds = new Set();
        let count = 0;

        for (const a of doc.querySelectorAll("a[href]")) {
            const href = a.getAttribute("href");
            if (!href || !href.includes(s.slug + "/")) continue;

            const clean = href.replace(/^\/|\/$/g, "");
            const parts = clean.split("/");

            let shoudSlug = null;
            if (parts.length === 2 && parts[0] === s.slug) {
                shoudSlug = parts[1];
            } else if (parts.length === 3 && parts[0] === "library" && parts[1] === s.slug) {
                shoudSlug = parts[2];
            }

            if (!shoudSlug || seenShouds.has(shoudSlug)) continue;
            seenShouds.add(shoudSlug);

            allShouds.push({
                seriesName: s.name,
                seriesSlug: s.slug,
                shoudName: a.textContent.trim() || shoudSlug,
                shoudSlug: shoudSlug,
                url: `${BASE}/library/${s.slug}/${shoudSlug}`,
            });
            count++;
        }

        console.log(`  Found ${count} shouds`);
        await delay(DELAY_BETWEEN_SERIES);
    }

    console.log(`\nTotal: ${series.length} series, ${allShouds.length} shouds\n`);

    if (allShouds.length === 0) {
        console.error("No shouds found! Showing debug info...");
        if (series.length > 0) {
            const dbgHtml = await fetchPage(series[0].url);
            if (dbgHtml) {
                const dbgDoc = parseHTML(dbgHtml);
                const hrefs = [...dbgDoc.querySelectorAll("a[href]")].map(a => a.getAttribute("href")).slice(0, 30);
                console.log("First 30 hrefs on series page:");
                hrefs.forEach(h => console.log(`  ${h}`));
            }
        }
        return;
    }

    // --- Step 3: Download all transcripts ---
    console.log("Step 3: Downloading transcripts...\n");

    const zip = new SimpleZip();
    let downloaded = 0;
    let failed = 0;
    const failedUrls = [];

    for (let i = 0; i < allShouds.length; i++) {
        const item = allShouds[i];
        const progress = `[${i + 1}/${allShouds.length}]`;
        console.log(`${progress} ${item.seriesName} / ${item.shoudName}`);

        const html = await fetchPage(item.url);
        if (!html) {
            console.warn(`${progress}   FAILED to fetch`);
            failed++;
            failedUrls.push(item.url);
            await delay(DELAY_BETWEEN_SHOUDS);
            continue;
        }

        const doc = parseHTML(html);
        const transcriptEl = doc.querySelector("#transcript-ShoudTranscript");

        if (transcriptEl) {
            const text = cleanText(transcriptEl);

            if (text.length > 200) {
                const header = [
                    `Title: ${item.shoudName}`,
                    `Series: ${item.seriesName}`,
                    `Source: ${item.url}`,
                    "=".repeat(60),
                    "",
                    "",
                ].join("\n");

                zip.addFile(`${item.seriesSlug}/${item.shoudSlug}.txt`, header + text);
                downloaded++;
                console.log(`${progress}   Saved (${text.length.toLocaleString()} chars)`);
            } else {
                console.warn(`${progress}   Transcript too short (${text.length} chars)`);
                failed++;
                failedUrls.push(item.url);
            }
        } else {
            console.warn(`${progress}   No #transcript-ShoudTranscript found`);
            failed++;
            failedUrls.push(item.url);
        }

        await delay(DELAY_BETWEEN_SHOUDS);
    }

    // --- Step 4: Generate and download zip ---
    console.log(`\n${"=".repeat(60)}`);
    console.log(`DONE!`);
    console.log(`  Downloaded: ${downloaded}`);
    console.log(`  Failed: ${failed}`);
    if (failedUrls.length > 0) {
        console.log(`\nFailed URLs:`);
        failedUrls.forEach(u => console.log(`  - ${u}`));
    }

    console.log(`\nGenerating zip file...`);
    const blob = zip.generate();

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crimson-circle-library.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`%cDownload started! Check your browser downloads.`, "font-size:14px; font-weight:bold; color:#4CAF50;");
    console.log(`Zip contains ${downloaded} transcript files.`);
})();
