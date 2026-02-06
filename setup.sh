#!/usr/bin/env bash
# Setup script for the Crimson Circle Library Scraper
set -e

echo "=== Crimson Circle Library Scraper Setup ==="

# Create virtual environment
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

echo "Activating virtual environment..."
source .venv/bin/activate

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Installing Playwright browsers (Chromium)..."
playwright install chromium
playwright install-deps chromium 2>/dev/null || true

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To get started:"
echo "  source .venv/bin/activate"
echo "  python scraper.py --discover    # Preview the library structure"
echo "  python scraper.py               # Download all transcripts"
echo ""
