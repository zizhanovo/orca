// Fork CI only: the base config pins mac targets to x64 + arm64, and the x64 slice's packaged
// terminal-host smoke test cannot run on an arm64 runner. Everything else is inherited.
const base = require('./electron-builder.config.cjs')

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    target: base.mac.target.map((entry) => ({ ...entry, arch: ['arm64'] }))
  }
}
