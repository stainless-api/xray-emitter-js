# Releasing new package versions

Packages live [on NPM](https://www.npmjs.com/package/@stainlessdev/xray-emitter).

Any merges to `main` or any branch automatically trigger a GitHub Action that produces a dev build and release like `0.1.0-dev.2c5bc4c` or `0.1.0-branch.pedro-effect-ts.5de09f2`.

To publish a full release, tag a new version and push to GitHub:

    git fetch origin '+refs/tags/v*:refs/tags/v*'
    git tag v0.2.0
    git push origin --tags

Alternatively, you can visit [the public workflow](https://github.com/stainless-api/xray-emitter-js/actions/workflows/publish.yml) and enter a version number like "0.2.0" manually.
