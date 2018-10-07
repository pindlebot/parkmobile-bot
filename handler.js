if (!process.env.AWS_SESSION_TOKEN) {
  require('dotenv').config()
}

const AWS = require('aws-sdk')
const sns = new AWS.SNS({ region: 'us-east-1' })
const mime = require('mime-types')
const aws4 = require('aws4')
const shorten = require('bitly-shorten')
const redis = require('redis')
const selectors = require('./src/selectors')
const sign = require('./src/sign')
const login = require('./src/login')
const setTimestamp = require('./src/set-timestamp')
const { Chromeless } = require('chromeless')
const launchChrome = require('@serverless-chrome/lambda')

const sleep = () => new Promise((resolve, reject) => setTimeout(resolve, 1000))

const run = async (chromeless, client, cache) => {
  const zone = process.env.PARKING_ZONE
  await login(chromeless)
  await chromeless
    .goto('https://dlweb.parkmobile.us/Phonixx/personalpages/parking-start/')
    .type(zone, selectors.ZONE)
    .evaluate(() => {
      __doPostBack('ctl00$cphMain$ucPermitParkingCasualStart1$lnkStartParking','')
    })
  await sleep()
  await chromeless.click(selectors.START_PARKING)
  await sleep()
  await chromeless.click(selectors.PARKING_DURATION_CUSTOM_OPTION)
    .catch(err => {
      console.error(err)
      throw err
    })
  await sleep()
  await chromeless
    .click(selectors.PARKING_DURATION_SELECT)
    .evaluate(([startParking, duration]) => {
      let elem = document.querySelector(duration)
      let children = [...elem.children]
      let value = children[1].value
      elem.value = value
      elem.blur()
      document.querySelector(startParking).click()
      return value
    }, [selectors.START_PARKING, selectors.PARKING_DURATION_SELECT])
  
  await sleep()
  let exists = await chromeless.evaluate((confirmPayment) => {
    let elem = document.querySelector(confirmPayment)
    return elem && elem.id
  }, selectors.CONFIRM_PAYMENT)
  if (!exists) {
    return setTimestamp(chromeless, client)
  }
  await chromeless
    .evaluate(() => {
      document.querySelector('input#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_cbConfirmPayment').checked = true
      document.querySelector('a#ctl00_cphMain_ucPermitParkingCasualStart1_lnkStartParking').click()
    })
  let url = await chromeless.screenshot()
  let short = await sign(url).catch(err => '')
  console.log(short)

  await sns.publish({
    Message: JSON.stringify({
      body: `parkmobile-bot reserved a space for 2 hours. ${short}`
    }),
    TopicArn: 'arn:aws:sns:us-east-1:761245233224:twilio-notify'
  }).promise()
}

const handler = async (event, context, callback) => {
  let timestamp = Math.floor(new Date().getTime() / 1000)
  let client = redis.createClient(process.env.REDIS_URL)
  await new Promise((resolve, reject) => client.on('connect', resolve))
  let cache = await new Promise((resolve, reject) => 
    client.get('parkmobile-bot', (err, data) => {
      if (err) reject(err)
      else resolve(data ? JSON.parse(data) : null)
    })
  )
  if (!cache) cache = { timestamp }
  console.log(`time until next reservation: ${(cache.timestamp - timestamp) / 3600} hours`)

  if (timestamp < cache.timestamp) {
    console.log('Exiting...')
    await new Promise((resolve, reject) => client.quit(resolve))
    return callback(null, {})
  }
  const chrome = await launchChrome()
  const chromeless = new Chromeless({
    launchChrome: false
  })
  await run(chromeless, client, cache).catch((err) => {
    console.log(err)
  })
  await chromeless.end()
  chrome.kill()
  await new Promise((resolve, reject) => client.quit(resolve))
  callback(null, {})
}

module.exports.handler = handler
