const sign = require('./sign')
const selectors = require('./selectors')

const REGEX = /([\d]{1,2})\/([\d]{1,2})\/([\d]{1,4})\s([\d]{1,2}):([\d]{1,2}):([\d]{1,2})\s([AP]M)/g

module.exports = async (chromeless, client) => {
  let warning = await chromeless.evaluate((sessionWarning) => {
    return document.querySelector(sessionWarning).textContent
  }, selectors.DUPLICATE_SESSION_WARNING)
  let expires = new Date(warning.match(REGEX)[0])
  console.log(expires.toString())
  let timestamp = Math.floor(expires.getTime() / 1000)
  await new Promise((resolve, reject) => {
    client.set('parkmobile-bot', JSON.stringify({ timestamp }), resolve)
  })
  let url = await chromeless.screenshot()
  let short = await sign(url).catch(err => '')
  console.log(short)
}
