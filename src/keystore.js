'use strict'
const levelup = require('levelup')
const crypto = require('libp2p-crypto')
const LRU = require('lru')
const { verifier } = require('./verifiers')

class Keystore {
  constructor (storage, directory) {
    this.path = directory || './orbitdb'
    this._storage = storage
    this._store = null
    this._cache = new LRU(100)
  }

  async open () {
    if (this.store) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const store = levelup(this._storage(this.path))
      store.open((err) => {
        if (err) {
          return reject(err)
        }
        this._store = store
        resolve()
      })
    })
  }

  async close () {
    if (!this._store) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      this._store.close((err) => {
        if (err) {
          return reject(err)
        }
        this._store = null
        resolve()
      })
    })
  }

  async destroy () {
    return new Promise((resolve, reject) => {
      this._storage.destroy(this.path, (err) => {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })
  }

  async hasKey (id) {
    if (!id) {
      throw new Error('id needed to check a key')
    }
    if (!this._store) {
      await this.open()
    }
    if (this._store.status && this._store.status !== 'open') {
      return Promise.resolve(null)
    }

    let hasKey = false
    let storedKey = this._cache.get(id) || await this._store.get(id)
    try {
      hasKey = storedKey !== undefined && storedKey !== null
    } catch (e) {
      // Catches 'Error: ENOENT: no such file or directory, open <path>'
      console.error('Error: ENOENT: no such file or directory')
    }
    return hasKey
  }

  async createKey (id) {
    if (!id) {
      throw new Error('id needed to create a key')
    }
    if (!this._store) {
      await this.open()
    }
    if (this._store.status && this._store.status !== 'open') {
      return Promise.resolve(null)
    }

    const genKeyPair = () => new Promise((resolve, reject) => {
      crypto.keys.generateKeyPair('secp256k1', 256, (err, key) => {
        if (!err) {
          resolve(key)
        }
        reject(err)
      })
    })

    const keys = await genKeyPair()

    const key = {
      publicKey: keys.public.marshal().toString('hex'),
      privateKey: keys.marshal().toString('hex')
    }

    try {
      await this._store.put(id, JSON.stringify(key))
    } catch (e) {
      console.log(e)
    }
    this._cache.set(id, key)
    return keys
  }

  async getKey (id) {
    if (!id) {
      throw new Error('id needed to get a key')
    }
    if (!this._store) {
      await this.open()
    }
    if (this._store.status && this._store.status !== 'open') {
      return Promise.resolve(null)
    }

    const cachedKey = this._cache.get(id)
    let storedKey
    try {
      storedKey = cachedKey || await this._store.get(id)
    } catch (e) {
      // ignore ENOENT error
    }

    if (!storedKey) {
      return
    }

    const deserializedKey = cachedKey || JSON.parse(storedKey)
    if (!deserializedKey) {
      return
    }

    if (!cachedKey) {
      this._cache.set(id, deserializedKey)
    }

    const genPrivKey = (pk) => new Promise((resolve, reject) => {
      crypto.keys.supportedKeys.secp256k1.unmarshalSecp256k1PrivateKey(pk, (err, key) => {
        if (!err) {
          resolve(key)
        }
        reject(err)
      })
    })

    return genPrivKey(Buffer.from(deserializedKey.privateKey, 'hex'))
  }

  sign (key, data) {
    if (!key) {
      throw new Error('No signing key given')
    }

    if (!data) {
      throw new Error('Given input data was undefined')
    }

    const genSig = () => new Promise((resolve, reject) => {
      key.sign(data, (err, signature) => {
        if (!err) {
          resolve(signature.toString('hex'))
        }
        reject(err)
      })
    })
    return genSig()
  }

  async verify (signature, publicKey, data, v = 'v1') {
    return Keystore.verify(signature, publicKey, data, v)
  }

  static async verify (signature, publicKey, data, v = 'v1') {
    return verifier(v).verify(signature, publicKey, data)
  }
}

module.exports = (storage, mkdir) => {
  return {
    create: async (directory = './keystore') => {
      // If we're in Node.js, mkdir module is expected to passed
      // and we need to make sure the directory exists
      if (mkdir && mkdir.sync) {
        mkdir.sync(directory)
      }
      const keystore = new Keystore(storage, directory)
      await keystore.open()
      return keystore
    },
    verify: Keystore.verify
  }
}
