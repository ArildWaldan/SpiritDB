"""
Configuration for the Crimson Circle Library scraper.

Adjust selectors and settings here if the website structure changes.
"""

# Base URL
BASE_URL = "https://www.crimsoncircle.com"
LIBRARY_URL = f"{BASE_URL}/library"

# Output directory for downloaded transcripts
OUTPUT_DIR = "data/crimson-circle/library"

# Browser settings
HEADLESS = True  # Set to False to see the browser while scraping
SLOW_MO = 500    # Milliseconds between actions (be respectful to the server)

# Delays (seconds) - be polite to the server
DELAY_BETWEEN_SERIES = 3
DELAY_BETWEEN_SHOUDS = 2
PAGE_LOAD_TIMEOUT = 30000  # ms

# Retry settings
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

# CSS Selectors - adjust these if the site structure changes
# These are best-effort defaults; run with --discover to auto-detect
SELECTORS = {
    # On the /library page: links to individual series
    "series_links": [
        'a[href*="/library/"]',
    ],
    # On a series page: links to individual shoud pages
    "shoud_links": [
        'a[href*="/library/"]',
    ],
    # On a shoud page: the transcript content container
    "transcript_content": [
        "article",
        ".transcript",
        ".shoud-transcript",
        ".entry-content",
        ".content-body",
        ".post-content",
        "main .content",
        "#content",
        "main",
    ],
}

# URL patterns to exclude (navigation, footer links, etc.)
EXCLUDE_URL_PATTERNS = [
    "/library$",
    "/library/$",
    "/login",
    "/register",
    "/cart",
    "/account",
    "/search",
    "#",
    "javascript:",
    "mailto:",
]

# File extensions to use for saved transcripts
TRANSCRIPT_EXTENSION = ".txt"
