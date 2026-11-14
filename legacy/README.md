# Legacy Litera demos

`filipino-demo/` is the original standalone browser demo. It uses separate local data and can be served with `python -m http.server 8080 --directory legacy/filipino-demo`.

The older English prototype remains in the repository's `litera-reading-checks/` directory, the standalone phonics lab in `phonics/`, and the voice lab in `voice/`. The voice package also supplies shared rules to the integrated app. Start the current English learner and teacher portals with the repository-root `Start-Litera.cmd`. The integrated launch uses `frontend/`, `backend/`, and the existing SQLite data under `.litera-data/`.
