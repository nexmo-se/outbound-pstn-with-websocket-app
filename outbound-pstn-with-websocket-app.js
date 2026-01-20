'use strict'

//-------------

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser')
const app = express();

app.use(bodyParser.json());

const crypto = require("crypto");
const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

//---- CORS policy - Update this section as needed ----

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");
  next();
});

//-------

// Only if needed - For self-signed certificate in chain - In test environment
// Leave next line as a comment in production environment
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

//-------

const servicePhoneNumber = process.env.SERVICE_PHONE_NUMBER;
console.log("Service phone number:", servicePhoneNumber);

const servicePhoneNumber2 = process.env.SERVICE_PHONE_NUMBER_2 || null;
if (servicePhoneNumber2) {
  console.log("Service phone number 2:", servicePhoneNumber2);  
};

const calleeNumber = process.env.CALLEE_NUMBER;
console.log("Default PSTN callee phone number for tests:", calleeNumber);

const recordAllCalls = process.env.RECORD_ALL_CALLS == "true" ? true : false;

//--- Vonage API ---

const { Auth } = require('@vonage/auth');

const appId = process.env.APP_ID;

const credentials = new Auth({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: appId,
  privateKey: './.private.key'    // private key file name with a leading dot
});

const { Vonage } = require('@vonage/server-sdk');

const vonage = new Vonage(credentials);

//- Use for direct REST API calls (e.g. call recording) -

const apiBaseUrl = process.env.API_BASE_URL;
// const apiBaseUrl = 'https://api-us.vonage.com';
const privateKey = fs.readFileSync('./.private.key'); // used by tokenGenerate
const { tokenGenerate } = require('@vonage/jwt');

//-------------------

// WebSocket server (middleware/connector)
const processorServer = process.env.PROCESSOR_SERVER;

//-------------------

let sessionTracking = {}; // dictionary

function addToSessionTracking(id) {
  sessionTracking[id] = {};
  sessionTracking[id]["websocketUuid"] = null;
  sessionTracking[id]["pstnUuid"] = null;
  sessionTracking[id]["callee"] = null;
  sessionTracking[id]["caller"] = null;
  // sessionTracking[id]["convUuid"] = null;
}

function deleteFromSessionTracking(id) {
  delete sessionTracking[id];
}

//-- Call throttling parameters --

const cps = Number(process.env.CPS);  // max call attempts per second
const addedDelay = Number(process.env.ADDED_DELAY); // in ms

const interCallInterval = Math.ceil(1000 / cps) + addedDelay; // in ms

//-- PSTN call parameters --

const maxRingDuration = Math.min( Number(process.env.MAX_RING_DURATION), 60 ); // 60 sec max

//-- Calls queue --

let callsToMake = [];  // array with objects containing {to: callee_number, from: caller_number}

//-- This server public host name, set it manually (in .env file) --
//-- or it gets automatically set after first request to this application -
let thisHost = process.env.THIS_HOST || null;

//-- Basic counters --
// let websocketCount = 0;
// let pstnCount = 0;


//===========================================================

const callPhone = async(to, from) => {

  console.log(moment(Date.now()).format('YYYY-MM-DD HH:mm:ss.SSS')); // server local time

  let status;

  const sessionId = crypto.randomUUID();
  addToSessionTracking(sessionId);

  sessionTracking[sessionId]["callee"] = to;
  sessionTracking[sessionId]["caller"] = from;

  //-- WebSocket connection --
  const webhookUrl = encodeURIComponent('https://' + thisHost + '/results?session_id=' + sessionId)

  const wsUri = 'wss://' + processorServer + '/socket?outbound_pstn=true&session_id=' + sessionId + '&webhook_url=' + webhookUrl;   
  console.log('>>> Creating Websocket:', wsUri);

  //--

  // let sessionStatus;

  await vonage.voice.createOutboundCall({
    to: [{
      type: 'websocket',
      uri: wsUri,
      'content-type': 'audio/l16;rate=16000',  // NEVER change the content-type parameter argument
      headers: {}
    }],
    from: {
      type: 'phone',
      number: to
    },
    event_url: ['https://' + thisHost + '/ws_event?session_id=' + sessionId],
    event_method: 'POST',
    ncco: [
      {
        "action": "connect",
        "eventUrl": ['https://' + thisHost + '/pstn_event?session_id=' + sessionId],
        "timeout": maxRingDuration,
        "from": from,
        "endpoint": [
          {
            "type": "phone",
            "number": to
          }
        ]
      }
    ]
    })
    .then(res => {
      // console.log(">>> WebSocket created for callee", to);
      console.log("\n>>> WebSocket created", res.uuid);
      
      sessionTracking[sessionId]["websocketUuid"] = res.uuid;
      
      // websocketCount++;
      // console.log("\n>>> Number of created WebSockets so far:", websocketCount);
      
      status = '200';
    })
    .catch(err => {
      // console.error("\n>>> Create WebSocket error for caller:", to, JSON.stringify(err.config.data, null, 2));
      console.error("\n>>> Create WebSocket error for caller:", to);
      
      for (const s of Object.getOwnPropertySymbols(err.response)) {
        // console.log(s, err.response[s]);
        if (Object.hasOwn(err.response[s], "status")) {
          status = err.response[s].status.toString();;
        }
      }
    })   

  return(status);

}

