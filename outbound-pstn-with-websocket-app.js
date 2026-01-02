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
// TBD try load private key once
const apiBaseUrl = process.env.API_BASE_URL;
// const apiBaseUrl = 'https://api-us.vonage.com';
const privateKey = fs.readFileSync('./.private.key'); // used by tokenGenerate
const { tokenGenerate } = require('@vonage/jwt');

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
//-- Sample request: https://<server-address/call?callee=12995551212&record=true (only this call is recorded)

//-- or to use default callee number from .env file
//-- Sample request: https://<server-address/call
//-- Sample request: https://<server-address/call?record=true (only this call is recorded)

app.get('/call', (req, res) => {

  res.status(200).send('Ok');

  //-- code may be added to check that the callee argument is a valid phone number
  const callee = req.query.callee || calleeNumber; // defaults to env variable if not specified as a query parameter
  console.log("Calling", callee);

  //-- record this call only (if RECORD_ALL_CALLS in .env is set to false)
  const recordThisCall = req.query.record == "true" ? true : false;
  console.log("Record this PSTN call", recordThisCall);

  const sessionId = crypto.randomUUID(); ; 
  addSessionIdToUuidTracking(sessionId); // object used to track WebSocket leg uuid and PSTN leg uuid
  
  uuidTracking[sessionId]["callee"] = callee;
  // console.log('\nuuidTracking:', uuidTracking);

  uuidTracking[sessionId]["recordThisCall"] = recordThisCall;
  // console.log('\nuuidTracking:', uuidTracking);

  const hostName = req.hostname;
  // console.log("Host name:", hostName);

  //-- WebSocket connection --
  const webhookUrl = encodeURIComponent('https://' + hostName + '/results?session_id=' + sessionId)


  const wsUri = 'wss://' + processorServer + '/socket?pstn_number=' + callee + '&session_id=' + sessionId + '&webhook_url=' + webhookUrl;   
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

    console.log('\n>>> Websocket leg', req.body.uuid, 'terminated');
  
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

  //--

  if (uuidTracking[sessionId]["recordThisCall"] || recordAllCalls) { // record this specific PSTN call or all PSTN calls are being recorded)

    // if (req.body.status == 'started') {
    // if (req.body.status == 'ringing') {
    if (req.body.status == 'answered') { 

      const uuid = uuidTracking[sessionId]["pstnUuid"];

      const accessToken = tokenGenerate(appId, privateKey, {});
    
      try { 
        const response = await axios.post(apiBaseUrl + '/v1/legs/' + uuid + '/recording',
          {
            "split": true,
            "streamed": true,
            // "beep": true,
            "public": true,
            "validity_time": 30,
            "format": "mp3",
          },
          {
            headers: {
              "Authorization": 'Bearer ' + accessToken,
              "Content-Type": 'application/json'
            }
          }
        );
        console.log('\n>>> Start recording on leg:', uuid);
      } catch (error) {
        console.log('\n>>> Error start recording on leg:', uuid, error);
      }

    }

  }
  
  //--

  if (req.body.status == 'completed') {
      
    deleteFromUuidTracking(sessionId);
    // console.log('\nuuidTracking:', uuidTracking);

  }

  //--

 });

//------------

app.post('/results', async(req, res) => { // Real-Time STT results

  res.status(200).send('Ok');

  const sessionId =  req.query.session_id;

  if (req.body.type == "Results") {
    
    const transcript = req.body.channel.alternatives[0].transcript;
    
    if(transcript!= "") {
      console.log('\nTranscript for callee', uuidTracking[sessionId]["callee"] + ',', 'pstn uuid', uuidTracking[sessionId]["pstnUuid"] + ',', 'ws uuid', uuidTracking[sessionId]["websocketUuid"]);
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
