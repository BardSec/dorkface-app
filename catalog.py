"""Ready-made dorks for the Catalog tab.

Each entry fills builder fields (see src/dork_core.js FIELDS); the user adds their domain,
which goes in site:. Keep them aimed at auditing your own organization: what has Google
indexed that shouldn't be public? tests/test_catalog.py checks every entry builds.

Entry keys:
  id           stable slug (used in #catalog/<id> links)
  category     one of CATEGORIES
  label        plain-English title
  description  one or two sentences: what it finds and why it matters
  fields       builder fields (anything but site)
  next         optional: what to do if it finds something
"""

CATEGORIES = [
    "Exposed spreadsheets & data",
    "Sensitive documents",
    "Config, logs & backups",
    "Login & admin pages",
    "Directory listings",
]

_SPREADSHEET_NEXT = ("Open each result and check who should see it. If it holds staff or student data, remove it or "
                     "put it behind a sign-in, then ask Google to drop it (Search Console → Removals).")

CATALOG = [
    # --- Exposed spreadsheets & data ---------------------------------------------
    {
        "id": "spreadsheets",
        "category": "Exposed spreadsheets & data",
        "label": "Excel spreadsheets on your site",
        "description": "Every .xlsx file Google has indexed on your domain. Spreadsheets are the most common way "
                       "rosters, budgets and exports end up public by accident.",
        "fields": {"filetype": "xlsx"},
        "next": _SPREADSHEET_NEXT,
    },
    {
        "id": "old-spreadsheets",
        "category": "Exposed spreadsheets & data",
        "label": "Older Excel files (.xls)",
        "description": "Pre-2007 Excel files. Old uploads tend to be forgotten, and they're often from systems "
                       "nobody maintains anymore.",
        "fields": {"filetype": "xls"},
        "next": _SPREADSHEET_NEXT,
    },
    {
        "id": "csv-exports",
        "category": "Exposed spreadsheets & data",
        "label": "CSV exports",
        "description": "CSV files are what most systems (SIS, HR, finance) export. One on a public page is "
                       "usually a mistake.",
        "fields": {"filetype": "csv"},
        "next": _SPREADSHEET_NEXT,
    },
    {
        "id": "student-spreadsheets",
        "category": "Exposed spreadsheets & data",
        "label": "Spreadsheets that mention students",
        "description": "Excel files containing words like “student ID”, “date of birth” or “grade level”. "
                       "Anything that turns up here may be a FERPA issue.",
        "fields": {"filetype": "xlsx", "anyof": "student id, date of birth, grade level, guardian"},
        "next": "Treat a hit as a possible FERPA disclosure: take the file down first, then follow your "
                "district's incident process.",
    },
    {
        "id": "staff-spreadsheets",
        "category": "Exposed spreadsheets & data",
        "label": "Spreadsheets with staff pay or personal details",
        "description": "Excel files mentioning salaries, employee IDs or home addresses.",
        "fields": {"filetype": "xlsx", "anyof": "salary, employee id, home address, ssn"},
        "next": _SPREADSHEET_NEXT,
    },

    # --- Sensitive documents -----------------------------------------------------
    {
        "id": "confidential-docs",
        "category": "Sensitive documents",
        "label": "Documents marked confidential",
        "description": "Pages and files carrying a confidentiality label. Labels are often added to things that "
                       "were never meant to be posted.",
        "fields": {"anyof": "confidential, internal use only, do not distribute"},
    },
    {
        "id": "confidential-pdfs",
        "category": "Sensitive documents",
        "label": "PDFs marked confidential",
        "description": "The same labels, limited to PDFs (board packets, scanned forms, contracts).",
        "fields": {"filetype": "pdf", "anyof": "confidential, internal use only, do not distribute"},
    },
    {
        "id": "iep-504",
        "category": "Sensitive documents",
        "label": "Special education documents (IEP / 504)",
        "description": "PDFs that mention IEPs or 504 plans. Blank templates are fine; filled-in plans are not.",
        "fields": {"filetype": "pdf", "anyof": "IEP, 504 plan, individualized education program"},
        "next": "A filled-in plan is a FERPA disclosure: take it down first, then follow your district's "
                "incident process.",
    },
    {
        "id": "ssn-docs",
        "category": "Sensitive documents",
        "label": "Documents mentioning Social Security numbers",
        "description": "Pages and files with “social security number” or “SSN” in the text, such as old "
                       "application forms and W-9s.",
        "fields": {"anyof": "social security number, ssn"},
    },
    {
        "id": "password-docs",
        "category": "Sensitive documents",
        "label": "Text files that mention passwords",
        "description": "Plain-text files containing the word “password”: setup notes, exported lists, "
                       "printer and Wi-Fi instructions.",
        "fields": {"filetype": "txt", "intext": "password"},
        "next": "If a real password is exposed, change it first, then remove the file.",
    },
    {
        "id": "wifi-docs",
        "category": "Sensitive documents",
        "label": "Wi-Fi network instructions",
        "description": "Documents describing how to join your wireless networks. Guest instructions are fine; "
                       "staff network keys are not.",
        "fields": {"anyof": "wifi password, wireless password, network key, SSID"},
    },

    # --- Config, logs & backups --------------------------------------------------
    {
        "id": "env-files",
        "category": "Config, logs & backups",
        "label": ".env settings files",
        "description": "Web app settings files. They usually hold database passwords and API keys.",
        "fields": {"filetype": "env"},
        "next": "Rotate every key and password in the file, then remove it and block .env files on the web server.",
    },
    {
        "id": "sql-dumps",
        "category": "Config, logs & backups",
        "label": "Database dumps (.sql)",
        "description": "Database exports left on a web server. They can contain a whole site's users and data.",
        "fields": {"filetype": "sql"},
    },
    {
        "id": "log-files",
        "category": "Config, logs & backups",
        "label": "Log files",
        "description": "Server and application logs, which can leak usernames, IP addresses and internal paths.",
        "fields": {"filetype": "log"},
    },
    {
        "id": "backup-files",
        "category": "Config, logs & backups",
        "label": "Backup files (.bak)",
        "description": "Copies of files saved with a .bak extension. Web servers often serve these as plain text, "
                       "source code and all.",
        "fields": {"filetype": "bak"},
    },
    {
        "id": "config-files",
        "category": "Config, logs & backups",
        "label": "Config files (.conf)",
        "description": "Server and application configuration files.",
        "fields": {"filetype": "conf"},
    },
    {
        "id": "scripts",
        "category": "Config, logs & backups",
        "label": "PowerShell scripts",
        "description": "Admin scripts posted to a web server. Check them for hard-coded passwords and server names.",
        "fields": {"filetype": "ps1"},
    },

    # --- Login & admin pages -----------------------------------------------------
    {
        "id": "login-pages",
        "category": "Login & admin pages",
        "label": "Login pages",
        "description": "Pages with “login” in the address. A good inventory of what's facing the internet; look "
                       "for systems you didn't know were public.",
        "fields": {"inurl": "login"},
    },
    {
        "id": "admin-pages",
        "category": "Login & admin pages",
        "label": "Admin pages",
        "description": "Pages with “admin” in the address. Admin consoles shouldn't usually be reachable from "
                       "the internet at all.",
        "fields": {"inurl": "admin"},
    },
    {
        "id": "signin-titles",
        "category": "Login & admin pages",
        "label": "Sign-in pages by title",
        "description": "Pages with “sign in” in the title, which catches portals whose address doesn't say login.",
        "fields": {"intitle": "sign in"},
    },
    {
        "id": "phpmyadmin",
        "category": "Login & admin pages",
        "label": "phpMyAdmin database consoles",
        "description": "Web consoles for MySQL databases. These should never be public.",
        "fields": {"intitle": "phpmyadmin"},
    },
    {
        "id": "test-sites",
        "category": "Login & admin pages",
        "label": "Test and staging sites",
        "description": "Addresses containing “staging”. Test copies of sites often have weaker security and "
                       "real data.",
        "fields": {"inurl": "staging"},
    },

    # --- Directory listings ------------------------------------------------------
    {
        "id": "index-of",
        "category": "Directory listings",
        "label": "Open directory listings",
        "description": "Folders where the web server lists every file. Anything in them can be downloaded, "
                       "linked or not.",
        "fields": {"intitle": "index of", "intext": "parent directory"},
        "next": "Turn off directory listing on the web server (Options -Indexes in Apache, autoindex off in nginx).",
    },
    {
        "id": "index-of-backups",
        "category": "Directory listings",
        "label": "Directory listings of backups",
        "description": "Open folder listings that mention backups.",
        "fields": {"intitle": "index of", "anyof": "backup, backups, bak"},
    },
    {
        "id": "index-of-uploads",
        "category": "Directory listings",
        "label": "Directory listings of uploads",
        "description": "Open listings of upload folders (WordPress and similar), where everything ever uploaded "
                       "is visible, including drafts.",
        "fields": {"intitle": "index of", "inurl": "uploads"},
    },
]


def catalog_client():
    """What the page gets (rendered into the HTML as JSON)."""
    return {"categories": CATEGORIES, "entries": CATALOG}
