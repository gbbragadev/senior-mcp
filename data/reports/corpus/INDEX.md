# Report Model Corpus — Few-Shot Examples for LLM Report Generator

20 curated Senior HCM `.GER` report models selected from 2,541 parsed files
(984 vetorh + 1,557 sapiens). Each represents a distinct structural pattern.

Source directories:
- `vetorh`: `C:/Senior/discovery/report-models/parsed/vetorh/`
- `sapiens`: `C:/Senior/discovery/report-models/parsed/sapiens/`

---

## Model Index

| # | File | Module | Category | Bands | Fields | Errors | Key Features |
|---|------|--------|----------|-------|--------|--------|--------------|
| 01 | `01-simple-list_PLPR003.json` | vetorh/PLR | Simple list | 3 | 20 | 2 | CABECALHO+DETALHE+RODAPE, TSSistema, TSCadastro |
| 02 | `02-simple-list_PLCL002.json` | vetorh/PLR | Simple list | 5 | 36 | 2 | +2×TITULO, TSEspecial, absence records |
| 03 | `03-simple-list_RSCA002.json` | vetorh/RS | Simple list + totals | 5 | 30 | 3 | ADICIONAL with 3×TSTotal, selection rule |
| 04 | `04-break-report_BSCL002.json` | vetorh/BS | Break report | 6 | 40 | 2 | 1 SUBTOTAL+2 TITULO, TSTotal, benefits by location |
| 05 | `05-break-report_HRMU003.json` | vetorh/HR | Break report | 9 | 56 | 2 | 2×SUBTOTAL+3×TITULO, TSMemoran, vehicle infractions |
| 06 | `06-break-report_SMAT009.json` | vetorh/SM | Break report | 12 | 63 | 2 | 2×SUBTOTAL+2×TSMemoran, nested OUTRO bands, initialization rule |
| 07 | `07-break-report_CCCC020.json` | sapiens/CC | Break report | 9 | 63 | 2 | 2×SUBTOTAL+2×TITULO, sapiens plan accounting, dual CABECALHO |
| 08 | `08-total-report_BSBS001.json` | vetorh/BS | Total report | 8 | 33 | 3 | 2×TSTotal, 3×SUBTOTAL, InsClauSQLWhere, initialization |
| 09 | `09-total-report_PLPR040.json` | vetorh/PLR | Total report | 5 | 22 | 2 | TSTotal in SUBTOTAL band, TSEspecial fields |
| 10 | `10-total-report_SMCI006.json` | vetorh/SM | Total report | 9 | 68 | 2 | 11×TSTotal, 2×SUBTOTAL+ADICIONAL, preamble+selection rules |
| 11 | `11-complex-rules_FPGE008.json` | vetorh/FP | Complex rules | 8 | 65 | 2 | InsClauSqlWhere, MontarSqlHistorico, functionRule vars, initialization |
| 12 | `12-complex-rules_BSCL005.json` | vetorh/BS | Complex rules | 7 | 53 | 3 | 7× InsClauSQLWhere calls, MontarSqlHistorico×5, MontaAbrangencia |
| 13 | `13-complex-rules_CCCC002.json` | sapiens/CC | Complex rules | 10 | 66 | 2 | Cursor SQL, AlteraControle, MMCria, BuscarFilialMaiorRelevancia |
| 14 | `14-complex-rules_CCCC011.json` | sapiens/CC | Complex rules | 7 | 45 | 2 | 5724-char preamble, 31813-char functionRule, AlteraControle, Se/Senao |
| 15 | `15-multi-detail_BSBS002.json` | vetorh/BS | Multi-detail | 4 | 32 | 4 | 2×DETALHE (Det_Col + Det_Dep), employee+dependent join pattern |
| 16 | `16-multi-detail_VAAT001.json` | sapiens/VA | Multi-detail | 8 | 55 | 5 | 4×DETALHE (occurrence/item/psi/toc), TSMemoran per detail |
| 17 | `17-drawings_CSPU001.json` | vetorh/CS | Drawings/shapes | 7 | 57 | 2 | 18×TSDesenho as layout lines/boxes, Landscape, profile table |
| 18 | `18-drawings_SMAT021.json` | vetorh/SM | Drawings/shapes | 8 | 226 | 1 | 108×TSDesenho calendar grid, 62×TSFormula, 20×TSTotal, Landscape |
| 19 | `19-system-vars_BSGE001.json` | vetorh/BS | System vars | 10 | 339 | 5 | 4×TSSistema (empatu/numpag/datatu/NomEmp), 72×TSTotal, Landscape |
| 20 | `20-memo-image_HRGE003.json` | vetorh/HR | Memo/image | 14 | 35 | 1 | 4×TSImagem+2×TSMemoran, 12×TSDesenho, ListaSecao() calls in onAfterPrint |

