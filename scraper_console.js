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
// This runs inside YOUR browser, using your existing session,
// so there are no Cloudflare issues.
// ============================================================

(async () => {
    "use strict";

    // --- Configuration ---
    const DELAY_BETWEEN_SHOUDS = 2000;  // ms - be polite to the server
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
        // Clone so we don't modify the original
        const clone = el.cloneNode(true);
        // Remove unwanted elements
        clone.querySelectorAll("nav, header, footer, script, style, noscript, button, svg, img").forEach(e => e.remove());

        // Walk text nodes and build clean text
        let text = "";
        const walk = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
        let prevWasBlock = true;
        while (walk.nextNode()) {
            const node = walk.currentNode;
            const parent = node.parentElement;
            const display = parent ? getComputedStyle_safe(parent) : "inline";
            const chunk = node.textContent;

            if (!chunk.trim()) continue;

            if (display === "block" && !prevWasBlock) {
                text += "\n\n";
            }
            text += chunk.trim() + " ";
            prevWasBlock = (display === "block");
        }

        // Fallback: if tree walker produced nothing, use textContent
        if (text.trim().length < 100) {
            text = clone.textContent || "";
        }

        // Clean up whitespace
        text = text.replace(/[ \t]+/g, " ");
        text = text.replace(/\n /g, "\n");
        text = text.replace(/\n{3,}/g, "\n\n");
        return text.trim();
    }

    function getComputedStyle_safe(el) {
        // For DOMParser docs, elements aren't rendered, so treat <p>, <div>, <h*>, <br>, <li> as block
        const blockTags = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "LI", "UL", "OL", "BLOCKQUOTE", "SECTION", "ARTICLE", "TR"]);
        return blockTags.has(el.tagName) ? "block" : "inline";
    }

    // --- Step 0: Load JSZip ---
    console.log("%c=== Crimson Circle Library Scraper ===", "font-size:16px; font-weight:bold; color:#4CAF50;");
    console.log("Loading JSZip...");

    await new Promise((resolve, reject) => {
        if (window.JSZip) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Failed to load JSZip from CDN. See instructions below."));
        document.head.appendChild(s);
    });
    console.log("JSZip loaded.\n");

    // --- Step 1: Discover series ---
    console.log("Step 1: Discovering series from /library ...");

    // We should be on the library page already, but fetch it to be safe
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

    const allShouds = []; // {series, shoud, seriesSlug, shoudSlug}
    let totalShouds = 0;

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

            const name = a.textContent.trim() || shoudSlug;
            allShouds.push({
                seriesName: s.name,
                seriesSlug: s.slug,
                shoudName: name,
                shoudSlug: shoudSlug,
                url: `${BASE}/library/${s.slug}/${shoudSlug}`,
            });
        }

        const count = allShouds.filter(x => x.seriesSlug === s.slug).length;
        totalShouds += count;
        console.log(`  Found ${count} shouds`);
        await delay(DELAY_BETWEEN_SERIES);
    }

    console.log(`\nTotal: ${series.length} series, ${allShouds.length} shouds\n`);

    if (allShouds.length === 0) {
        console.error("No shouds found! The page structure may have changed.");
        console.log("DEBUG: Showing first 20 hrefs from the first series page for inspection...");
        if (series.length > 0) {
            const dbgHtml = await fetchPage(series[0].url);
            if (dbgHtml) {
                const dbgDoc = parseHTML(dbgHtml);
                const hrefs = [...dbgDoc.querySelectorAll("a[href]")].map(a => a.getAttribute("href")).slice(0, 20);
                hrefs.forEach(h => console.log(`  ${h}`));
            }
        }
        return;
    }

    // --- Step 3: Download all transcripts ---
    console.log("Step 3: Downloading transcripts...\n");

    const zip = new JSZip();
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

                zip.file(`${item.seriesSlug}/${item.shoudSlug}.txt`, header + text);
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
    const blob = await zip.generateAsync({ type: "blob" }, (metadata) => {
        if (metadata.percent % 10 < 1) {
            console.log(`  Zip progress: ${Math.round(metadata.percent)}%`);
        }
    });

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
