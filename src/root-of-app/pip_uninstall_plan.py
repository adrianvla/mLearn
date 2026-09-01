"""Compute a dependency-safe pip uninstall plan.

Usage: python pip_uninstall_plan.py <candidates.json> <roots.json>

candidates: normalized package names that removing a component may drop.
roots:      PEP 508 requirement strings that must stay (core group + every
            remaining enabled component group + language requirements), e.g.
            "torch==2.10.0" or "fugashi[unidic-lite]".

A candidate is only removable when no root requires it transitively.
Requirement markers are evaluated per PEP 508 using the extras each edge
requests, so extras-based language requirements (fugashi[unidic-lite]) keep
their extra dependencies protected while a plain dependency on the same
distribution does not. Unparseable markers evaluate conservatively (kept).
On any probe failure the script exits non-zero so the caller aborts removal
instead of guessing.
"""

import json
import sys

try:
    from importlib.metadata import Distribution
    from importlib.metadata import distributions
    from packaging.requirements import Requirement
except Exception as exc:  # pragma: no cover - environment problem, reported to caller
    print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
    sys.exit(1)


def normalize(name: str) -> str:
    return name.lower().replace("_", "-")


class _SimpleDistribution:
    """Duck-typed stand-in for importlib.metadata.Distribution (tests)."""

    def __init__(self, name: str, requires: list[str] | None):
        self._name = normalize(name)
        self._requires = requires

    @property
    def metadata(self) -> dict:
        return {"Name": self._name}

    @property
    def requires(self) -> list[str] | None:
        return self._requires


def compute_plan(
    candidates: list[str],
    roots: list[str],
    installed: list[Distribution] | None = None,
) -> dict:
    """Return {"remove": [...], "keep": [...]} for the given candidates/roots."""
    candidate_names = {normalize(name) for name in candidates}

    by_name: dict[str, Distribution] = {}
    for dist in (distributions() if installed is None else installed):
        meta_name = dist.metadata.get("Name")
        if meta_name:
            by_name.setdefault(normalize(meta_name), dist)

    # BFS state: name -> extras accumulated across all edges reaching it.
    extras_by_name: dict[str, frozenset[str]] = {}
    required: set[str] = set()
    pending: list[tuple[str, frozenset[str]]] = []

    for root in roots:
        try:
            req = Requirement(root)
        except Exception:
            continue
        name = normalize(req.name)
        if name in by_name:
            pending.append((name, frozenset(req.extras)))

    while pending:
        name, extras = pending.pop()
        known = extras_by_name.get(name, frozenset())
        merged = known | extras
        if name in required and merged == known:
            continue
        extras_by_name[name] = merged
        required.add(name)
        for raw in (by_name[name].requires or []):
            try:
                dep = Requirement(raw)
            except Exception as exc:
                # An edge we cannot parse might secretly require any candidate.
                # Abort the plan; the caller skips removal instead of guessing.
                return {"error": f"unparseable requirement on {name!r}: {exc}"}
            dep_name = normalize(dep.name)
            if dep_name not in by_name:
                continue
            if dep.marker is not None:
                applies = False
                for extra in (merged | {""}) if merged else {""}:
                    try:
                        if dep.marker.evaluate({"extra": extra}):
                            applies = True
                            break
                    except Exception:
                        # Unparseable marker: keep the dependency conservatively.
                        applies = True
                        break
                if not applies:
                    continue
            dep_extras = frozenset(dep.extras)
            dep_known = extras_by_name.get(dep_name, frozenset())
            if dep_name not in required or not dep_extras <= dep_known:
                pending.append((dep_name, dep_extras))

    return {
        "remove": sorted(candidate_names - required),
        "keep": sorted(candidate_names & required),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(json.dumps({"error": "usage: pip_uninstall_plan.py <candidates.json> <roots.json>"}))
        return 2
    try:
        plan = compute_plan(json.loads(argv[1]), json.loads(argv[2]))
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        return 1
    print(json.dumps(plan))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
