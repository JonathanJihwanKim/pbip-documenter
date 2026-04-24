# Security Policy

## Scope

PBIP Documenter is a **client-side single-page application** that runs entirely in your browser using the File System Access API. No data, files, or credentials are ever uploaded or transmitted — all parsing happens locally.

Vulnerabilities that apply to this project:

- XSS via maliciously crafted TMDL / M expression / PBIR JSON content that could execute code when parsed or rendered
- File System Access API misuse that could access paths beyond the user-selected folder
- Dependency vulnerabilities in any future npm / CDN scripts added to the project
- Content Security Policy gaps

**Out of scope:**

- Issues that require the attacker to control the PBIP project folder that the user intentionally opened (local file trust boundary)
- Bugs that do not have a security impact (crashes, wrong output, parsing errors) — please open a [bug report](https://github.com/JonathanJihwanKim/pbip-documenter/issues/new?template=bug_report.md) instead

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Email: **jonathan.jihwankim@gmail.com**  
Subject line: `[SECURITY] pbip-documenter — <one-line summary>`

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (a crafted TMDL snippet or `.json` file is ideal)
- Browser and version where you observed it

I aim to respond within **72 hours** and to release a fix within **7 days** for confirmed vulnerabilities. I will credit you in the release notes unless you prefer to remain anonymous.

## Supported Versions

Only the latest version deployed at [jonathanjihwankim.github.io/pbip-documenter](https://jonathanjihwankim.github.io/pbip-documenter/) receives security fixes. There are no versioned release branches to backport to.
