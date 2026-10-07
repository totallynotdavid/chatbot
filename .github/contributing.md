# Contributing

This page is the contributor entry point. It owns the contribution path.
The repository README owns the product overview. The architecture map owns code
boundaries, and [Development](../docs/development.md) owns checks and CI.

## Start here

1. Read the [README](../readme.md) to confirm that VendeYa fits the work.
2. Read [Architecture](../docs/architecture.md) to find the workspace and module
   that owns the change.
3. Follow [Get started](../docs/get-started.md) to run the simulator.
4. Read the manual page for the subsystem you will change.

## Before opening a change

Run the checks in [Development](../docs/development.md#checks) that cover the
files you changed. At minimum, run the repository test suite, the typecheck for
each touched workspace, and the code and Markdown formatters. Report any check
you could not run and include its command and output.

When behavior changes, update the manual page that describes that behavior in
the same change. Keep one rule in one document and link to it elsewhere.

Use a lower-case imperative commit subject with no prefix, followed by a body
that explains why, usually beginning with `Why:`. Commits to `master` are signed
and linear.