---

## Category Notes

### Simple List (01–03)

**01 PLPR003** — The minimal archetype: 3 bands, no preamble, no rules. The DETALHE band
(`Detalhe_1`) has 8 `TSCadastro` fields and the CABECALHO has the standard header bar
(`TSDesenho` line + 3 `TSSistema` for EmpAtu/page/date + labels). Use this as the baseline
template skeleton.

**02 PLCL002** — Adds two `TITULO` bands (group title rows): `Subtitulo_1` and
`Subtitulo_Espaco`. Shows how a title-only row without a SUBTOTAL creates a visual grouping
header. `TSEspecial` components appear as variable-width fields. Absence records from R038AFA.

**03 RSCA002** — Minimal preamble (`selection` rule only). Shows a `TITULO`+`ADICIONAL` pattern
where `ADICIONAL` is the grand-total footer with 3×`TSTotal` (sum/count). Recruitment (RS)
module candidate list by course and period.

---

### Break Reports (04–07)

**04 BSCL002** — Clean two-level break: `TITULO SubtitEmp` → `TITULO SubtitLoc` → `DETALHE` →
`SUBTOTAL SubtotLoc`. TSTotal in the subtotal. Benefits assignment by location. No preamble —
the break is driven purely by band structure and field sort order.

**05 HRMU003** — Three-level break: `TITULO Subtitulo_Empresa` → `TITULO Subtitulo_Infracao` →
`TITULO Subtitulo_Local`. Two `SUBTOTAL` bands. Has a `TSMemoran` in `OUTRO Adicional_Obs`.
Shows how memo fields attach as auxiliary data rows. Vehicle infraction tracking.

**06 SMAT009** — 12-band medication dispensing report. Two `SUBTOTAL` levels (date and drug
name). Four `OUTRO` bands used for recommendations, annotations, and memo lists. The
`initialization` section declares global running counters. Good example of non-trivial band
nesting.

**07 CCCC020** — Sapiens accounting plan (E045PLA). Shows dual `CABECALHO` pattern
(`Cabecalho` + `Cabecalho_Colunas`), two-level breaks by filial/account, and an `OUTRO
Adicional_Rateio` with 4×`TSCadastro`+4×`TSFormula`+`TSMemoran`. Sapiens-style `TSFormula`
predominates over `TSCadastro`.

---

### Total Reports (08–10)

**08 BSBS001** — Benefits movement totals. Three `SUBTOTAL` bands in a hierarchy. Short
`preambleSelect` with `InsClauSQLWhere` filtering by movement origin. `initialization` resets a
flag. `TSTotal` appears in `SUBTOTAL` bands (subtotals) and a `SUBTITULO` band. Good minimal
totals pattern.

**09 PLPR040** — Simplest possible totals report: 5 bands, no preamble. `TITULO` + `DETALHE` +
`SUBTOTAL` with a single `TSTotal`. `TSEspecial` fields (variable-bound) in PLR context. Shows
that a functional total report needs very little code.

**10 SMCI006** — Rich totals report: 11×`TSTotal` spread across `SUBTOTAL Subtotal_Filial`,
`SUBTOTAL Subtotal_Mandato`, and `ADICIONAL Total_Geral`. `preambleSelect` builds a date filter
(`EDatRef`/`EDatFim`); `selection` section declares abrangência. CID committee tracking (CIPA).

---

### Complex Rules (11–14)

**11 FPGE008** — Best example of multi-section rule decomposition. `functionRule` declares all
global variables. `initialization` resets counters. `preambleSelect` builds SQL with
`InsClauSqlWhere`, `MontarSqlHistorico` (×2), and `ConverteDataBanco`. Shows the canonical
pattern for historic-table joins. Workforce movement (admissions/dismissals/transfers).

**12 BSCL005** — Most calls to `InsClauSQLWhere` in any clean model: 7 calls targeting a single
DETALHE band (`Detalhe_R038HPO`). Combines `MontarSqlHistorico` (×5 different history tables),
`MontaAbrangencia`, date comparison strings. A complete reference for multi-table historic joins.
Work post (posto de trabalho) history listing.

**13 CCCC002** — Sapiens general ledger (balancete). Uses `Definir Cursor` + `AbrirCursor` /
`FecharCursor` for in-preamble SQL lookups. `AlteraControle` to show/hide bands dynamically.
`MMCria` / `MMLibera` for memory-mapped currency conversion. `ConsistirLctoAContabilizar` for
data validation. Shows the full sapiens preamble idiom.

