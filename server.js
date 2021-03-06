const HOST = '127.0.0.1'
const DEFAULT_PORT = '8793'
const AUTH = 'WooMeowWoo'
const http = require('http')
const request = require('request')
const httpshutdown = require('http-shutdown')
const drp = require('./richpresence.js')
const richpresence = drp.update
const ipc = require('electron').ipcRenderer

const COMMANDS = {
  'MENU':'menu',
  'MVP':'mvp',
  'FREEZETIME':'freezetime',
  'LIVE':'live',
  'WARMUP':'warmup',
  'WIN':'win',
  'LOSE':'lose',
  'PLANTED':'planted',
  'STOP':'stop',
  'HALT':'halt'
}

const GAMEMODES = {
  'competitive': 'Competitive',
  'casual': 'Casual',
  'scrimcomp2v2': 'Wingman',
  'gungametrbomb': 'Demolition',
  'gungameprogressive': 'Arms Race',
  'deathmatch': 'Deathmatch',
  'survival': 'Danger Zone',
  'coopmission': 'Co-op Mission'
}

let MAPS = {
  'de_stmarc': 'St. Marc',
  'de_cbble': 'Cobblestone',
  'de_dust2': 'Dust II',
  'dz_junglety': 'Jungle'
}
request(
  {
    url: 'https://www.musickitten.net/maps.json',
    json:true
  },
  function(error, response, body) {
    if(!error){
      MAPS = body
    }
    else{
      console.log(error);
      console.log(response);
    }
  }
)
const MENURPC = {
  state: 'Menu',
  largeImageKey: 'csgo',
  largeImageText: 'Counter-Strike: Global Offensive',
  smallImageKey: 'kitten',
  smallImageText: 'musickitten.net'
}

let server = false
let steamid = null
let port = DEFAULT_PORT
let callback = function(args){}
let teamCT = false
let mvps = -1
let running = false
let heartbeat = 4.0
let timeout = null

function resolveName(name, nameobj, guess=false){
  if(name in nameobj){
    return nameobj[name]
  }
  if(guess){
    let split = name.split('_')
    split = split[split.length-1]
    return split.charAt(0).toUpperCase() + split.slice(1);
  }
  return name
}

function getSteamID(data){
  if (data.hasOwnProperty('provider') && data.provider.hasOwnProperty('steamid')){
    steamid = data.provider.steamid
  }
}

function updateRoundNum(data){
  if (data.hasOwnProperty('map') && data.map.hasOwnProperty('round')) {
    callback({type:'roundNum', content:data.map.round})
  }
}

function updateTeam(data){
  if (data.player.hasOwnProperty('steamid') && data.player.steamid === steamid) {
    if (data.hasOwnProperty('player') && data.player.hasOwnProperty('team')) {
      teamCT = data.player.team === 'CT'
    }
  }
}

function init(){
  server = http.createServer(function(req, res) {
    if (req.method === 'POST') {
      console.log('Handling POST request...')
      res.writeHead(200, {
        'Content-Type': 'text/html'
      })

      let body = ''
      req.on('data', function(data) {
        body += data
      })
      req.on('end', function() {
        handleResponse(body)
        res.end('')
      })
    } else {
      console.log('Not expecting other request types...')
      res.writeHead(200, {
        'Content-Type': 'text/html'
      })
      let html = '<html><body>Kitten HTTP Server at http://' + HOST + ':' + port + '</body></html>'
      res.end(html)
    }
  })
}

