module.exports = {
  files: ['app-dist/**/*', 'electron/**/*', 'package.json'],
  directories: {
    buildResources: 'build',
    output: 'release',
  },
  extraResources: [
    {
      from: 'build/icon.ico',
      to: 'icon.ico',
    },
  ],
  win: {
    icon: 'build/icon.ico',
    target: ['portable', 'nsis'],
  },
}