**14 CCCC011** — Extreme rule complexity: 5,724-char preamble + 31,813-char `functionRule`. The
`functionRule` is effectively a library of helper functions. `AlteraControle` used extensively
to switch report title and column labels based on entry parameter `ETipSal`. Good reference for
conditional layout control. Balancete contábil/centros de custo.

---

### Multi-Detail (15–16)

**15 BSBS002** — The archetype for a two-master-detail structure: `Det_Col` (employee) and
`Det_Dep` (dependent) as sibling `DETALHE` bands. The `preambleSelect` filters dependent
records via `InsClauSQLWhere`. 12×`TSCadastro` spread across two detail sections. Employee
dependent listing.

**16 VAAT001** — Sapiens occupational-health report with 4×`DETALHE` bands representing
independent record types: `Detalhe_Ocorrencia`, `Detalhe_Item`, `Detalhe_Psi`, `Detalhe_Toc`.
Each paired with an `OUTRO` band as its column header. `TSMemoran` in `Detalhe_Toc`. Shows
multi-entity tabular layout without breaks.

---

### Drawings/Shapes (17–18)

**17 CSPU001** — Access-control profile permissions table. 18×`TSDesenho` draw the grid lines
and box borders. Landscape orientation. 4×`OUTRO` bands used as alternative layout views
(`Detalhe_Perfil` vs `Detalhe_Simples`). `initialization` sets view mode. `TSDesenho` with
`caption:"  "` is the Senior convention for a rectangle/line.

**18 SMAT021** — Absenteism calendar. 108×`TSDesenho` used to draw a monthly calendar grid
where each cell is a line/rectangle. 62×`TSFormula` calculate day-of-week positions and
absenteeism counts. 20×`TSTotal` accumulate per-cell totals. Landscape. `functionRule` defines
the calendar rendering logic. Extreme use of `TSDesenho` as coordinate-based drawing.

---

### System Variables (19)

**19 BSGE001** — Benefits annual comparison. Canonical usage of all 4 `TSSistema` components:
`EmpAtu` (current company), `NomEmp` (company name), `NumPag` (page number), `DatAtu` (current
date). Landscape. 72×`TSTotal` and 188×`TSFormula` in a single `OUTRO Adicional_Beneficios` band
(computed benefit matrix). Shows how an auxiliary OUTRO band can hold an entire computed table.

---

### Memo / Image (20)

**20 HRGE003** — Timekeeping installation validation checklist. 4×`TSImagem` display checkmarks
or X icons per validation item. 2×`TSMemoran` provide scrollable text areas. 12×`TSDesenho`
draw separator lines. `onAfterPrint` of the CABECALHO calls `ListaSecao()` eight times to
sequence section printing — the only example in the corpus of explicit section control.

---

## Component Type Reference

| Type | Description | Example use |
|------|-------------|-------------|
| `TSCadastro` | Database-bound field | Employee name, department code |
| `TSDescricao` | Static label / description | Column header, section title |
| `TSFormula` | Computed expression | Calculated totals, string formatting |
| `TSSistema` | System variable | Page number, company, date |
| `TSTotal` | Accumulator / running total | Sum by group, grand total |
| `TSDesenho` | Drawing element (line/box) | Grid lines, border rectangles |
| `TSMemoran` | Multi-line memo / text area | Recommendations, observations |
| `TSImagem` | Image/icon | Checkmark icons, company logo |
| `TSEspecial` | Variable-format special field | Formatted codes, multi-column cells |
| `TSCodBarra` | Barcode | Document barcodes |
| `TSGrade` | Grid/table component | Tabular data grids |

## Band Type Reference

| Band | Usage |
|------|-------|
| `CABECALHO` | Page header (printed on each page top) |
| `RODAPE` | Page footer (printed on each page bottom) |
| `DETALHE` | Detail rows (one per record in the query) |
| `TITULO` | Group title / break header (before group) |
| `SUBTOTAL` | Group subtotal / break footer (after group) |
| `ADICIONAL` | Grand total / overall summary at report end |
| `OUTRO` | Auxiliary band: conditional section, alternative view, memo block |

## Rule Sections Reference

| Section | Purpose |
|---------|---------|
| `preambleSelect` | Runs before the SQL query — calls `InsClauSQLWhere`, `MontarSqlHistorico`, `MontaAbrangencia` |
| `selection` | Filters / abrangência parameters passed to the query |
| `initialization` | Runs once at report start — initializes global variables |
| `finalization` | Runs once at report end |
| `functionRule` | Global variable declarations and helper function definitions |
| `printPage` | Runs on each page print event |
