'use strict'

//-------------

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser')
const app = express();

app.use(bodyParser.json());

const crypto = require("crypto"); 

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

//--- Vonage API ---

const { Auth } = require('@vonage/auth');

const credentials = new Auth({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: process.env.APP_ID,
  privateKey: './.private.key'    // private key file name with a leading dot 
});

const { Vonage } = require('@vonage/server-sdk');

const vonage = new Vonage(credentials);

// Use for direct REST API calls - Sample code
// const appId = process.env.APP_ID; // used by tokenGenerate
// const privateKey = fs.readFileSync('./.private.key'); // used by tokenGenerate
// const { tokenGenerate } = require('@vonage/jwt');

//-------------------

// WebSocket server (middleware/connector)
const processorServer = process.env.PROCESSOR_SERVER;

//-------------------

let uuidTracking = {}; // dictionary

function addSessionIdToUuidTracking(id) {
  uuidTracking[id] = {};
  uuidTracking[id]["pstnUuid"] = null;
  uuidTracking[id]["websocketUuid"] = null;
}

function deleteFromUuidTracking(id) {
  delete uuidTracking[id];
}

// // -- testing it ------

// addSessionIdToUuidTracking('111');
// console.log('\nuuidTracking:', uuidTracking);

// uuidTracking['111']["pstnUuid"] = 'p111';
// uuidTracking['111']["websocketUuid"] = 'w111';
// uuidTracking['111']["callee"] = '12995550101';
// console.log('\nuuidTracking:', uuidTracking);

// addSessionIdToUuidTracking('222');
// console.log('\nuuidTracking:', uuidTracking);

// uuidTracking['222']["pstnUuid"] = 'p222';
// uuidTracking['222']["websocketUuid"] = 'w222';
// uuidTracking['222']["callee"] = '12995550202';
// console.log('\nuuidTracking:', uuidTracking);

// deleteFromUuidTracking('111');
// console.log('\nuuidTracking:', uuidTracking);

//===========================================================

//-- Trigger an outbound PSTN call - see sample request below
//-- Sample request: https://<server-address/call?callee=12995551212
//-- or
//-- Sample request: https://<server-address/call  (to use default parameters from .env file)

app.get('/call', (req, res) => {

  res.status(200).send('Ok');

  console.log("Host name:", req.hostName);

  //-- code may be added to check that the callee argument is a valid phone number
  const callee = req.query.callee || calleeNumber; // defaults to env variable if not specified as a query parameter
  console.log("Calling", callee);

  const sessionId = crypto.randomUUID(); ; 
  addSessionIdToUuidTracking(sessionId); // object used to track WebSocket leg uuid and PSTN leg uuid
  
  uuidTracking[sessionId]["callee"] = callee;
  // console.log('\nuuidTracking:', uuidTracking);

  const hostName = req.hostname;
  // console.log("Host name:", hostName);

  //-- WebSocket connection --
  const webhookUrl = encodeURIComponent('https://' + hostName + '/results?session_id=' + sessionId)


  const wsUri = 'wss://' + processorServer + '/socket?callee=' + callee + '&session_id=' + sessionId + '&webhook_url=' + webhookUrl + '&outbound_pstn=true';   
  console.log('>>> Create Websocket:', wsUri);

  vonage.voice.createOutboundCall({
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
    answer_url: ['https://' + hostName + '/ws_answer?callee=' + callee + '&session_id=' + sessionId],
    answer_method: 'GET',
    event_url: ['https://' + hostName + '/ws_event?callee=' + callee + '&session_id=' + sessionId],
    event_method: 'POST'
    })
    .then(res => {
      console.log(">>> WebSocket creation status:", res);
      uuidTracking[sessionId]["websocketUuid"] = res.uuid;
      // console.log('\nuuidTracking:', uuidTracking);
    })
    .catch(err => console.error(">>> WebSocket create error:", err));
 
});

//--------------

app.get('/ws_answer', async(req, res) => {

  // const hostName = req.hostname;
  // console.log("Host name:", hostName);

  const callee = req.query.callee;

  const sessionId =  req.query.session_id;

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + req.query.uuid,
      "startOnEnter": true
    }
  ]; 

  res.status(200).json(nccoResponse);

 });

//------------

app.post('/ws_event', async(req, res) => {

  res.status(200).send('Ok');

  const hostName = req.hostname;

  if (req.body.type == 'transfer') {

    const callee = req.query.callee;
    const sessionId = req.query.session_id;

    //-- Outgoing PSTN call --
    vonage.voice.createOutboundCall({
      to: [{
        type: 'phone',
        number: callee
      }],
      from: {
       type: 'phone',
       number: servicePhoneNumber
      },
      answer_url: ['https://' + hostName + '/pstn_answer?ws_uuid=' + req.body.uuid + '&session_id=' + sessionId],
      answer_method: 'GET',
      event_url: ['https://' + hostName + '/pstn_event?ws_uuid=' + req.body.uuid + '&session_id=' + sessionId],
      event_method: 'POST'
      })
      .then(res => {
        console.log(">>> PSTN call to", callee);
        uuidTracking[sessionId]["pstnUuid"] = res.uuid;
        // console.log('\nuuidTracking:', uuidTracking);
      })
      .catch(err => console.error(">>> Outgoing PSTN call error to", callee, err))
  };

  //--

  if (req.body.status == 'completed') {

    console.log('>>> Websocket leg', req.body.uuid, 'terminated');
  
  };

});

//--------------

app.get('/pstn_answer', async(req, res) => {

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + req.query.ws_uuid,
      "startOnEnter": true,
      "endOnExit": true
    }
  ]; 

  res.status(200).json(nccoResponse);

  //-- notify connector server that PSTN call has been answered

  const sessionId = req.query.session_id;
  const wsUuid = uuidTracking[sessionId]["websocketUuid"];
      
  vonage.voice.playDTMF(wsUuid, '8') 
    .then(resp => console.log("Play DTMF to WebSocket", wsUuid))
    .catch(err => console.error("Error play DTMF to WebSocket", wsUuid, err));

 });

//--------------

app.post('/pstn_event', async(req, res) => {

  res.status(200).send('Ok');

  //--

  const sessionId =  req.query.session_id;

  if (req.body.status == 'completed') {
      
      deleteFromUuidTracking(sessionId);
      // console.log('\nuuidTracking:', uuidTracking);

  }

 });

//------------

app.post('/results', async(req, res) => { // Real-Time STT results

  res.status(200).send('Ok');

  const sessionId =  req.query.session_id;

  console.log('\nTranscript for callee', uuidTracking[sessionId]["callee"] + ',', 'pstn uuid', uuidTracking[sessionId]["pstnUuid"] + ',', 'ws uuid', uuidTracking[sessionId]["websocketUuid"]);
  console.log(req.body.transcript);

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
