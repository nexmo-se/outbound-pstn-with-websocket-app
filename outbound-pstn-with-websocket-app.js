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

const calleeNumber = process.env.CALLEE_NUMBER;
console.log("Test default PSTN callee phone number:", calleeNumber);

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
  sessionTracking[id]["sessionId"] = null;
  // sessionTracking[id]["convUuid"] = null;
  sessionTracking[id]["websocketUuid"] = null;
  sessionTracking[id]["pstnUuid"] = null;
  sessionTracking[id]["callee"] = null;
}

function deleteFromSessionTracking(id) {
  delete sessionTracking[id];
}

//===========================================================

//-- Trigger an outbound PSTN call - see sample request below

//-- Sample request: https://<server-address/call?callee=12995551212

//-- or to use default callee number from .env file
//-- Sample request: https://<server-address/call

app.get('/call', async (req, res) => {

  // res.status(200).send('Ok');

  //-- code may be added to check that the callee argument is a valid phone number
  const callee = req.query.callee || calleeNumber; // defaults to env variable if not specified as a query parameter
  console.log("Calling", callee);

  const hostName = req.hostname;
  // console.log("Host name:", hostName);

  const sessionId = crypto.randomUUID();
  addToSessionTracking(sessionId);

  sessionTracking[sessionId]["callee"] = callee;

  //-- WebSocket connection --
  const webhookUrl = encodeURIComponent('https://' + hostName + '/results?session_id=' + sessionId)

  const wsUri = 'wss://' + processorServer + '/socket?outbound_pstn=true&session_id=' + sessionId + '&webhook_url=' + webhookUrl;   
  console.log('>>> Create Websocket:', wsUri);

  //--

  let sessionStatus;

  await vonage.voice.createOutboundCall({
    to: [{
      type: 'websocket',
      uri: wsUri,
      'content-type': 'audio/l16;rate=16000',  // NEVER change the content-type parameter argument
      headers: {}
    }],
    from: {
      type: 'phone',
      number: callee
    },
    event_url: ['https://' + hostName + '/ws_event?session_id=' + sessionId],
    event_method: 'POST',
    ncco: [
      {
        "action": "connect",
        "eventUrl": ['https://' + hostName + '/pstn_event?session_id=' + sessionId],
        "timeout": "45",  // adjust this value for your use case
        "from": servicePhoneNumber,
        "endpoint": [
          {
            "type": "phone",
            "number": callee
          }
        ]
      }
    ]

    })
    .then(res => {
      console.log(">>> WebSocket created for callee", callee, res);
      // sessionTracking[sessionId]["convUuid"] = req.conversation_uuid;
      sessionTracking[sessionId]["websocketUuid"] = res.uuid;
      sessionStatus = 'Session-id:' + sessionId;
    })
    .catch(err => {
      console.error(">>> WebSocket create error for callee", callee, err);
      sessionStatus = 'Failed to create WebSocket for callee ' + callee + ' ' + err;
    });

  res.status(200).send(sessionStatus);    

});

//--------------

app.post('/ws_event', async(req, res) => {

  res.status(200).send('Ok');

  //--

  if (req.status == 'completed') {
    // info no longer needed
    deleteFromSessionTracking(req.body.conversation_uuid);
  }

  //--

  // console.log('\n/ws_event:\n' + JSON.stringify(req.body, null, 2));

  //--

});

//--------------

app.post('/pstn_event', async(req, res) => {

  res.status(200).send('Ok');

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
      console.log('\nTranscript for session', sessionId, ', callee', sessionTracking[sessionId]["callee"] + ', pstn uuid', sessionTracking[sessionId]["pstnUuid"] + ', ws uuid', sessionTracking[sessionId]["websocketUuid"]);
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
      "text": "This number does not accept incoming calls.",
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
