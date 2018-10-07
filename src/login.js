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

module.exports = login
