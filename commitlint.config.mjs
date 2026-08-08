/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 72],
    "scope-enum": [
      2,
      "always",
      [
        "repo",
        "ci",
        "docs",
        "db",
        "core",
        "verdict",
        "ledger",
        "herald",
        "probes",
        "worker",
        "web",
        "status",
        "deps",
      ],
    ],
  },
};
