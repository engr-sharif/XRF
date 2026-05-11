# SBMM OU1 — XRF Field Data Viewer

Static web app for browsing, reconciling, and exporting XRF readings from the
SBMM OU1 boulder sampling campaign (Tasks 2.1.6 & 2.1.7).

The site reads the master gun CSVs and the field tracker spreadsheet, joins
them by `(gun serial, Reading No)`, and exposes:

- **Drill-down browser** — 7 areas → 15 grids → boulders → individual readings
- **Boulder detail** with tabs: Surface XRF · Depth XRF · Powder & Lab · QC
- **Element picker** — defaults to As, Pb, Hg, Sb, Cu, Zn, Fe, Mn; expandable to all 45 elements present in the data
- **CSV export** — by reading-number list/range or by Sample ID, pulling the full column set straight from the master gun CSVs
- **Daily Verification log** — IARM 35NN system checks, pass/fail
- **Daily Field Log** — per-day boulder/reading/powder counts and notes
- **Reconciliation** — readings in the gun CSVs that are not linked to any tracker entry

## Layout

```
.
├── SBMM_XRF_Sample_Tracker_*.xlsx      # master tracker (system of record)
├── SBM-XRF-X500456_Master_*.csv        # gun X500456 readings (raw)
├── SBM-XRF-X501203_Master_*.csv        # gun X501203 readings (raw)
├── scripts/
│   └── build_data.py                   # ingests XLSX + CSVs → site/data/data.json
├── site/                               # static site (served by GitHub Pages)
│   ├── index.html
│   ├── css/styles.css
│   ├── js/app.js
│   └── data/
│       ├── data.json                   # generated; checked in for Pages deploy
│       └── *.csv                       # source CSVs copied here for client-side export
└── .github/workflows/pages.yml         # rebuilds + deploys on push to main
```

## Updating the data

1. Drop new gun CSVs and/or an updated `SBMM_XRF_Sample_Tracker_*.xlsx` at the repo root.
2. Run:

   ```bash
   pip install openpyxl
   python scripts/build_data.py
   ```

3. Commit the updated `site/data/` and push. GitHub Pages rebuilds automatically.

## Running locally

```bash
python scripts/build_data.py
cd site && python -m http.server 8000
# open http://127.0.0.1:8000
```

No build step beyond the data build — the site is plain HTML + JS.

## Notes

- Reading-to-boulder linking uses the tracker's `XRF S/N` + `XRF Rdg #` columns as
  the canonical mapping. The CSV `Sample` column is used as a fallback / sanity check.
- `<LOD` (below limit of detection) values are preserved as strings, not zeros.
- The `_csv` field on each joined reading carries the full element map from the gun CSV.
