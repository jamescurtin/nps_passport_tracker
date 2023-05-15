import json
from pathlib import Path


def main() -> None:
    cwd = Path(__file__)
    data_dir = cwd.parent.parent.parent / "src" / "data"
    visits_file = data_dir / "visits.json"
    with open(visits_file) as f:
        visits = json.load(f)
    sorted_visits = sorted(visits, key=lambda d: d["parkCode"])
    with open(visits_file, "w", encoding="utf-8") as f:
        json.dump(sorted_visits, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
