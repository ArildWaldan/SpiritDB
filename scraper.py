#!/usr/bin/env python3
"""
Crimson Circle Library Scraper

Downloads full transcripts from https://www.crimsoncircle.com/library
preserving the website's folder structure.

Usage:
    python scraper.py                    # Scrape entire library
    python scraper.py --discover         # Discover structure without downloading
    python scraper.py --series <name>    # Scrape a single series
    python scraper.py --resume           # Resume interrupted scrape
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
import html2text

import config

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("scraper.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State / progress tracking
# ---------------------------------------------------------------------------
STATE_FILE = "scraper_state.json"


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"completed_shouds": [], "completed_series": []}


def save_state(state: dict):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------
def is_excluded(url: str) -> bool:
    """Check if a URL matches any exclusion pattern."""
    for pattern in config.EXCLUDE_URL_PATTERNS:
        if re.search(pattern, url):
            return True
    return False


def slug_from_url(url: str) -> str:
    """Extract a filesystem-safe slug from a URL path."""
    path = urlparse(url).path.rstrip("/")
    return path.split("/")[-1] if "/" in path else path


def url_depth(url: str) -> int:
    """Count path segments after /library/."""
    path = urlparse(url).path.rstrip("/")
    parts = [p for p in path.split("/") if p]
    try:
        lib_idx = parts.index("library")
        return len(parts) - lib_idx - 1
    except ValueError:
        return len(parts)


# ---------------------------------------------------------------------------
# HTML → clean text
# ---------------------------------------------------------------------------
def html_to_clean_text(html_content: str) -> str:
    """Convert HTML to clean readable text using html2text."""
    converter = html2text.HTML2Text()
    converter.ignore_links = True
    converter.ignore_images = True
    converter.ignore_emphasis = False
    converter.body_width = 0  # no wrapping
    converter.unicode_snob = True
    text = converter.handle(html_content)
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Core scraper
# ---------------------------------------------------------------------------
class CrimsonCircleScraper:
    def __init__(self, headless: bool = True, resume: bool = False):
        self.headless = headless
        self.state = load_state() if resume else {"completed_shouds": [], "completed_series": []}
        self.output_dir = Path(config.OUTPUT_DIR)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.pw = None
        self.browser = None
        self.page = None

    # -- Browser lifecycle --------------------------------------------------
    def start_browser(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(
            headless=self.headless,
            slow_mo=config.SLOW_MO,
        )
        self.page = self.browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 720},
        )
        self.page.set_default_timeout(config.PAGE_LOAD_TIMEOUT)

    def stop_browser(self):
        if self.page:
            self.page.close()
        if self.browser:
            self.browser.close()
        if self.pw:
            self.pw.stop()

    # -- Navigation helpers -------------------------------------------------
    def goto(self, url: str, retries: int = None):
        retries = retries or config.MAX_RETRIES
        for attempt in range(retries):
            try:
                self.page.goto(url, wait_until="domcontentloaded")
                # Wait a bit for dynamic content
                self.page.wait_for_timeout(2000)
                return
            except PlaywrightTimeout:
                log.warning("Timeout loading %s (attempt %d/%d)", url, attempt + 1, retries)
                if attempt < retries - 1:
                    time.sleep(config.RETRY_DELAY)
                else:
                    raise

    def get_page_html(self) -> str:
        return self.page.content()

    # -- Discovery ----------------------------------------------------------
    def discover_series(self) -> list[dict]:
        """
        Visit the library page and collect all series links.
        Returns a list of dicts: [{"name": ..., "url": ...}, ...]
        """
        log.info("Discovering series from %s", config.LIBRARY_URL)
        self.goto(config.LIBRARY_URL)
        html = self.get_page_html()
        soup = BeautifulSoup(html, "html.parser")

        series = []
        seen_urls = set()

        for selector in config.SELECTORS["series_links"]:
            for a_tag in soup.select(selector):
                href = a_tag.get("href", "")
                if not href:
                    continue
                full_url = urljoin(config.BASE_URL, href)

                # Must be under /library/ and one level deep
                if "/library/" not in full_url:
                    continue
                if is_excluded(full_url):
                    continue
                if url_depth(full_url) != 1:
                    continue
                if full_url in seen_urls:
                    continue

                seen_urls.add(full_url)
                name = a_tag.get_text(strip=True) or slug_from_url(full_url)
                series.append({
                    "name": name,
                    "slug": slug_from_url(full_url),
                    "url": full_url,
                })

        log.info("Found %d series", len(series))
        for s in series:
            log.info("  - %s (%s)", s["name"], s["url"])
        return series

    def discover_shouds(self, series_url: str) -> list[dict]:
        """
        Visit a series page and collect all shoud links.
        Returns a list of dicts: [{"name": ..., "url": ...}, ...]
        """
        log.info("Discovering shouds from %s", series_url)
        self.goto(series_url)
        html = self.get_page_html()
        soup = BeautifulSoup(html, "html.parser")

        series_slug = slug_from_url(series_url)
        shouds = []
        seen_urls = set()

        for selector in config.SELECTORS["shoud_links"]:
            for a_tag in soup.select(selector):
                href = a_tag.get("href", "")
                if not href:
                    continue
                full_url = urljoin(config.BASE_URL, href)

                # Must be under this series path and one level deeper
                if f"/library/{series_slug}/" not in full_url:
                    continue
                if is_excluded(full_url):
                    continue
                if url_depth(full_url) != 2:
                    continue
                if full_url in seen_urls:
                    continue

                seen_urls.add(full_url)
                name = a_tag.get_text(strip=True) or slug_from_url(full_url)
                shouds.append({
                    "name": name,
                    "slug": slug_from_url(full_url),
                    "url": full_url,
                })

        log.info("Found %d shouds in series", len(shouds))
        for s in shouds:
            log.info("  - %s (%s)", s["name"], s["url"])
        return shouds

    # -- Transcript extraction ----------------------------------------------
    def extract_transcript(self, shoud_url: str) -> str | None:
        """
        Visit a shoud page and extract the transcript text.
        Tries multiple selectors from config and picks the best match.
        """
        log.info("Extracting transcript from %s", shoud_url)
        self.goto(shoud_url)

        # Attempt to scroll down to trigger any lazy-loading
        self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        self.page.wait_for_timeout(1500)

        html = self.get_page_html()
        soup = BeautifulSoup(html, "html.parser")

        # Try each selector, pick the one with the most text
        best_text = ""
        best_selector = None

        for selector in config.SELECTORS["transcript_content"]:
            elements = soup.select(selector)
            for el in elements:
                # Remove nav, header, footer, script, style elements
                for tag in el.find_all(["nav", "header", "footer", "script", "style", "noscript"]):
                    tag.decompose()

                raw_html = str(el)
                text = html_to_clean_text(raw_html)

                if len(text) > len(best_text):
                    best_text = text
                    best_selector = selector

        if best_text and len(best_text) > 200:
            log.info("Extracted %d chars using selector '%s'", len(best_text), best_selector)
            return best_text
        else:
            log.warning("No substantial transcript found at %s (best was %d chars)", shoud_url, len(best_text))
            return best_text if best_text else None

    # -- File saving --------------------------------------------------------
    def save_transcript(self, series_slug: str, shoud_slug: str, title: str, text: str):
        """Save transcript to the proper folder structure."""
        series_dir = self.output_dir / series_slug
        series_dir.mkdir(parents=True, exist_ok=True)

        filepath = series_dir / f"{shoud_slug}{config.TRANSCRIPT_EXTENSION}"

        header = f"Title: {title}\nSeries: {series_slug}\nSource: {config.BASE_URL}/library/{series_slug}/{shoud_slug}\n{'=' * 60}\n\n"

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(header + text)

        log.info("Saved: %s", filepath)

    # -- Main scraping flows -----------------------------------------------
    def scrape_series(self, series: dict):
        """Scrape all shouds in a single series."""
        series_slug = series["slug"]
        series_name = series["name"]

        if series_slug in self.state["completed_series"]:
            log.info("Skipping already completed series: %s", series_name)
            return

        log.info("=" * 60)
        log.info("Scraping series: %s", series_name)
        log.info("=" * 60)

        shouds = self.discover_shouds(series["url"])

        for shoud in shouds:
            if shoud["url"] in self.state["completed_shouds"]:
                log.info("Skipping already completed shoud: %s", shoud["name"])
                continue

            try:
                transcript = self.extract_transcript(shoud["url"])
                if transcript:
                    self.save_transcript(series_slug, shoud["slug"], shoud["name"], transcript)
                    self.state["completed_shouds"].append(shoud["url"])
                    save_state(self.state)
                else:
                    log.warning("No transcript found for: %s", shoud["name"])
            except Exception as e:
                log.error("Failed to scrape shoud %s: %s", shoud["url"], e)

            time.sleep(config.DELAY_BETWEEN_SHOUDS)

        self.state["completed_series"].append(series_slug)
        save_state(self.state)

    def scrape_all(self):
        """Scrape the entire library."""
        series_list = self.discover_series()

        for i, series in enumerate(series_list, 1):
            log.info("Progress: series %d/%d", i, len(series_list))
            self.scrape_series(series)
            time.sleep(config.DELAY_BETWEEN_SERIES)

        log.info("=" * 60)
        log.info("SCRAPING COMPLETE")
        log.info("=" * 60)

    def discover_only(self):
        """Discover and print the full library structure without downloading."""
        series_list = self.discover_series()
        print(f"\n{'=' * 60}")
        print(f"Library Structure ({len(series_list)} series)")
        print(f"{'=' * 60}\n")

        total_shouds = 0
        for series in series_list:
            shouds = self.discover_shouds(series["url"])
            total_shouds += len(shouds)
            print(f"\n{series['name']} ({len(shouds)} shouds)")
            print(f"  URL: {series['url']}")
            for shoud in shouds:
                print(f"    - {shoud['name']}")
                print(f"      {shoud['url']}")
            time.sleep(config.DELAY_BETWEEN_SERIES)

        print(f"\nTotal: {len(series_list)} series, {total_shouds} shouds")

        # Save the structure to a JSON file for reference
        structure = {
            "series_count": len(series_list),
            "total_shouds": total_shouds,
            "series": [],
        }
        for series in series_list:
            shouds = self.discover_shouds(series["url"])
            structure["series"].append({
                "name": series["name"],
                "slug": series["slug"],
                "url": series["url"],
                "shouds": shouds,
            })

        with open("library_structure.json", "w", encoding="utf-8") as f:
            json.dump(structure, f, indent=2)
        print(f"\nStructure saved to library_structure.json")

    def run(self, discover_only: bool = False, single_series: str = None, resume: bool = False):
        """Main entry point."""
        try:
            self.start_browser()

            if discover_only:
                self.discover_only()
            elif single_series:
                # Find the matching series
                series_list = self.discover_series()
                match = None
                for s in series_list:
                    if single_series.lower() in s["slug"].lower() or single_series.lower() in s["name"].lower():
                        match = s
                        break
                if match:
                    self.scrape_series(match)
                else:
                    log.error("Series '%s' not found. Available series:", single_series)
                    for s in series_list:
                        log.error("  - %s (%s)", s["name"], s["slug"])
            else:
                self.scrape_all()
        finally:
            self.stop_browser()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Scrape transcripts from the Crimson Circle Library",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scraper.py --discover          # See the full library structure
  python scraper.py                     # Download all transcripts
  python scraper.py --series illumination  # Download one series
  python scraper.py --resume            # Continue an interrupted scrape
  python scraper.py --visible           # Run with visible browser
        """,
    )
    parser.add_argument(
        "--discover",
        action="store_true",
        help="Only discover and display the library structure (no downloading)",
    )
    parser.add_argument(
        "--series",
        type=str,
        default=None,
        help="Scrape only the series matching this name/slug",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume a previously interrupted scrape",
    )
    parser.add_argument(
        "--visible",
        action="store_true",
        help="Run with a visible browser window (not headless)",
    )
    args = parser.parse_args()

    headless = config.HEADLESS and not args.visible

    scraper = CrimsonCircleScraper(headless=headless, resume=args.resume)
    scraper.run(
        discover_only=args.discover,
        single_series=args.series,
        resume=args.resume,
    )


if __name__ == "__main__":
    main()
