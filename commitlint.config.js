/**
 * Commit message rules. Enforced locally by the lefthook `commit-msg` hook.
 *
 * We follow Conventional Commits (https://www.conventionalcommits.org).
 * Because we squash-merge, the PR *title* becomes the commit on `main`, so the
 * title must also be a valid Conventional Commit.
 *
 * Examples:
 *   feat(core): add soft delete to time entries
 *   fix(desktop): stop crash when importing an empty file
 *   docs: explain the export round-trip guarantee
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Scopes are a convention, not a hard gate (level 1 = warning), so a stray
    // scope never blocks a commit. Package scopes keep changelogs readable.
    "scope-enum": [1, "always", ["core", "desktop", "docs", "ci", "repo", "deps", "release"]],
  },
};