//---------------------------------------------------------

setInterval( async() => {  // make next outbound calls

  const callInfo = callsToMake.shift();

  if (callInfo) {

    console.log('\n>>> callInfo:',callInfo);

    const to = callInfo.to;
    const from = callInfo.from;

    // place call
    const result = await callPhone(to, from);
    
    switch(result) {

      case '200':
        console.log('\n>> Started WebSocket and PSTN call for callee', to);
        break;

      case '429':    
        console.log('\n>> WebSocket for PSTN callee', to, 'returned status code 429, trying again now');
        // re-add on top of "callsToMake" array
        callsToMake.unshift(callInfo);
        break;

      default:
        if (result) {
          console.log('\n>> WebSocket for PSTN callee', to, 'failed with status code', result);
        }
      
      }
    
  }

}, interCallInterval)


//-----------------------
//-- add a number to be called into the queue --

app.get('/addcall', async (req, res) => {

  res.status(200).send('Ok');

  thisHost = req.hostname;  // set the global parameter
  
  // number to call, aka callee number
  const callee = req.query.callee;

  // caller number, a Vonage number linked to this application (see dashboard.vonage.com)
  const caller = req.query.caller; 

  callsToMake.push({to: callee, from: caller})
  
});

//-----------------------

//-- add many numbers (at once) to be called into the queue --

app.get('/addmanycalls', async (req, res) => {

  res.status(200).send('Adding calls to the calling queue ...');

  thisHost = req.hostname;  // set the global parameter

  //----

  // just for illustration we add the default callee number multiple tomes
  // normally it would be different numbers from your own database

  callsToMake.push({to: calleeNumber, from: servicePhoneNumber})
  callsToMake.push({to: calleeNumber, from: servicePhoneNumber})
  callsToMake.push({to: calleeNumber, from: servicePhoneNumber})
  callsToMake.push({to: calleeNumber, from: servicePhoneNumber})
  callsToMake.push({to: calleeNumber, from: servicePhoneNumber})
  
});

//--------------

app.post('/ws_event', async(req, res) => {

  res.status(200).send('Ok');

  //--

  if (req.body.status == 'completed') {

    const sessionId = req.query.session_id;

    console.log("\n>>> WebSocket", req.body.uuid, "terminated");

    if (sessionTracking[sessionId]["pstnUuid"] == null) {  // PSTN call was not placed

      // make a new call by adding it to top of queue
      callsToMake.unshift({to: sessionTracking[sessionId]["callee"], from: sessionTracking[sessionId]["caller"]})
      console.log("\n>>> PSTN call to", sessionTracking[sessionId]["callee"], "was not placed, adding to queue again")

      // there was no complete WebSocket + PSTN call, we may remove the WebSocket call from total
      // websocketCount--;

    }

    //-- info no longer needed, with delay to avoid race conditions and possible late transcription results
    setTimeout( () => {

      deleteFromSessionTracking(sessionId);

    }, 10000)    

  }

  //--

  // console.log('\n/ws_event:\n' + JSON.stringify(req.body, null, 2));

  //--

});

//--------------