function handleResponse(body){
  if(timeout != null){
    clearTimeout(timeout)
  }
  timeout = setTimeout(function(){
    timeout = null
    console.log('stopping due to inactivity')
    callback({type:'command', content:COMMANDS.HALT})
  }, 1000 * (heartbeat + 3))
  let parsed = JSON.parse(body)
  if (parsed.hasOwnProperty('auth') &&
      parsed.auth.hasOwnProperty('token') &&
      parsed.auth.token === AUTH) {
    delete parsed.auth
    getSteamID(parsed)
    updateRoundNum(parsed)
    updateTeam(parsed)
    console.log('\nPOST payload:')
    console.log(parsed)
    let phase = false
    if (parsed.hasOwnProperty('round') && parsed.round.hasOwnProperty('phase')){
      phase = parsed.round.phase
    }
    else if (parsed.hasOwnProperty('map') && parsed.map.hasOwnProperty('phase')){
      phase = parsed.map.phase
    }
    if (phase) {
      if(parsed.hasOwnProperty('map')){
        try{
          let teamname = (teamCT)?'ct':'t'
          let scores = []
          if(teamCT){
            scores.push(parsed.map.team_ct.score)
          }
          scores.push(parsed.map.team_t.score)
          if(!teamCT){
            scores.push(parsed.map.team_ct.score)
          }

          richpresence({
            details: resolveName(parsed.map.mode, GAMEMODES) + ' ' + resolveName(parsed.map.name, MAPS, true),
            state: teamname.toUpperCase() + ' ' + scores.join('-'),
            largeImageKey: parsed.map.name,
            largeImageText: parsed.map.name,
            smallImageKey: teamname,
            smallImageText: teamname.toUpperCase() + ' Team'
          })

          if(parsed.map.mode === 'gungameprogressive' || parsed.map.mode === 'deathmatch' || parsed.map.mode === 'survival' || parsed.map.mode === 'coopmission'){
            let rpData = {}
            rpData['state'] = teamname.toUpperCase() + ' ' + parsed.player.match_stats.kills + ' kills'
            if(parsed.map.mode === 'survival'){
              rpData['smallImageKey'] = 'battleroyale'
              rpData['smallImageText'] = resolveName(parsed.map.mode, GAMEMODES)
            }
            else if(parsed.map.mode === 'coopmission' && !(parsed.map.name in MAPS)){
              rpData['largeImageKey'] = 'operation'
            }
            richpresence(rpData, true)
          }
        }
        catch(err) {
          console.log(err)
        }
      }


      if (parsed.hasOwnProperty('round') && parsed.round.hasOwnProperty('bomb') && parsed.round.bomb === COMMANDS.PLANTED) {
        console.log('sending a '+COMMANDS.PLANTED)
        callback({type:'command', content:COMMANDS.PLANTED})
      } else if (
                  (
                    phase === COMMANDS.FREEZETIME ||
                    phase === COMMANDS.LIVE ||
                    phase === COMMANDS.WARMUP
                  ) &&
                  (!parsed.hasOwnProperty('map') || !parsed.map.hasOwnProperty('phase') || phase !== 'gameover')
                ) {
        if(phase === COMMANDS.WARMUP){
          phase = COMMANDS.LIVE
        }
        console.log('sending a ' + phase)
        callback({type:'command', content:phase})
        if (parsed.player.hasOwnProperty('steamid') && parsed.player.steamid === steamid) {
          if (parsed.player.hasOwnProperty('match_stats') && ~isNaN(parsed.player.match_stats.mvps)) {
            mvps = parsed.player.match_stats.mvps
          }
        }
      } else if (phase === 'over') {
        if (parsed.round.hasOwnProperty('win_team')) {
          let teamname = (teamCT) ? 'CT' : 'T'
          let comSend = COMMANDS.LOSE
          if (parsed.round.win_team === teamname) {
            comSend = COMMANDS.WIN
            if (parsed.player.hasOwnProperty('steamid') && parsed.player.steamid === steamid) {
              if (parsed.player.hasOwnProperty('match_stats') && !isNaN(parsed.player.match_stats.mvps)) {
                if (parsed.player.match_stats.mvps > mvps) {
                  comSend = COMMANDS.MVP
                }
                mvps = parsed.player.match_stats.mvps
              }
            }
          }
          console.log('sending a ' + comSend)
          callback({type:'command', content:comSend})
        }
      } else if (parsed.player.hasOwnProperty('steamid') && parsed.player.steamid === steamid) {
        if (parsed.player.hasOwnProperty('match_stats') && !isNaN(parsed.player.match_stats)) {
          mvps = parsed.player.match_stats.mvps
        }
      }
    } else if (parsed.player.hasOwnProperty('activity') && parsed.player.activity === 'menu') {
      console.log('sending a menu')
      callback({type:'command', content:COMMANDS.MENU})

      if(steamid !== null){
        ipc.send('inviteUrl', steamid)
      }
      else{
        richpresence(MENURPC, false)
      }
    }
  }
}

function startServer(){
  if(running){
    return
  }
  init()
  server = httpshutdown(server)
  server.listen(port)
  running = true
}

function stopServer(cb=function(err){}){
  if(server){
    server.shutdown(function(err){
      running = false
      cb(err)
    })
  }
  else{
    cb(false)
  }
}

function changeCallback(cb) {
  callback = cb
}

function changePort(p) {
  let newPort = p !== port
  port = p
  if(newPort){
    stopServer()
    startServer()
    /*For some reason, even with libraries like http-shutdown, the server.close
    callback NEVER gets fired. No idea why that happens.*/
  }
}

function restartServer(){
  throw 'server.close callback doesn\'t work. Can\'t perform a proper restart.'
}

function getHeartbeat(){
  return heartbeat
}

function getUrl(){
  return 'http://'+HOST+':'+port
}

function getAuth(){
  return AUTH
}

ipc.on('inviteUrl', function(event, partyId){
  let includesLobbyId = partyId.includes('joinlobby')
  richpresence(MENURPC, includesLobbyId)
  if(includesLobbyId){
    let split = partyId.split('/')
    if(split.length >= 6){
      let lobbyId = split[4]
      richpresence({
        partyId: btoa(lobbyId),
        partySize: 1,
        partyMax: 5,
        joinSecret: [lobbyId, split[5]].join('/')
      }, true)
    }
  }
})

exports.start = startServer
exports.stop = stopServer
exports.restart = restartServer
exports.changeCallback = changeCallback
exports.changePort = changePort
exports.commands = COMMANDS
exports.getHeartbeat = getHeartbeat
exports.getUrl = getUrl
exports.getAuth = getAuth
exports.running = function(){
  return running
}
exports.getId = function(){
  return steamid;
}
exports.richpresence = drp
