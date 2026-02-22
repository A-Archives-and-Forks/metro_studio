#!/usr/bin/env node
/**
 * Offline license key generator for RailMap.
 * Usage: node scripts/generate-license-key.mjs [email or identifier]
 */
import { createPrivateKey, sign } from 'crypto'

const PRIV_KEY_B64 = 'MC4CAQAwBQYDK2VwBCIEICJ5byPZpiDwsA1aO/EfJCTQui1J1DT/46vxnvK1PsHa'

const subject = process.argv[2] || 'default'
const payload = Buffer.from(JSON.stringify({
  sub: subject,
  iat: Date.now(),
})).toString('base64url')

const privKey = createPrivateKey({
  key: Buffer.from(PRIV_KEY_B64, 'base64'),
  format: 'der',
  type: 'pkcs8',
})

const signature = sign(null, Buffer.from(payload), privKey)
const key = `${payload}.${signature.toString('base64')}`

console.log('\nGenerated License Key:\n')
console.log(key)
console.log('\nSubject:', subject)
console.log('Issued:', new Date().toISOString())
