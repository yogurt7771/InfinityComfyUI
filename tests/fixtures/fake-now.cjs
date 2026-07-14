const { readFileSync } = require('node:fs')

const clockFile = process.env.INFINITY_TEST_CLOCK_FILE
const realNow = Date.now

if (clockFile) {
  Date.now = () => {
    const value = Number(readFileSync(clockFile, 'utf8'))
    return Number.isFinite(value) ? value : realNow()
  }
}
