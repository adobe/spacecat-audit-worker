module.exports = {
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", {
      changelogFile: "CHANGELOG.md",
    }],
    ['@semantic-release/npm', {
      npmPublish: false,
    }],
    ["@semantic-release/git", {
      assets: ['package.json', 'package-lock.json', 'CHANGELOG.md', 'docs/index.html'],
      message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
    }],
    ['@semantic-release/exec', {
      prepareCmd: 'AWS_ACCOUNT_ID=640168421876 npm run deploy && npm run test-postdeploy && npm run docs',
    }],
    ["@semantic-release/github", {}]
  ],
  branches: ['main'],
};
