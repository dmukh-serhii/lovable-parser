#!/usr/bin/env python3
"""
Shared Postgres (Neon) connection helper for pipeline scripts.

Role selection:
  - pipeline scripts (crawl/analyze/notify/export) use CRAWLER_DATABASE_URL
  - migration uses DATABASE_URL (owner)
  - both fall back to DATABASE_URL so a single-URL setup still works
Never hardcode credentials — everything comes from .env / environment.
"""
import os
import sys

import psycopg
from dotenv import load_dotenv

load_dotenv()


def database_url(role: str = "crawler") -> str:
    if role == "owner":
        url = os.getenv("DATABASE_URL")
    elif role == "admin":
        url = os.getenv("ADMIN_DATABASE_URL") or os.getenv("DATABASE_URL")
    else:
        url = os.getenv("CRAWLER_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        sys.exit(
            "No database URL configured.\n"
            "Set DATABASE_URL (and optionally CRAWLER_DATABASE_URL / ADMIN_DATABASE_URL) in .env\n"
            "Example: postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
        )
    return url


def connect(role: str = "crawler", autocommit: bool = False) -> psycopg.Connection:
    return psycopg.connect(database_url(role), autocommit=autocommit)
