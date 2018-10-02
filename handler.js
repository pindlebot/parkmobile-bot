const AWS = require('aws-sdk')
const sns = new AWS.SNS({ region: 'us-east-1' })
const mime = require('mime-types')
const aws4 = require('aws4')
const shorten = require('bitly-shorten')
const redis = require('redis')

if (!process.env.AWS_SESSION_TOKEN) {
  require('dotenv').config()
}

const { Chromeless } = require('chromeless')
const launchChrome = require('@serverless-chrome/lambda')

const INPUT = {
  LOGIN: 'input#ctl00_ContentPlaceHolder1_UcUserLoginControl1_userName',
  PASSWORD: 'input#ctl00_ContentPlaceHolder1_UcUserLoginControl1_password'
}

const login = async (chromeless) => {
  let cookies = await chromeless
    .setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36')
    .goto('https://parkmobile.io/login')
    .cookies()

  await chromeless
    .goto('https://dlweb.parkmobile.us/Phonixx/')
    .setCookies(cookies)
    .type(process.env.LOGIN, INPUT.LOGIN)
    .type(process.env.PASSWORD, INPUT.PASSWORD)
    .wait(500)
    .evaluate(() => {
      WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions("ctl00$ContentPlaceHolder1$UcUserLoginControl1$lbLogon", "", true, "", "", false, true))
    })
}

const sleep = () => new Promise((resolve, reject) => setTimeout(resolve, 1000))

const sign = async (rawUrl) => {
  let key = require('url').parse(rawUrl).pathname.split('/').pop()
  const type = encodeURIComponent(mime.lookup(key))
  const Bucket = process.env.CHROMELESS_S3_BUCKET_NAME
  const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
  const host = 's3.amazonaws.com'
  const signed = aws4.sign({
    host: host,
    path: `/${Bucket}/${key}?response-content-type=${type}&X-Amz-Expires=3600`,
    service: 's3',
    region: AWS_REGION,
    signQuery: true,
  })
  let longUrl = `https://${host}${signed.path}`

  return shorten(longUrl, { apiKey: process.env.BITLY_API_KEY })
    .then(({ data }) => data.url)
}

const selectors = {
  ZONE: 'input#ctl00_cphMain_ucPermitParkingCasualStart1_dgUsers_ctl02_tbZone',
  START_PARKING: 'a#ctl00_cphMain_ucPermitParkingCasualStart1_lnkStartParking',
  CONFIRM_PAYMENT: 'input#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_cbConfirmPayment',
  PARKING_DURATION_SELECT: '#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_ddCustom',
  DUPLICATE_SESSION_WARNING: 'span#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_lblDuplicateSessionWarning',
  PARKING_DURATION_CUSTOM_OPTION: '#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_rbDurationType_1'
}

const run = async (chromeless, client, cache) => {
  const zone = '1208918'
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
    let warning = await chromeless.evaluate((sessionWarning) => {
      return document.querySelector(sessionWarning).textContent
    }, selectors.DUPLICATE_SESSION_WARNING)
    let [offset] = warning.match(/[\d]{1,2}:[\d]{1,2}:[\d]{1,2}/g)
    let [hours, minutes, seconds] = offset.split(':')
    hours = parseInt(hours) - (new Date().getHours() - 4 - 12)
    minutes = parseInt(minutes) - (new Date().getMinutes())
    seconds = parseInt(seconds) - (new Date().getSeconds())
    let expires = (hours * 3600) + (minutes * 60) + seconds
    let currentTimestamp = Math.floor((new Date().getTime()) / 1000)
    let timestamp = currentTimestamp + expires - (5 * 60)
    await new Promise((resolve, reject) => {
      client.set('parkmobile-bot', JSON.stringify({ timestamp }), resolve)
    })
    let url = await chromeless.screenshot()
    let short = await sign(url).catch(err => '')
    console.log(short)
    return
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

module.exports.handler = async (event, context, callback) => {
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
  cache.timestamp = parseInt(cache.timestamp)
  console.log(`time until next reservation: ${(cache.timestamp - timestamp) / 60} minutes`)

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