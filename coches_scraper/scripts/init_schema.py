from __future__ import annotations

from pathlib import Path

from coches_scraper.database.session import get_engine


def main() -> None:
    schema_path = Path(__file__).resolve().parents[1] / "database" / "schema_scraper.sql"
    sql = schema_path.read_text(encoding="utf-8")
    engine = get_engine()
    with engine.raw_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    print(f"Schema aplicado: {schema_path}")


if __name__ == "__main__":
    main()
