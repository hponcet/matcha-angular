const MongoClient = require('mongodb').MongoClient
const conf = require('../server.conf.js')
const errManager = require('./error-manager')
const genToken = require('rand-token')
const tools = require('./tools-manager')
const SESSION_TIME = conf.server.SESSION_TIME
const FREQ_SESSION_CONTROL = 86400 * 1000 // 24h (msec)

function killSession (token) {
  MongoClient.connect(conf.db.mongoURI, function (err, db) {
    if (err) {
      errManager.handleError(null, 'Failed to connect database.', err, 500)
    } else {
      let sessions = db.collection('sessions')
      sessions.removeOne({'session.token': token})
      db.close()
    }
  })
}
function createSession (token) {
  MongoClient.connect(conf.db.mongoURI, function (err, db) {
    if (err) {
      errManager.handleError(null, 'Failed to connect database.', err, 500)
    } else {
      let sessions = db.collection('sessions')
      sessions.insertOne({'session': token}, function (error) {
        if (error) {
          errManager.handleError(null, 'Failed to connect database.', error, 500)
        }
      })
      db.close()
    }
  })
}

function getIdbyToken (token, callback) {
  MongoClient.connect(conf.db.mongoURI, function (err, db) {
    if (err) {
      errManager.handleError(null, 'Failed to connect database.', err, 500)
    } else {
      let sessions = db.collection('sessions')
      sessions.findOne({'session.token': token}, function (err, session) {
        if (err) {
          errManager.handleError(null, 'Failed to connect database.', err, 500)
        } else {
          callback(session.session.id)
        }
      })
      db.close()
    }
  })
}

module.exports = {
  startSession: function (token) {
    createSession(token)
  },

  login: function (res, username, password, callback, startSession) {
    MongoClient.connect(conf.db.mongoURI, function (err, db) {
      if (err) {
        errManager.handleError(res, 'Failed to connect database.', err.message, 500)
      } else {
        let users = db.collection('users')
        users.findOne({ 'mail': username }, function (err, user) {
          if (err) {
            errManager.handleError(res, 'Failed to connect database.', err.message, 500)
          } else {
            if (!user) {
              callback({
                authentificated: false,
                reason: 1,
                message: 'Authentication failed. User not found.'
              })
            } else if (password !== user.password) {
              callback({
                authentificated: false,
                reason: 2,
                message: 'Authentication failed. Wrong password.'
              })
            } else if (user.validation.account === false) {
              callback({
                authentificated: false,
                reason: 3,
                message: 'Authentication failed. Account is not validated.'
              })
            } else {
              const sessionExpire = tools.newTimestamp() + SESSION_TIME * 1
              const token = genToken.generate(48)
              const authObj = {
                id: user._id,
                pseudo: user.pseudo,
                token: token,
                expire: sessionExpire
              }
              callback({
                message: 'Authenticated.',
                authentificated: true,
                pseudo: user.pseudo,
                token: token,
                expire: sessionExpire
              })
              errManager.handleConsole('users', 'Logged. (' + user.pseudo + ')')
              return startSession(authObj)
            }
          }
        })
        db.close()
      }
    })
  },

  logout: function (token) {
    killSession(token)
    errManager.handleConsole('users', 'Logout (' + token + ')')
  },

  killOldSessionDeamon: function (freq) {
    let freqControl = freq

    if (freqControl == null) {
      freqControl = FREQ_SESSION_CONTROL
    }
    errManager.handleConsole('SERVER', 'KillOldSessions process have been launch. Operations every ' + (freqControl / 1000) + 's.')
    setInterval(function () {
      errManager.handleConsole('SERVER', 'Clean session in progress...')
      MongoClient.connect(conf.db.mongoURI, function (err, db) {
        if (err) {
          errManager.handleError(null, 'Failed to connect database.', err.message, 500)
        } else {
          let sessions = db.collection('sessions')
          let date = tools.newTimestamp()

          sessions.find().toArray(function (err, sessions) {
            if (err) {
              errManager.handleError(null, 'Failed to connect database.', err.message, 500)
            } else {
              let oldSessions = []

              for (let i = 0; i < sessions.length; i++) {
                if (sessions[i].session.expire < date) {
                  oldSessions.push(sessions[i].session.token)
                }
              }
              return (
                function () {
                  let i = 0
                  for (i; i < oldSessions.length; i++) {
                    killSession(oldSessions[i])
                  }
                  errManager.handleConsole('SERVER', i + ' sessions have been closed.')
                }
              )()
            }
          })
          db.close()
        }
      })
    }, freqControl)
  },

  auth: (auth) => {
    return new Promise(function (resolve, reject) {
      MongoClient.connect(conf.db.mongoURI, function (err, db) {
        if (err) {
          errManager.handleError(null, 'Failed to connect database.', err.message, 500)
          reject(err)
        } else {
          const sessions = db.collection('sessions')
          sessions.findOne({ 'id': auth.id, 'token': auth.token }, function (err, session) {
            if (err) {
              reject(err)
            } else {
              resolve(true)
            }
          })
        }
      })
    })
  },

  getIdbyToken: getIdbyToken
}
