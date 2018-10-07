const mime = require('mime-types')
const aws4 = require('aws4')
const shorten = require('bitly-shorten')

const bucket = process.env.CHROMELESS_S3_BUCKET_NAME
const region = process.env.AWS_REGION || 'us-east-1'
const host = 's3.amazonaws.com'

const sign = async (rawUrl) => {
  let key = require('url').parse(rawUrl).pathname.split('/').pop()
  const type = encodeURIComponent(mime.lookup(key))
  const signed = aws4.sign({
    host: host,
    path: `/${bucket}/${key}?response-content-type=${type}&X-Amz-Expires=3600`,
    service: 's3',
    region: region,
    signQuery: true,
  })
  let longUrl = `https://${host}${signed.path}`

  return shorten(longUrl, { apiKey: process.env.BITLY_API_KEY })
    .then(({ data }) => data.url)
}

module.exports = sign
