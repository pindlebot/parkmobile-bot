const AWS = require('aws-sdk')
const sns = new AWS.SNS({ region: 'us-east-1' })
const mime = require('mime-types')
const aws4 = require('aws4')
const shorten = require('bitly-shorten')

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
  let key = rawUrl.split('/').pop()
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
  return shorten(`https://${host}${signed.path}`)
    .then(resp => {
      console.log(resp)
      return resp.data.url
    })
}

const run = async (chromeless) => {
  const zone = '1208918'
  await login(chromeless)
  await chromeless
    .goto('https://dlweb.parkmobile.us/Phonixx/personalpages/parking-start/')
    .type(zone, 'input#ctl00_cphMain_ucPermitParkingCasualStart1_dgUsers_ctl02_tbZone')
    .evaluate(() => {
      __doPostBack('ctl00$cphMain$ucPermitParkingCasualStart1$lnkStartParking','')
    })
  await sleep()
  await chromeless.click('a#ctl00_cphMain_ucPermitParkingCasualStart1_lnkStartParking')
  await sleep()
  await chromeless.click('#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_rbDurationType_1')
    .catch(err => {
      console.error(err)
      throw err
    })
  await sleep()
  await chromeless
    .click('#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_ddCustom')
    .evaluate(() => {
      let elem = document.querySelector('#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_ddCustom')
      let children = [...elem.children]
      elem.value = children[1].value
      elem.blur()
      document.querySelector('a#ctl00_cphMain_ucPermitParkingCasualStart1_lnkStartParking').click()
    })
  await sleep()
  let exists = await chromeless.evaluate(() => {
    let elem = document.querySelector('input#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_cbConfirmPayment')
    return elem && elem.id
  })
  if (!exists) {
    let url = await chromeless.screenshot()
    let short = await sign(url)
    console.log(short)
    return
  }
  await chromeless
    .evaluate(() => {
      document.querySelector('input#ctl00_cphMain_ucPermitParkingCasualStart1_UcPermitParkingCasualDuration_cbConfirmPayment').checked = true
      document.querySelector('a#ctl00_cphMain_ucPermitParkingCasualStart1_lnkStartParking').click()
    })
  let url = await chromeless.screenshot()
  let short = await sign(url)
  console.log(short)

  await sns.publish({
    Message: JSON.stringify({
      body: `parkmobile-bot reserved a space for 2 hours. ${short}`
    }),
    TopicArn: 'arn:aws:sns:us-east-1:761245233224:twilio-notify'
  }).promise()
}

module.exports.handler = async (event, context, callback) => {
  let hours = new Date().getHours() - 4
  console.log({ hours })
  const chrome = await launchChrome()
  const chromeless = new Chromeless({
    launchChrome: false
  })
  await run(chromeless).catch((err) => {
    console.log(err)
  })
  await chromeless.end()
  chrome.kill()
  callback(null, {})
}