app.post('/pstn_event', async(req, res) => {

  res.status(200).send('Ok');

  // console.log("\n>>> pstn_event - status", req.body.status , "conv uuid:", req.body.conversation_uuid  , "- Session tracking", req.query.session_id, sessionTracking);

  //--- send DTMF to ws leg when pstn leg get status answered ---

  if (req.body.status == 'answered') {

    const sessionId = req.query.session_id;

    sessionTracking[sessionId]["pstnUuid"] = req.body.uuid;

    const wsUuid = sessionTracking[sessionId]["websocketUuid"];

    vonage.voice.playDTMF(wsUuid, '8') 
      .then(resp => console.log("Play DTMF to WebSocket", wsUuid))
      .catch(err => console.error("Error play DTMF to WebSocket", wsUuid, err));

  }

  //--

  // if (req.body.status == 'started') {

  //     pstnCount++;
  //     console.log("\n>>> Number of created PSTN calls so far:", pstnCount);

  // }

  //---

  if (req.body.status == 'completed') {

      console.log("\n>>> PSTN", req.body.uuid, "terminated");

  }

  //--

  // console.log('\n/pstn_event:\n' + JSON.stringify(req.body, null, 2));

  //--

});

//------------

app.post('/results', async(req, res) => { // Real-Time STT results

  res.status(200).send('Ok');

  const sessionId =  req.query.session_id;
  // const convUuid = req.query.conv_uuid;

  if (req.body.type == "Results") {
    
    const transcript = req.body.channel.alternatives[0].transcript;
    
    if(transcript!= "") {
      
      // console.log('\nTranscript for session', sessionId, ', callee', sessionTracking[sessionId]["callee"] + ', pstn uuid', sessionTracking[sessionId]["pstnUuid"] + ', ws uuid', sessionTracking[sessionId]["websocketUuid"]);
      console.log('\nTranscript for callee', sessionTracking[sessionId]["callee"]);
      
      console.log(transcript);
      //--
      const speaker = req.body.channel.alternatives[0].words[0].speaker;
      if (speaker != undefined) {
        console.log('Speaker:', speaker)
      }
    }
  
  }
  // else {
  //   console.log('\nSession', sessionId, 'info from DG:');
  //   console.log(req.body);
  // }  

});

//-------------------

app.post('/rtc', async(req, res) => {

  res.status(200).send('Ok');

  if (req.body.type == "audio:record:done") {

    // TBD use call uuid in file name

    console.log('\n>>> /rtc audio:record:done');
    // console.log('req.body.body.destination_url', req.body.body.destination_url);
    // console.log('req.body.body.recording_id', req.body.body.recording_id);

    const uuid = req.body.body.channel.legs[0].leg_id;
    console.log('call leg uuid:', uuid);

    const callee = req.body.body.channel.to.number;
    console.log('callee number:', callee);

    //-- here, you may create your own PSTN audio recording file name template after './post-call-data/'
    await vonage.voice.downloadRecording(req.body.body.destination_url, './post-call-data/' + callee + '_' + moment(Date.now()).format('YYYY_MM_DD_HH_mm_ss_SSS') + '_pstn_' + uuid + '.wav'); // using server local time, not UTC
    // await vonage.voice.downloadRecording(req.body.body.destination_url, './post-call-data/' + callee + '_' + moment.utc(Date.now()).format('YYYY_MM_DD_HH_mm_ss_SSS') + '_pstn_' + uuid + '.wav'); // using UTC

  }

});


//============= Processing unexpected inbound PSTN calls ===============

//-- Default answer webhook path in Vonage API Dashboard
app.get('/answer', async(req, res) => {

  const nccoResponse = [
    {
      "action": "talk",
      // "text": "This number does not accept incoming calls.",
      "text": "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30.",
      "language": "en-US",
      "style": 11
    }
  ];

  res.status(200).json(nccoResponse);

});

//------------

//-- Default event webhook path in Vonage API Dashboard
app.post('/event', async(req, res) => {

  res.status(200).send('Ok');

});

//--- If this application is hosted on Vonage Cloud Runtime (VCR) serverless infrastructure --------

app.get('/_/health', async(req, res) => {

  res.status(200).send('Ok');

});

//=========================================

const port = process.env.VCR_PORT || process.env.PORT || 8000;

app.listen(port, () => console.log(`Voice API application listening on port ${port}!`));

//------------
