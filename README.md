# Application using Vonage Voice API for an outbound PSTN call linked to a WebSocket

## Overview

When streaming real-time audio from a PSTN leg to a WebSocket leg, e.g. for connecting to an STT (Speech-to-Text) or STS (Speech-to-Speech) AI engine, we would want to make sure thet all spoken words from the participant are captured from the beginning and not miss the very first spoken words just after PSTN call answer.

To implement such solution, the Voice API application needs to:</br>
- Establish first the WebSocket leg to the middleware (aka connector) server or to the AI engine provider,
- Then establish the PSTN leg,
- Once the PSTN leg ia answered by callee, the audio from the callee is streamed real time via the WebSocket to the middleware server or directly to the AI engine provider.

That WebSocket handles bi-directional audio, so any possible speech answer from the AI engine is streamed back to the callee recipient through the WebSocket.

## Set up

### Set up the sample basic middleware server - Host server public hostname and port

First set up your middleware (aka connector) server,</br>
or instead for tests, use this sample connector to Deepgram STT from https://github.com/nexmo-se/deepgram-connector.

Default local (not public!) of that middleware server `port` is: 6000.

If you plan to test using `Local deployment` with ngrok (Internet tunneling service) for both the sample middleware server application and this sample Voice API application, you may set up [multiple ngrok tunnels](https://ngrok.com/docs/agent/config/#tunnel-configurations).

For the next steps, you will need:
- That middleware public hostname and if necessary public port,</br>
e.g. `xxxxxxxx.ngrok.io`, `xxxxxxxx.herokuapp.com`, `myserver.mycompany.com:32000`  (as **`PROCESSOR_SERVER`**),</br>
no `port` is necessary with ngrok or heroku as public hostname.</br>

### Set up your Vonage Voice API application credentials and phone number

[Log in to your](https://dashboard.nexmo.com/sign-in) or [sign up for a](https://dashboard.nexmo.com/sign-up) Vonage APIs account.

Go to [Your applications](https://dashboard.nexmo.com/applications), access an existing application or [+ Create a new application](https://dashboard.nexmo.com/applications/new).

Under Capabilities section (click on [Edit] if you do not see this section):

Enable Voice
- Under Answer URL, leave HTTP GET, and enter https://\<host\>:\<port\>/answer (replace \<host\> and \<port\> with the public host name and if necessary public port of the server where this sample application is running)</br>
- Under Event URL, **select** HTTP POST, and enter https://\<host\>:\<port\>/event (replace \<host\> and \<port\> with the public host name and if necessary public port of the server where this sample application is running)</br>
Note: If you are using ngrok for this sample application, the answer URL and event URL look like:</br>
https://yyyyyyyy.ngrok.io/answer</br>
https://yyyyyyyy.ngrok.io/event</br> 	
- Click on [Generate public and private key] if you did not yet create or want new ones, save the private key file in this application folder as .private.key (leading dot in the file name).</br>
**IMPORTANT**: Do not forget to click on [Save changes] at the bottom of the screen if you have created a new key set.</br>
- Link a phone number to this application if none has been linked to the application.

Please take note of your **application ID** and the **linked phone number** (as they are needed in the very next section).

For the next steps, you will need:</br>
- Your [Vonage API key](https://dashboard.nexmo.com/settings) (as **`API_KEY`**)</br>
- Your [Vonage API secret](https://dashboard.nexmo.com/settings), not signature secret, (as **`API_SECRET`**)</br>
- Your `application ID` (as **`APP_ID`**),</br>
- The **`phone number linked`** to your application (as **`SERVICE_PHONE_NUMBER`**), your phone will **call that number**,</br>

### Local setup

Copy or rename .env-example to .env<br>
Update parameters in .env file<br>

Have Node.js installed on your system, this application has been tested with Node.js version 22.16<br>

Install reqruired node modules with the command:<br>
 ```bash
npm install
```

Launch the application:<br>
```bash
node outbound-pstn-with-websocket-app
```

Default local (not public!) of this application server `port` is: 8000.


### OPTIONAL - Notify middleware application when outbound PSTN call has been answered

Your middleware (aka connector) server (at the other end the WebSocket) application may want to be notified at the exact moment the corresponding PSTN call is answered by the callee,</br>
this is achieved by sending a DTMF over the WebSocket, the middleware receives a text type message on the WebSocket which text payload looks like this (as seen on the terminal where the middleware code runs):</br>

_>>> Websocket text message: {"event":"websocket:dtmf","digit":"8","duration":130}_

That notification is sent by the Voice API application</br>
_outbound-pstn-with-websocket-app.js_ at line number 225. 

### Try the application

From a web browser trigger outbound test calls with the web address:</br>

`https://<this-application-server-address>/call`</br>
above request will call the default 	

or

`https://<this-application-server-address>/call?callee=12995550101`




