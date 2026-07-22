#!/usr/bin/env python3
"""Busca URLs de imágenes vía DuckDuckGo/Bing (ddgs), sin API key.

Uso: python scripts/buscar-imagenes-ddg.py "query" [max]
Imprime JSON: [{ "original": "...", "thumbnail": "...", "width": 0, "height": 0 }, ...]
"""
from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("[]")
        return 0
    query = sys.argv[1]
    max_results = int(sys.argv[2]) if len(sys.argv) > 2 else 8

    try:
        from ddgs import DDGS
    except ImportError:
        print(
            json.dumps({"error": "Falta el paquete ddgs. Corré: .venv-enrich/bin/pip install ddgs"}),
            file=sys.stderr,
        )
        return 2

    results = []
    try:
        # backend auto prueba duckduckgo y bing
        raw = DDGS().images(
            query,
            region="ar-es",
            safesearch="on",
            max_results=max_results,
        )
        for item in raw or []:
            url = item.get("image") or item.get("url") or item.get("thumbnail")
            if not url:
                continue
            results.append(
                {
                    "original": url,
                    "thumbnail": item.get("thumbnail") or url,
                    "width": item.get("width") or 0,
                    "height": item.get("height") or 0,
                    "title": item.get("title") or "",
                    "source": item.get("source") or "",
                }
            )
    except Exception as exc:  # noqa: BLE001 — devolver error legible al caller
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    print(json.dumps(results, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
