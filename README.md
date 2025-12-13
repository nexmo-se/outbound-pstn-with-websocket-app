# Application using Vonage Voice API for an outbound PSTN call linked to a WebSocket

## Overview

When streaming real-time audio from a PSTN leg to a WebSocket leg, e.g. for connecting to an STT (Speech-to-Text) or STS (Speech-to-Speech) AI engine, we would want to make sure thet all spoken words from the participant are captured from the beginning and not miss the very first spoken words just after PSTN call answer.

To implement such solution, the Voice API application needs to:</br>
- Establish first the WebSocket leg to the middleware (aka connector) server or to the AI engine provider,
- Then establish the PSTN leg,
- Once the PSTN leg is answered by callee, the audio from the callee is streamed real time via the WebSocket to the middleware server or directly to the AI engine provider.

That WebSocket handles bi-directional audio, so any possible speech answer from the AI engine is streamed back to the callee recipient through the WebSocket.

## Set up

### Set up the sample Connector (middleware) server - Host server public hostname and port

First set up your Connector server,</br>
or instead for tests, use this sample connector to Deepgram STT from https://github.com/nexmo-se/deepgram-connector.

Default local (not public!) of the Connector server `port` is: 6000.

If you plan to test using a `Local deployment`, you may use ngrok (an Internet tunneling service) for both<br>
this Voice API application<br>
and the Connector application<br>
with [multiple ngrok tunnels](https://ngrok.com/docs/agent/config/v2/#tunnel-configurations).

To do that, [install ngrok](https://ngrok.com/downloads).<br>
Log in or sign up with [ngrok](https://ngrok.com/),<br>
from the ngrok web UI menu, follow the **Setup and Installation** guide.

Set up two tunnels,<br>
one to forward to the local port 6000 (as the Connector application will be listening on port 6000),<br>
the other one to the local port 8000 for this Voice API application,<br>
see this [sample yaml configuration file](https://ngrok.com/docs/agent/config/v2/#define-two-tunnels-named-httpbin-and-demo) (see paragraph titled "Define two tunnels named ‘httpbin’ and ‘demo’"), but it needs port 6000 and 8000 as actual values,<br>
depending if you have a paid ngrok account or not, you may or may not be able to set (static) domain names.

Start ngrok to start both tunnels that forward to local ports 6000 and 8000, e.g.<br>
`ngrok start httpbin demo` _(per the ngrok web page example)_,

please take note of the ngrok Enpoint URL that forwards to local port 6000 as it will be needed here for this Voice API application environment variable as **`PROCESSOR_SERVER`** in one of the next sections, that URL looks like:<br>
`xxxxxxxx.ngrok.xxx` (for ngrok),<br>
or `myserver.mycompany.com:32000` (public host name and port of your Connector application server)<br>
no `port` is necessary with ngrok as public host name,<br>
that host name to specify must not have a leading protocol text such as `https://`, `wss://`, nor trailing `/`.

### Set up your Vonage Voice API application credentials and phone number

[Log in to your](https://dashboard.nexmo.com/sign-in) or [sign up for a](https://ui.idp.vonage.com/ui/auth/registration) Vonage APIs account.

Go to [Your applications](https://dashboard.nexmo.com/applications), access an existing application or [+ Create a new application](https://dashboard.nexmo.com/applications/new).

Under Capabilities section (click on [Edit] if you do not see this section):

Enable Voice
- Under Answer URL, leave HTTP GET, and enter https://\<host\>:\<port\>/answer (replace \<host\> and \<port\> with the public host name and if necessary public port of the server where this sample application is running)</br>
- Under Event URL, **select** HTTP POST, and enter https://\<host\>:\<port\>/event (replace \<host\> and \<port\> with the public host name and if necessary public port of the server where this sample application is running)</br>
Note: If you are using ngrok for this sample application, the answer URL and event URL look like:</br>
https://yyyyyyyy.ngrok.xxx/answer</br>
https://yyyyyyyy.ngrok.xxx/event</br> 	
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
above request will call the default callee number as set in the .env file,	

or

`https://<this-application-server-address>/call?callee=12995550101`
above request will call the callee number specified in the command line.



