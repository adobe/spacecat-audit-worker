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
      prepareCmd: 'npm run deploy && npm run test-postdeploy',
      publishCmd: 'npm run deploy-routes'
    }],
    ["@semantic-release/github", {}]
  ],
  branches: ['main'],
};
