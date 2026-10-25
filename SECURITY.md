# Security policy

Spoor holds personal data, so security reports are taken seriously, even while
the project is in early development.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub: on the
repository's **Security** tab, choose **Report a vulnerability**. Only the
maintainer can see the report.

Please include:

- What the issue is and what an attacker could do with it.
- Steps to reproduce, using dummy data. Do not send a real database file.
- The version or commit SHA, and your operating system.

## What to expect

Spoor is maintained by one person, so responses are best effort:

- An acknowledgement within a week.
- An assessment, and a fix plan if the report is confirmed, after that.
- Credit in the release notes once a fix ships, unless you prefer otherwise.

## Supported versions

Spoor has no stable release yet. Only the latest commit on `main` is supported.

## Scope

In scope, among others:

- Anything that sends user data off the device. Spoor promises that nothing
  leaves it (see [PRIVACY.md](PRIVACY.md)), so any such path is a vulnerability.
- Data loss or corruption that an attacker can trigger, for example through a
  crafted import file.
- Weaknesses in the desktop shell, such as unsafe IPC commands or capabilities.
- Deleted data that remains recoverable after the trash has been purged.

Out of scope:

- Attacks that require an already compromised device or user account.
- Vulnerabilities in dependencies with no demonstrated impact on Spoor. Report
  those upstream.
