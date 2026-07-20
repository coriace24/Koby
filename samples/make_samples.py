"""Create example property documents for testing Koby:
- Maple Court Apartments — 15 units, one vacancy, in-place rents below market.
- Matching T-12 whose totals reconcile with the rent roll.
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ARIAL = "Arial"
HDR_FILL = PatternFill("solid", fgColor="1F3864")
HDR_FONT = Font(name=ARIAL, bold=True, color="FFFFFF", size=10)
BASE = Font(name=ARIAL, size=10)
BOLD = Font(name=ARIAL, bold=True, size=10)
TITLE = Font(name=ARIAL, bold=True, size=14)
SUB = Font(name=ARIAL, size=10, italic=True, color="555555")
THIN = Border(bottom=Side(style="thin", color="CCCCCC"))
MONEY = "$#,##0"

# ---------------- Rent Roll ----------------
units = [
    # unit, type, sqft, tenant, status, market, actual, lease_start, lease_end
    ("101", "1BR/1BA", 650, "J. Alvarez",   "Occupied", 1000, 850, "2025-04-01", "2026-03-31"),
    ("102", "1BR/1BA", 650, "M. Chen",      "Occupied", 1000, 825, "2024-11-01", "2026-10-31"),
    ("103", "1BR/1BA", 650, "T. Robinson",  "Occupied", 1000, 850, "2025-07-15", "2026-07-14"),
    ("104", "2BR/1BA", 900, "S. Patel",     "Occupied", 1150, 975, "2025-01-01", "2026-12-31"),
    ("105", "2BR/1BA", 900, "K. Nguyen",    "Occupied", 1150, 950, "2024-09-01", "2026-08-31"),
    ("201", "1BR/1BA", 650, "D. Okafor",    "Occupied", 1000, 860, "2025-10-01", "2026-09-30"),
    ("202", "1BR/1BA", 650, "R. Silva",     "Occupied", 1000, 845, "2025-03-01", "2026-02-28"),
    ("203", "1BR/1BA", 650, "A. Kowalski",  "Occupied", 1000, 850, "2025-06-01", "2026-05-31"),
    ("204", "2BR/1BA", 900, "L. Johnson",   "Occupied", 1150, 985, "2025-12-01", "2026-11-30"),
    ("205", "2BR/1BA", 900, "VACANT",       "Vacant",   1150, 0,   "", ""),
    ("301", "1BR/1BA", 650, "P. Martin",    "Occupied", 1000, 875, "2026-02-01", "2027-01-31"),
    ("302", "1BR/1BA", 650, "H. Sato",      "Occupied", 1000, 830, "2024-12-01", "2026-11-30"),
    ("303", "1BR/1BA", 650, "B. Fischer",   "Occupied", 1000, 855, "2025-08-01", "2026-07-31"),
    ("304", "2BR/1BA", 900, "C. Dubois",    "Occupied", 1150, 995, "2026-01-15", "2027-01-14"),
    ("305", "2BR/1BA", 900, "N. Ali",       "Occupied", 1150, 960, "2025-05-01", "2026-04-30"),
]

wb = Workbook()
ws = wb.active
ws.title = "Rent Roll"

ws["A1"] = "Maple Court Apartments — Rent Roll"
ws["A1"].font = TITLE
ws["A2"] = "1428 Maple Court, Springfield, IL · As of June 30, 2026 · Example data for demonstration"
ws["A2"].font = SUB

headers = ["Unit", "Type", "Sq Ft", "Tenant", "Status", "Market Rent", "Actual Rent", "Lease Start", "Lease End"]
for c, h in enumerate(headers, start=1):
    cell = ws.cell(row=4, column=c, value=h)
    cell.font = HDR_FONT
    cell.fill = HDR_FILL
    cell.alignment = Alignment(horizontal="center")

r = 5
for u in units:
    for c, v in enumerate(u, start=1):
        cell = ws.cell(row=r, column=c, value=v)
        cell.font = BASE
        cell.border = THIN
        if c in (6, 7):
            cell.number_format = MONEY
        if c in (1, 5, 8, 9):
            cell.alignment = Alignment(horizontal="center")
    r += 1

tot = r
ws.cell(row=tot, column=1, value="TOTAL (15 units)").font = BOLD
ws.cell(row=tot, column=3, value=sum(u[2] for u in units)).font = BOLD
ws.cell(row=tot, column=6, value=sum(u[5] for u in units)).font = BOLD
ws.cell(row=tot, column=7, value=sum(u[6] for u in units)).font = BOLD
ws.cell(row=tot, column=6).number_format = MONEY
ws.cell(row=tot, column=7).number_format = MONEY

r = tot + 2
notes = [
    "Occupancy: 14 of 15 units occupied (93.3%).",
    "Monthly gross potential rent (in-place + vacant at in-place level): =G20+975 is not used; GPR taken as actual occupied rent plus $975 for unit 205.",
    "Market rents based on comparable listings within 1 mile (June 2026). Example data — not a real property.",
]
# Keep notes simple/plain text (no formulas inside text)
notes[1] = "Monthly scheduled rent incl. unit 205 at prior in-place rent of $975: $13,480."
for n in notes:
    ws.cell(row=r, column=1, value=n).font = SUB
    r += 1

widths = [7, 10, 7, 16, 10, 12, 12, 12, 12]
for i, w in enumerate(widths, start=1):
    ws.column_dimensions[get_column_letter(i)].width = w

wb.save("sample-rent-roll.xlsx")

# ---------------- T-12 ----------------
months = ["Jul-25", "Aug-25", "Sep-25", "Oct-25", "Nov-25", "Dec-25",
          "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26"]

# Monthly figures (12 values each). Unit 205 vacant since March 2026.
gpr = [13480] * 12
vacancy = [0, 0, 0, 0, 0, 0, 0, 0, 975, 975, 975, 975]  # unit 205 vacant Mar–Jun 26
concessions = [0, 425, 0, 0, 0, 0, 430, 0, 0, 0, 0, 0]
laundry = [255, 260, 250, 265, 258, 262, 249, 251, 264, 267, 255, 264]
parking = [325, 325, 325, 325, 325, 325, 300, 300, 325, 325, 325, 325]
pet = [90, 90, 120, 90, 90, 90, 60, 60, 90, 120, 90, 90]

taxes = [1517] * 11 + [1513]
insurance = [800] * 12
utilities = [1180, 1120, 990, 1010, 1240, 1420, 1510, 1465, 1210, 1010, 940, 1005]
repairs = [740, 615, 980, 1870, 690, 720, 1150, 880, 2340, 760, 705, 950]
mgmt = [round(0.08 * (g - v - c + l + p + f)) for g, v, c, l, p, f in
        zip(gpr, vacancy, concessions, laundry, parking, pet)]
landscaping = [260, 260, 260, 260, 180, 420, 480, 460, 260, 260, 260, 260]
admin = [175] * 12
misc = [180, 210, 195, 240, 185, 320, 205, 190, 260, 215, 180, 230]

wb2 = Workbook()
t = wb2.active
t.title = "T-12"

t["A1"] = "Maple Court Apartments — Trailing 12-Month Operating Statement"
t["A1"].font = TITLE
t["A2"] = "1428 Maple Court, Springfield, IL · July 2025 – June 2026 · Example data for demonstration"
t["A2"].font = SUB

t.cell(row=4, column=1, value="Line Item").font = HDR_FONT
t.cell(row=4, column=1).fill = HDR_FILL
for c, mth in enumerate(months, start=2):
    cell = t.cell(row=4, column=c, value=mth)
    cell.font = HDR_FONT
    cell.fill = HDR_FILL
    cell.alignment = Alignment(horizontal="center")
last_col = len(months) + 2
cell = t.cell(row=4, column=last_col, value="T-12 Total")
cell.font = HDR_FONT
cell.fill = HDR_FILL
cell.alignment = Alignment(horizontal="center")

def put_row(row, label, values, sign=1, bold=False):
    t.cell(row=row, column=1, value=label).font = BOLD if bold else BASE
    for c, v in enumerate(values, start=2):
        cell = t.cell(row=row, column=c, value=sign * v)
        cell.number_format = MONEY
        cell.font = BOLD if bold else BASE
    cell = t.cell(row=row, column=last_col, value=sign * sum(values))
    cell.number_format = MONEY
    cell.font = BOLD

def section(row, label):
    t.cell(row=row, column=1, value=label).font = BOLD
    return row + 1

r = 6
r = section(r, "INCOME")
put_row(r, "Gross Potential Rent", gpr); r += 1
put_row(r, "Vacancy Loss", vacancy, sign=-1); r += 1
put_row(r, "Concessions / Bad Debt", concessions, sign=-1); r += 1
put_row(r, "Laundry Income", laundry); r += 1
put_row(r, "Parking Income", parking); r += 1
put_row(r, "Pet Fees", pet); r += 1
egi_row = r
t.cell(row=r, column=1, value="Effective Gross Income").font = BOLD
egi = [g - v - c2 + l + p + f for g, v, c2, l, p, f in zip(gpr, vacancy, concessions, laundry, parking, pet)]
for c, v in enumerate(egi + [sum(egi)], start=2):
    cell = t.cell(row=r, column=c, value=v)
    cell.number_format = MONEY
    cell.font = BOLD
r += 2

r = section(r, "OPERATING EXPENSES")
exp_start = r
put_row(r, "Property Taxes", taxes); r += 1
put_row(r, "Insurance", insurance); r += 1
put_row(r, "Utilities (water/sewer/common electric)", utilities); r += 1
put_row(r, "Repairs & Maintenance", repairs); r += 1
put_row(r, "Management Fee (8% of collections)", mgmt); r += 1
put_row(r, "Landscaping & Snow Removal", landscaping); r += 1
put_row(r, "Administrative", admin); r += 1
put_row(r, "Miscellaneous", misc); r += 1
exp_end = r - 1
t.cell(row=r, column=1, value="Total Operating Expenses").font = BOLD
texp = [sum(vals) for vals in zip(taxes, insurance, utilities, repairs, mgmt, landscaping, admin, misc)]
for c, v in enumerate(texp + [sum(texp)], start=2):
    cell = t.cell(row=r, column=c, value=v)
    cell.number_format = MONEY
    cell.font = BOLD
texp_row = r
r += 2

t.cell(row=r, column=1, value="NET OPERATING INCOME").font = BOLD
noi = [e - x for e, x in zip(egi, texp)]
for c, v in enumerate(noi + [sum(noi)], start=2):
    cell = t.cell(row=r, column=c, value=v)
    cell.number_format = MONEY
    cell.font = BOLD
r += 2
t.cell(row=r, column=1,
       value="Notes: No on-site payroll — property is externally managed (see management fee). "
             "Unit 205 vacant since March 2026. Example data — not a real property.").font = SUB

t.column_dimensions["A"].width = 38
for c in range(2, last_col + 1):
    t.column_dimensions[get_column_letter(c)].width = 10

wb2.save("sample-t12.xlsx")
print("written")
